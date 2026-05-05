import contextlib
import io
import json
import os
import tomllib
import zipfile
from pathlib import Path
from typing import cast
from unittest import mock

import unittest

from editorial_cli.cli import filter_sections, main, parse_args
from editorial_cli.config import load_dotenv_file, load_cli_config
from editorial_cli.document import DocumentPart, extract_docx_parts, split_document
from editorial_cli.llm import OpenAICompatibleClient
from editorial_cli.models import JsonObject, Section, Suggestion
from editorial_cli.reports import (
    render_compare_report,
    render_diff_report,
    render_html_report,
    render_json_report,
    render_markdown_report,
)
from editorial_cli.runs import RunStore
from editorial_cli.terminal_ui import ProgressReporter


def make_docx(path: Path) -> None:
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Chapter 1: The Door</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>* * *</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second scene begins.</w:t></w:r></w:p>
  </w:body>
</w:document>
"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>
"""
    with zipfile.ZipFile(path, "w") as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("word/document.xml", document_xml)


class EditorialSuggestionsTests(unittest.TestCase):
    def test_extract_docx_parts_preserves_text_and_heading_style(self) -> None:
        tmp = Path(self._testMethodName + ".docx")
        try:
            make_docx(tmp)

            parts = extract_docx_parts(tmp)

            self.assertEqual(parts[0].text, "Chapter 1: The Door")
            self.assertTrue(parts[0].is_heading)
            self.assertEqual(parts[1].text, "First paragraph.")
            self.assertFalse(parts[1].is_heading)
        finally:
            tmp.unlink(missing_ok=True)

    def test_split_document_detects_chapters_and_scene_breaks(self) -> None:
        parts = [
            DocumentPart("Chapter 1: The Door", is_heading=True),
            DocumentPart("First paragraph."),
            DocumentPart("* * *"),
            DocumentPart("Second scene begins."),
            DocumentPart("Chapter 2: The Key", is_heading=True),
            DocumentPart("Next chapter."),
        ]

        sections = split_document(parts)

        self.assertEqual([section.title for section in sections], [
            "Chapter 1: The Door",
            "Chapter 1: The Door - Scene 2",
            "Chapter 2: The Key",
        ])
        self.assertIn("First paragraph.", sections[0].text)
        self.assertIn("Second scene begins.", sections[1].text)

    def test_render_markdown_report_lists_suggestions_per_section(self) -> None:
        suggestions: list[Suggestion] = [
            {
                "title": "Chapter 1: The Door",
                "summary": "A threshold scene.",
                "suggestions": ["Sharpen the opening image.", "Clarify the final beat."],
            }
        ]

        report = render_markdown_report("book.docx", "style note", suggestions)

        self.assertIn("# Editorial Suggestions for book.docx", report)
        self.assertIn("## Chapter 1: The Door", report)
        self.assertIn("- Sharpen the opening image.", report)
        self.assertIn("> style note", report)

    def test_parse_args_keeps_docx_as_suggest_shortcut(self) -> None:
        args = parse_args(["book.docx", "--dry-run"])

        self.assertEqual(args.command, "suggest")
        self.assertEqual(args.docx, Path("book.docx"))
        self.assertTrue(args.dry_run)

    def test_outline_command_writes_markdown_without_llm(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".md")
        try:
            make_docx(docx_path)

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = main([
                    "outline",
                    str(docx_path),
                    "--format",
                    "markdown",
                    "--no-progress",
                    "-o",
                    str(output_path),
                ])

            self.assertEqual(exit_code, 0)
            report = output_path.read_text(encoding="utf-8")
            self.assertIn("# Manuscript Outline", report)
            self.assertIn("Chapter 1: The Door", report)
            self.assertIn("Second scene begins.", report)
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)

    def test_load_cli_config_reads_llm_table(self) -> None:
        config_path = Path(self._testMethodName + ".toml")
        try:
            config_path.write_text(
                '[llm]\nmodel = "editor-model"\nbase_url = "http://localhost:11434/v1"\n',
                encoding="utf-8",
            )

            config = load_cli_config(config_path)

            llm_config = config["llm"]
            self.assertIsInstance(llm_config, dict)
            llm_table = cast(JsonObject, llm_config)
            self.assertEqual(llm_table["model"], "editor-model")
            self.assertEqual(llm_table["base_url"], "http://localhost:11434/v1")
        finally:
            config_path.unlink(missing_ok=True)

    def test_dotenv_values_override_shell_environment_and_config(self) -> None:
        env_path = Path(self._testMethodName + ".env")
        try:
            env_path.write_text(
                'LLM_MODEL="dotenv-model"\nLLM_BASE_URL=http://localhost:9999/v1\nLLM_API_KEY=dotenv-key\n',
                encoding="utf-8",
            )
            dotenv = load_dotenv_file(env_path)
            args = parse_args(["--env-file", str(env_path), "doctor"])
            config: JsonObject = {
                "llm": {
                    "model": "config-model",
                    "base_url": "http://localhost:1111/v1",
                    "api_key": "config-key",
                }
            }

            with mock.patch.dict(os.environ, {
                "LLM_MODEL": "shell-model",
                "LLM_BASE_URL": "http://localhost:2222/v1",
                "LLM_API_KEY": "shell-key",
            }):
                client = OpenAICompatibleClient.from_settings(args, config, dotenv)

            self.assertEqual(client.model, "dotenv-model")
            self.assertEqual(client.base_url, "http://localhost:9999/v1")
            self.assertEqual(client.api_key, "dotenv-key")
        finally:
            env_path.unlink(missing_ok=True)

    def test_doctor_reports_configured_model(self) -> None:
        stream = io.StringIO()

        with contextlib.redirect_stdout(stream):
            exit_code = main(["doctor", "--model", "editor-model", "--base-url", "http://localhost:11434/v1"])

        self.assertEqual(exit_code, 0)
        output = stream.getvalue()
        self.assertIn("model: editor-model", output)
        self.assertIn("endpoint: http://localhost:11434/v1", output)

    def test_pyproject_exposes_editorial_console_script(self) -> None:
        pyproject = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))

        self.assertEqual(pyproject["project"]["scripts"]["editorial"], "editorial_cli.cli:main")
        self.assertNotIn("py-modules", pyproject["tool"]["setuptools"])

    def test_legacy_editorial_suggestions_script_is_not_shipped(self) -> None:
        self.assertFalse(Path("editorial_suggestions.py").exists())

    def test_progress_reporter_renders_progress_and_fun_fact(self) -> None:
        stream = io.StringIO()
        reporter = ProgressReporter(enabled=True, fun_facts=True, stream=stream, facts=["Revision rewards specificity."])

        reporter.start("Reading manuscript")
        reporter.advance("Reading manuscript", 1, 4)
        reporter.finish("Done")

        output = stream.getvalue()
        self.assertIn("Reading manuscript", output)
        self.assertIn("[#####---------------] 25%", output)
        self.assertIn("Fun fact: Revision rewards specificity.", output)
        self.assertIn("Done", output)

    def test_progress_reporter_replaces_fun_fact_line(self) -> None:
        stream = io.StringIO()
        reporter = ProgressReporter(
            enabled=True,
            fun_facts=True,
            stream=stream,
            facts=["First tip.", "Second tip."],
        )

        reporter.show_fact()
        reporter.show_fact()

        output = stream.getvalue()
        self.assertEqual(output.count("\n"), 0)
        self.assertEqual(output.count("\rFun fact:"), 2)
        self.assertIn("\rFun fact: First tip.", output)
        self.assertIn("\rFun fact: Second tip.", output)

    def test_run_store_saves_manifest_outline_and_latest_pointer(self) -> None:
        base_dir = Path(self._testMethodName)
        store = RunStore(base_dir)
        sections = [DocumentPart("Chapter 1", is_heading=True), DocumentPart("Text.")]
        try:
            split_sections = split_document(sections)

            run = store.start_run("book.docx", split_sections, run_id="demo-run")
            store.save_text(run, "report.md", "# Report\n")
            store.save_json(run, "suggestions.json", [{"title": "Chapter 1"}])

            self.assertEqual((base_dir / "latest.txt").read_text(encoding="utf-8"), "demo-run\n")
            self.assertTrue((run.path / "manifest.json").exists())
            self.assertEqual((run.path / "report.md").read_text(encoding="utf-8"), "# Report\n")
            self.assertEqual(store.load_json(run.id, "suggestions.json"), [{"title": "Chapter 1"}])
        finally:
            for path in sorted(base_dir.rglob("*"), reverse=True):
                path.unlink() if path.is_file() else path.rmdir()
            base_dir.rmdir() if base_dir.exists() else None

    def test_render_json_report_returns_machine_readable_output(self) -> None:
        suggestions: list[Suggestion] = [{"title": "Chapter 1", "summary": "A beginning.", "suggestions": ["Cut filler."]}]
        rendered = render_json_report(
            "book.docx",
            "style note",
            suggestions,
        )

        payload = json.loads(rendered)

        self.assertEqual(payload["source"], "book.docx")
        self.assertEqual(payload["context_brief"], "style note")
        self.assertEqual(payload["sections"][0]["title"], "Chapter 1")

    def test_suggest_dry_run_writes_markdown_directory_by_default(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_dir = docx_path.with_name(f"{docx_path.stem}_editorial_suggestions")
        save_dir = Path(self._testMethodName + "_runs")
        try:
            make_docx(docx_path)

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = main([
                    "suggest",
                    str(docx_path),
                    "--dry-run",
                    "--run-id",
                    "dry-demo",
                    "--save-dir",
                    str(save_dir),
                    "--no-progress",
                ])

            self.assertEqual(exit_code, 0)
            self.assertTrue(output_dir.is_dir())
            self.assertTrue((output_dir / "index.md").exists())
            self.assertTrue((output_dir / "context_brief.md").exists())
            chapter_files = sorted(path.name for path in output_dir.glob("*.md"))
            self.assertIn("001-chapter-1-the-door.md", chapter_files)
            self.assertIn("002-chapter-1-the-door-scene-2.md", chapter_files)
            self.assertTrue((save_dir / "dry-demo" / "outline.json").exists())
            self.assertTrue((save_dir / "dry-demo" / "report.md").exists())
            self.assertEqual((save_dir / "latest.txt").read_text(encoding="utf-8"), "dry-demo\n")
        finally:
            docx_path.unlink(missing_ok=True)
            if output_dir.exists():
                for path in sorted(output_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                output_dir.rmdir()
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_suggest_single_file_option_writes_combined_markdown(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".md")
        save_dir = Path(self._testMethodName + "_runs")
        try:
            make_docx(docx_path)

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = main([
                    "suggest",
                    str(docx_path),
                    "--dry-run",
                    "--single-file",
                    "--run-id",
                    "single-demo",
                    "--save-dir",
                    str(save_dir),
                    "-o",
                    str(output_path),
                    "--no-progress",
                ])

            self.assertEqual(exit_code, 0)
            report = output_path.read_text(encoding="utf-8")
            self.assertIn("# Editorial Suggestions for", report)
            self.assertIn("## Chapter 1: The Door", report)
            self.assertFalse(Path(f"{docx_path.stem}_editorial_suggestions").exists())
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_suggest_pause_saves_partial_progress_for_resume(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".md")
        save_dir = Path(self._testMethodName + "_runs")
        first_suggestion: Suggestion = {
            "title": "Chapter 1: The Door",
            "summary": "Keep this result.",
            "suggestions": ["Saved before pause."],
        }
        try:
            make_docx(docx_path)

            with (
                mock.patch("editorial_cli.cli.OpenAICompatibleClient.from_settings", return_value=object()),
                mock.patch("editorial_cli.cli.build_context_brief", return_value="context note"),
                mock.patch(
                    "editorial_cli.cli.section_suggestions",
                    side_effect=[first_suggestion, KeyboardInterrupt()],
                ),
                contextlib.redirect_stdout(io.StringIO()),
                contextlib.redirect_stderr(io.StringIO()) as stderr,
            ):
                exit_code = main([
                    "suggest",
                    str(docx_path),
                    "--run-id",
                    "pause-demo",
                    "--save-dir",
                    str(save_dir),
                    "-o",
                    str(output_path),
                    "--no-progress",
                    "--model",
                    "editor-model",
                    "--base-url",
                    "http://localhost:11434/v1",
                ])

            self.assertEqual(exit_code, 130)
            self.assertFalse(output_path.exists())
            self.assertIn("Paused analysis.", stderr.getvalue())
            partial = json.loads((save_dir / "pause-demo" / "suggestions.partial.json").read_text(encoding="utf-8"))
            self.assertEqual(partial, [first_suggestion])
            manifest = json.loads((save_dir / "pause-demo" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "paused")
            self.assertEqual(manifest["completed_sections"], 1)
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_suggest_resume_continues_from_partial_progress(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".md")
        save_dir = Path(self._testMethodName + "_runs")
        first_suggestion: Suggestion = {
            "title": "Chapter 1: The Door",
            "summary": "Already done.",
            "suggestions": ["Existing note."],
        }
        second_suggestion: Suggestion = {
            "title": "Chapter 1: The Door - Scene 2",
            "summary": "Newly resumed.",
            "suggestions": ["Fresh note."],
        }
        try:
            make_docx(docx_path)
            sections = split_document(extract_docx_parts(docx_path))
            store = RunStore(save_dir)
            run = store.start_run(docx_path.name, sections, run_id="resume-demo")
            store.save_text(run, "context_brief.md", "context note\n")
            store.save_json(run, "suggestions.partial.json", [first_suggestion])
            store.update_manifest(run, status="paused", completed_sections=1)

            with (
                mock.patch("editorial_cli.cli.OpenAICompatibleClient.from_settings", return_value=object()),
                mock.patch("editorial_cli.cli.build_context_brief") as build_context_brief,
                mock.patch("editorial_cli.cli.section_suggestions", return_value=second_suggestion) as section_suggestions,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                exit_code = main([
                    "suggest",
                    str(docx_path),
                    "--resume",
                    "resume-demo",
                    "--single-file",
                    "--save-dir",
                    str(save_dir),
                    "-o",
                    str(output_path),
                    "--no-progress",
                    "--model",
                    "editor-model",
                    "--base-url",
                    "http://localhost:11434/v1",
                ])

            self.assertEqual(exit_code, 0)
            build_context_brief.assert_not_called()
            self.assertEqual(section_suggestions.call_count, 1)
            self.assertEqual(section_suggestions.call_args.args[1].title, "Chapter 1: The Door - Scene 2")
            suggestions = json.loads((save_dir / "resume-demo" / "suggestions.json").read_text(encoding="utf-8"))
            self.assertEqual(suggestions, [first_suggestion, second_suggestion])
            self.assertIn("Existing note.", output_path.read_text(encoding="utf-8"))
            self.assertIn("Fresh note.", output_path.read_text(encoding="utf-8"))
            manifest = json.loads((save_dir / "resume-demo" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "completed")
            self.assertEqual(manifest["completed_sections"], 2)
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_missing_docx_fails_neatly_without_traceback(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = main(["outline", "missing.docx", "--no-progress", "--plain"])

        self.assertEqual(exit_code, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("Error:", stderr.getvalue())
        self.assertIn("missing.docx", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_missing_saved_run_fails_neatly_without_traceback(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = main(["show", "latest", "--save-dir", "definitely-missing-runs"])

        self.assertEqual(exit_code, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("No latest run has been saved yet.", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_invalid_config_fails_neatly_without_traceback(self) -> None:
        config_path = Path(self._testMethodName + ".toml")
        stdout = io.StringIO()
        stderr = io.StringIO()
        try:
            config_path.write_text("[llm\n", encoding="utf-8")

            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                exit_code = main(["--config", str(config_path), "doctor"])

            self.assertEqual(exit_code, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertIn("Error:", stderr.getvalue())
            self.assertIn("config", stderr.getvalue().lower())
            self.assertNotIn("Traceback", stderr.getvalue())
        finally:
            config_path.unlink(missing_ok=True)


    def test_suggest_section_filter_targets_only_matching_section(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".md")
        save_dir = Path(self._testMethodName + "_runs")
        second_suggestion: Suggestion = {
            "title": "Chapter 1: The Door - Scene 2",
            "summary": "Only this section.",
            "suggestions": ["Targeted note."],
        }
        try:
            make_docx(docx_path)

            with (
                mock.patch("editorial_cli.cli.OpenAICompatibleClient.from_settings", return_value=object()),
                mock.patch("editorial_cli.cli.build_context_brief", return_value="context note"),
                mock.patch("editorial_cli.cli.section_suggestions", return_value=second_suggestion) as section_sug,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                exit_code = main([
                    "suggest",
                    str(docx_path),
                    "--section", "2",
                    "--single-file",
                    "--run-id", "section-demo",
                    "--save-dir", str(save_dir),
                    "-o", str(output_path),
                    "--no-progress",
                    "--model", "editor-model",
                    "--base-url", "http://localhost:11434/v1",
                ])

            self.assertEqual(exit_code, 0)
            self.assertEqual(section_sug.call_count, 1)
            self.assertEqual(section_sug.call_args.args[1].index, 2)
            report = output_path.read_text(encoding="utf-8")
            self.assertIn("Targeted note.", report)
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_suggest_focus_flag_is_passed_to_section_suggestions(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        save_dir = Path(self._testMethodName + "_runs")
        suggestion: Suggestion = {"title": "Chapter 1: The Door", "summary": "x", "suggestions": []}
        try:
            make_docx(docx_path)

            with (
                mock.patch("editorial_cli.cli.OpenAICompatibleClient.from_settings", return_value=object()),
                mock.patch("editorial_cli.cli.build_context_brief", return_value="ctx"),
                mock.patch("editorial_cli.cli.section_suggestions", return_value=suggestion) as section_sug,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                main([
                    "suggest", str(docx_path),
                    "--focus", "pacing",
                    "--run-id", "focus-demo",
                    "--save-dir", str(save_dir),
                    "--no-progress", "--model", "m", "--base-url", "http://localhost/v1",
                ])

            call_kwargs = section_sug.call_args
            self.assertEqual(call_kwargs.args[5], "pacing")
        finally:
            docx_path.unlink(missing_ok=True)
            output_dir = docx_path.with_name(f"{docx_path.stem}_editorial_suggestions")
            if output_dir.exists():
                for path in sorted(output_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                output_dir.rmdir()
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_suggest_html_output_format_writes_html_file(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        output_path = Path(self._testMethodName + ".html")
        save_dir = Path(self._testMethodName + "_runs")
        try:
            make_docx(docx_path)

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = main([
                    "suggest", str(docx_path),
                    "--dry-run", "--output-format", "html",
                    "--run-id", "html-demo",
                    "--save-dir", str(save_dir),
                    "-o", str(output_path),
                    "--no-progress",
                ])

            self.assertEqual(exit_code, 0)
            html = output_path.read_text(encoding="utf-8")
            self.assertIn("<!DOCTYPE html>", html)
            self.assertIn("Editorial Suggestions", html)
            self.assertIn("Chapter 1: The Door", html)
        finally:
            docx_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()

    def test_render_html_report_produces_valid_structure(self) -> None:
        suggestions: list[Suggestion] = [
            {
                "title": "Chapter 1",
                "summary": "A beginning.",
                "suggestions": ["Cut the adverbs."],
                "style_preservation": ["Voice is strong."],
                "continuity": [],
                "line_level": [],
            }
        ]
        html = render_html_report("book.docx", "style notes here", suggestions)

        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("Chapter 1", html)
        self.assertIn("Cut the adverbs.", html)
        self.assertIn("style notes here", html)
        self.assertIn("<details", html)

    def test_render_compare_report_shows_added_removed_changed(self) -> None:
        sug1: list[Suggestion] = [
            {"title": "Chapter 1", "suggestions": ["Old note."]},
            {"title": "Chapter 2", "suggestions": ["Removed section."]},
        ]
        sug2: list[Suggestion] = [
            {"title": "Chapter 1", "suggestions": ["New note."]},
            {"title": "Chapter 3", "suggestions": ["Brand new."]},
        ]
        report = render_compare_report("run-a", "run-b", sug1, sug2)

        self.assertIn("Chapter 1", report)
        self.assertIn("- Old note.", report)
        self.assertIn("+ New note.", report)
        self.assertIn("Chapter 2", report)
        self.assertIn("removed", report)
        self.assertIn("Chapter 3", report)
        self.assertIn("new", report)

    def test_render_diff_report_identifies_structural_changes(self) -> None:
        sections1 = [
            Section(title="Chapter 1", text="Original text.", index=1),
            Section(title="Chapter 2", text="Will be removed.", index=2),
        ]
        sections2 = [
            Section(title="Chapter 1", text="Changed text.", index=1),
            Section(title="Chapter 3", text="Brand new.", index=2),
        ]
        report = render_diff_report("v1.docx", "v2.docx", sections1, sections2)

        self.assertIn("~ Chapter 1", report)
        self.assertIn("- Chapter 2", report)
        self.assertIn("+ Chapter 3", report)
        self.assertIn("1 added", report)
        self.assertIn("1 removed", report)
        self.assertIn("1 changed", report)

    def test_diff_command_compares_two_docx_files(self) -> None:
        docx1 = Path(self._testMethodName + "_v1.docx")
        docx2 = Path(self._testMethodName + "_v2.docx")
        try:
            make_docx(docx1)
            make_docx(docx2)

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main(["diff", str(docx1), str(docx2), "--no-progress"])

            self.assertEqual(exit_code, 0)
            output = stdout.getvalue()
            self.assertIn("unchanged", output)
        finally:
            docx1.unlink(missing_ok=True)
            docx2.unlink(missing_ok=True)

    def test_run_store_clean_removes_oldest_runs(self) -> None:
        base_dir = Path(self._testMethodName)
        store = RunStore(base_dir)
        sections = split_document([DocumentPart("Chapter 1", is_heading=True), DocumentPart("Text.")])
        try:
            store.start_run("book.docx", sections, run_id="run-a")
            store.start_run("book.docx", sections, run_id="run-b")

            deleted = store.clean(keep=1)

            self.assertEqual(len(deleted), 1)
            remaining = store.list_runs(limit=99)
            self.assertEqual(len(remaining), 1)
        finally:
            for path in sorted(base_dir.rglob("*"), reverse=True):
                path.unlink() if path.is_file() else path.rmdir()
            base_dir.rmdir() if base_dir.exists() else None

    def test_run_store_clean_by_status_removes_only_matching_runs(self) -> None:
        base_dir = Path(self._testMethodName)
        store = RunStore(base_dir)
        sections = split_document([DocumentPart("Chapter 1", is_heading=True), DocumentPart("Text.")])
        try:
            run_a = store.start_run("book.docx", sections, run_id="run-paused")
            store.update_manifest(run_a, status="paused")
            run_b = store.start_run("book.docx", sections, run_id="run-done")
            store.update_manifest(run_b, status="completed")

            deleted = store.clean(status="paused")

            self.assertIn("run-paused", deleted)
            self.assertNotIn("run-done", deleted)
            self.assertFalse((base_dir / "run-paused").exists())
            self.assertTrue((base_dir / "run-done").exists())
        finally:
            for path in sorted(base_dir.rglob("*"), reverse=True):
                path.unlink() if path.is_file() else path.rmdir()
            base_dir.rmdir() if base_dir.exists() else None

    def test_filter_sections_by_index(self) -> None:
        sections = [
            Section(title="Chapter 1", text="a", index=1),
            Section(title="Chapter 2", text="b", index=2),
        ]
        result = filter_sections(sections, "2")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].index, 2)

    def test_filter_sections_by_title_substring(self) -> None:
        sections = [
            Section(title="Chapter 1: The Door", text="a", index=1),
            Section(title="Chapter 2: The Key", text="b", index=2),
        ]
        result = filter_sections(sections, "door")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].title, "Chapter 1: The Door")

    def test_filter_sections_raises_on_no_match(self) -> None:
        from editorial_cli.errors import CliError
        sections = [Section(title="Chapter 1", text="a", index=1)]
        with self.assertRaises(CliError):
            filter_sections(sections, "99")

    def test_parse_args_compare_command(self) -> None:
        args = parse_args(["compare", "run-a", "run-b"])
        self.assertEqual(args.command, "compare")
        self.assertEqual(args.run1, "run-a")
        self.assertEqual(args.run2, "run-b")

    def test_parse_args_clean_command(self) -> None:
        args = parse_args(["clean", "--keep", "5", "--yes"])
        self.assertEqual(args.command, "clean")
        self.assertEqual(args.keep, 5)
        self.assertTrue(args.yes)

    def test_parse_args_watch_command(self) -> None:
        args = parse_args(["watch", "book.docx", "--interval", "10", "--focus", "pacing"])
        self.assertEqual(args.command, "watch")
        self.assertEqual(args.interval, 10)
        self.assertEqual(args.focus, "pacing")

    def test_parse_args_show_open_flag(self) -> None:
        args = parse_args(["show", "latest", "--open"])
        self.assertEqual(args.command, "show")
        self.assertTrue(args.open_after)

    def test_compare_command_writes_to_file(self) -> None:
        base_dir = Path(self._testMethodName + "_runs")
        output_path = Path(self._testMethodName + "_compare.txt")
        store = RunStore(base_dir)
        sections = split_document([DocumentPart("Chapter 1", is_heading=True), DocumentPart("Text.")])
        suggestion: Suggestion = {"title": "Chapter 1", "summary": "x", "suggestions": ["Note."]}
        try:
            run_a = store.start_run("book.docx", sections, run_id="cmp-a")
            store.save_json(run_a, "suggestions.json", [suggestion])
            run_b = store.start_run("book.docx", sections, run_id="cmp-b")
            store.save_json(run_b, "suggestions.json", [suggestion])

            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = main([
                    "compare", "cmp-a", "cmp-b",
                    "--save-dir", str(base_dir),
                    "-o", str(output_path),
                ])

            self.assertEqual(exit_code, 0)
            self.assertTrue(output_path.exists())
            content = output_path.read_text(encoding="utf-8")
            self.assertIn("cmp-a", content)
            self.assertIn("cmp-b", content)
        finally:
            output_path.unlink(missing_ok=True)
            if base_dir.exists():
                for path in sorted(base_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                base_dir.rmdir()

    def test_suggest_style_guide_flag_is_passed_to_build_context_brief(self) -> None:
        docx_path = Path(self._testMethodName + ".docx")
        style_path = Path(self._testMethodName + "_style.md")
        save_dir = Path(self._testMethodName + "_runs")
        suggestion: Suggestion = {"title": "Chapter 1: The Door", "summary": "x", "suggestions": []}
        try:
            make_docx(docx_path)
            style_path.write_text("Use active voice.", encoding="utf-8")

            with (
                mock.patch("editorial_cli.cli.OpenAICompatibleClient.from_settings", return_value=object()),
                mock.patch("editorial_cli.cli.build_context_brief", return_value="ctx") as build_ctx,
                mock.patch("editorial_cli.cli.section_suggestions", return_value=suggestion),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                main([
                    "suggest", str(docx_path),
                    "--style-guide", str(style_path),
                    "--run-id", "sg-demo",
                    "--save-dir", str(save_dir),
                    "--no-progress", "--model", "m", "--base-url", "http://localhost/v1",
                ])

            self.assertIn("Use active voice.", str(build_ctx.call_args))
        finally:
            docx_path.unlink(missing_ok=True)
            style_path.unlink(missing_ok=True)
            output_dir = docx_path.with_name(f"{docx_path.stem}_editorial_suggestions")
            if output_dir.exists():
                for path in sorted(output_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                output_dir.rmdir()
            if save_dir.exists():
                for path in sorted(save_dir.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                save_dir.rmdir()


if __name__ == "__main__":
    unittest.main()
