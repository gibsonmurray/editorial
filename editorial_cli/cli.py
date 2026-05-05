from __future__ import annotations

import argparse
import datetime as dt
import shlex
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import cast
from xml.etree import ElementTree

from editorial_cli.config import (
    DEFAULT_CONFIG_PATH,
    DEFAULT_DOTENV_PATH,
    DEFAULT_SAVE_DIR,
    TOML_DECODE_ERROR,
    load_cli_config,
    load_dotenv_file,
)
from editorial_cli.document import extract_docx_parts, split_document
from editorial_cli.errors import CliError, LLMError, friendly_error_message, print_error
from editorial_cli.llm import OpenAICompatibleClient, build_context_brief, section_suggestions
from editorial_cli.models import JsonObject, RunRecord, Section, Suggestion
from editorial_cli.reports import (
    render_compare_report,
    render_diff_report,
    render_json_report,
    render_markdown_report,
    render_outline,
    render_report,
    write_docx_report,
    write_markdown_report_directory,
)
from editorial_cli.runs import RunStore
from editorial_cli.terminal_ui import make_reporter, render_doctor_report, render_runs


COMMANDS = {"suggest", "outline", "doctor", "runs", "show", "compare", "diff", "watch", "chat", "clean"}


def normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return argv
    if any(arg in COMMANDS for arg in argv):
        return argv
    first = argv[0]
    if first.startswith("-"):
        return argv
    return ["suggest", *argv]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="editorial", description="Editorial assistant CLI for DOCX manuscripts.")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help=f"TOML config path. Defaults to {DEFAULT_CONFIG_PATH}.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_DOTENV_PATH,
        help=f"Dotenv file path. Defaults to {DEFAULT_DOTENV_PATH}. Values override shell env and config.",
    )
    parser.add_argument("--debug", action="store_true", help="Show Python tracebacks for unexpected failures.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    suggest = subparsers.add_parser(
        "suggest",
        help="Generate context-aware editorial suggestions for every chapter or scene.",
    )
    add_docx_argument(suggest)
    suggest.add_argument("-o", "--output", type=Path, help="Output file or directory path.")
    suggest.add_argument(
        "--output-format",
        choices=("markdown", "json", "html", "docx"),
        default="markdown",
        help="Primary report format.",
    )
    add_llm_arguments(suggest)
    add_interface_arguments(suggest)
    suggest.add_argument(
        "--max-context-chars",
        type=int,
        default=45000,
        help="Maximum characters per context-brief LLM call.",
    )
    suggest.add_argument(
        "--max-section-chars",
        type=int,
        default=30000,
        help="Maximum characters from an individual section sent for critique.",
    )
    suggest.add_argument("--dry-run", action="store_true", help="Parse and split the document without calling an LLM.")
    suggest.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory for autosaved run artifacts.")
    suggest.add_argument("--run-id", help="Optional stable run id for saved artifacts.")
    suggest.add_argument("--resume", help="Resume a paused saved run id. Use 'latest' for the most recent run.")
    suggest.add_argument(
        "--single-file",
        action="store_true",
        help="Write Markdown suggestions as one combined file instead of the default directory of section files.",
    )
    suggest.add_argument(
        "--section",
        help="Only generate suggestions for one section. Accepts a section index (1-based) or a title substring.",
    )
    suggest.add_argument(
        "--focus",
        help="Editorial lens to apply (e.g. 'pacing', 'dialogue', 'show don\\'t tell'). Injected into every LLM prompt.",
    )
    suggest.add_argument(
        "--style-guide",
        type=Path,
        dest="style_guide",
        help="Path to a Markdown or plain-text house style guide. Injected into context and section prompts.",
    )

    outline = subparsers.add_parser("outline", help="Preview chapter/scene splits without calling an LLM.")
    add_docx_argument(outline)
    add_interface_arguments(outline)
    outline.add_argument("-o", "--output", type=Path, help="Output path. Defaults to stdout.")
    outline.add_argument(
        "--format",
        choices=("text", "markdown", "json"),
        default="text",
        help="Outline output format.",
    )

    doctor = subparsers.add_parser("doctor", help="Show LLM configuration and endpoint readiness.")
    add_llm_arguments(doctor)
    doctor.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory for autosaved run artifacts.")

    runs = subparsers.add_parser("runs", help="List recent saved editorial runs.")
    runs.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory containing saved runs.")
    runs.add_argument("--limit", type=int, default=10, help="Maximum runs to show.")
    runs.add_argument("--json", action="store_true", help="Print run history as JSON.")

    show = subparsers.add_parser("show", help="Show a saved run artifact.")
    show.add_argument("run_id", nargs="?", default="latest", help="Run id to inspect. Defaults to latest.")
    show.add_argument(
        "--file",
        default="report.md",
        help="Artifact filename inside the run, such as report.md, report.json, outline.md, or manifest.json.",
    )
    show.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory containing saved runs.")
    show.add_argument("--open", action="store_true", dest="open_after", help="Open the artifact in the system default app.")

    compare = subparsers.add_parser("compare", help="Compare suggestions between two saved runs.")
    compare.add_argument("run1", help="First run id (or 'latest').")
    compare.add_argument("run2", help="Second run id.")
    compare.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory containing saved runs.")
    compare.add_argument("-o", "--output", type=Path, help="Write comparison to a file instead of stdout.")
    compare.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Comparison output format.",
    )

    diff = subparsers.add_parser("diff", help="Compare the structure of two manuscript drafts without calling an LLM.")
    diff.add_argument("docx1", type=Path, help="First (older) manuscript .docx.")
    diff.add_argument("docx2", type=Path, help="Second (newer) manuscript .docx.")
    diff.add_argument("-o", "--output", type=Path, help="Write diff to a file instead of stdout.")
    diff.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Diff output format.",
    )
    add_interface_arguments(diff)

    watch = subparsers.add_parser("watch", help="Re-run suggestions automatically whenever the manuscript file changes.")
    add_docx_argument(watch)
    watch.add_argument("-o", "--output", type=Path, help="Output file or directory path (overwritten on each change).")
    watch.add_argument(
        "--output-format",
        choices=("markdown", "json", "html", "docx"),
        default="markdown",
        help="Output format.",
    )
    add_llm_arguments(watch)
    add_interface_arguments(watch)
    watch.add_argument("--interval", type=int, default=5, help="Polling interval in seconds (default: 5).")
    watch.add_argument(
        "--max-context-chars",
        type=int,
        default=45000,
        help="Maximum characters per context-brief LLM call.",
    )
    watch.add_argument(
        "--max-section-chars",
        type=int,
        default=30000,
        help="Maximum characters from an individual section sent for critique.",
    )
    watch.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory for autosaved run artifacts.")
    watch.add_argument("--section", help="Only watch a specific section (index or title substring).")
    watch.add_argument("--focus", help="Editorial lens to apply on every pass.")
    watch.add_argument("--style-guide", type=Path, dest="style_guide", help="Path to a house style guide.")

    chat = subparsers.add_parser("chat", help="Ask follow-up questions about a saved run's suggestions.")
    chat.add_argument("run_id", nargs="?", default="latest", help="Run id to chat about. Defaults to latest.")
    chat.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory containing saved runs.")
    add_llm_arguments(chat)

    clean = subparsers.add_parser("clean", help="Delete old saved runs, keeping the N most recent.")
    clean.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE_DIR, help="Directory containing saved runs.")
    clean.add_argument("--keep", type=int, default=10, help="Number of most-recent runs to keep (default: 10).")
    clean.add_argument(
        "--status",
        choices=("paused", "running", "completed"),
        help="Delete only runs with this status instead of pruning by age.",
    )
    clean.add_argument("--yes", action="store_true", help="Skip confirmation prompt.")

    return parser.parse_args(normalize_argv(argv))


def add_docx_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("docx", type=Path, help="Path to the input .docx manuscript.")


def add_llm_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--model", help="LLM model name. Can also be set with LLM_MODEL or config [llm].model.")
    parser.add_argument(
        "--base-url",
        help="OpenAI-compatible base URL. Defaults to config [llm].base_url, LLM_BASE_URL, or OpenAI.",
    )
    parser.add_argument("--api-key", help="API key. Defaults to config [llm].api_key, LLM_API_KEY, or OPENAI_API_KEY.")
    parser.add_argument("--timeout", type=int, default=120, help="LLM request timeout in seconds.")


def add_interface_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--no-progress", action="store_true", help="Disable loading states and progress bars.")
    parser.add_argument("--no-fun-facts", action="store_true", help="Disable fun facts during longer work.")
    parser.add_argument("--plain", action="store_true", help="Use plain terminal output instead of rich styling.")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.debug:
        return run_command(args)
    try:
        return run_command(args)
    except KeyboardInterrupt:
        print_error("Interrupted. No further changes were made.")
        return 130
    except (
        CliError,
        LLMError,
        TOML_DECODE_ERROR,
        FileExistsError,
        FileNotFoundError,
        PermissionError,
        zipfile.BadZipFile,
        ElementTree.ParseError,
        OSError,
    ) as exc:
        print_error(friendly_error_message(exc))
        return 1


def run_command(args: argparse.Namespace) -> int:
    config = load_cli_config(args.config)
    dotenv = load_dotenv_file(args.env_file)
    if args.command == "doctor":
        print(render_doctor_report(args, config, dotenv))
        return 0

    if args.command == "runs":
        print(render_runs(RunStore(args.save_dir).list_runs(args.limit), as_json=args.json))
        return 0

    if args.command == "show":
        path = RunStore(args.save_dir).resolve_run(args.run_id) / args.file
        text = path.read_text(encoding="utf-8")
        print(text, end="")
        if args.open_after:
            _open_path(path)
        return 0

    if args.command == "outline":
        reporter = make_reporter(args)
        reporter.banner("Editorial", "Reading manuscript structure")
        reporter.start("Splitting chapters and scenes")
        sections = load_sections(args.docx)
        reporter.finish(f"Found {len(sections)} sections")
        rendered = render_outline(args.docx.name, sections, args.format)
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
            print(f"Wrote outline to {args.output}")
        else:
            print(rendered, end="")
        return 0

    if args.command == "compare":
        return run_compare(args)

    if args.command == "diff":
        return run_diff(args)

    if args.command == "watch":
        return run_watch(args, config, dotenv)

    if args.command == "chat":
        return run_chat(args, config, dotenv)

    if args.command == "clean":
        return run_clean(args)

    return run_suggest(args, config, dotenv)


# ── helpers ──────────────────────────────────────────────────────────────────

def load_sections(docx: Path) -> list[Section]:
    parts = extract_docx_parts(docx)
    sections = split_document(parts)
    if not sections:
        raise CliError("No manuscript text was found after splitting the document.")
    return sections


def filter_sections(sections: list[Section], selector: str) -> list[Section]:
    try:
        idx = int(selector)
        matches = [s for s in sections if s.index == idx]
    except ValueError:
        lower = selector.lower()
        matches = [s for s in sections if lower in s.title.lower()]
    if not matches:
        raise CliError(
            f"No section matched {selector!r}. "
            f"Use 'editorial outline' to see available sections."
        )
    return matches


def load_style_guide(path: Path | None) -> str | None:
    if path is None:
        return None
    if not path.exists():
        raise CliError(f"Style guide file not found: {path}")
    return path.read_text(encoding="utf-8").strip() or None


def _open_path(path: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    elif sys.platform == "win32":
        subprocess.run(["start", "", str(path)], shell=True, check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


# ── suggest ───────────────────────────────────────────────────────────────────

def run_suggest(args: argparse.Namespace, config: JsonObject, dotenv: dict[str, str]) -> int:
    if args.resume and args.run_id:
        raise CliError("--resume cannot be combined with --run-id.")
    if args.resume and args.dry_run:
        raise CliError("--resume cannot be combined with --dry-run.")

    style_guide = load_style_guide(getattr(args, "style_guide", None))
    focus: str | None = getattr(args, "focus", None)
    section_selector: str | None = getattr(args, "section", None)

    reporter = make_reporter(args)
    reporter.banner("Editorial", "Context-aware revision suggestions")
    reporter.start("Reading manuscript")
    all_sections = load_sections(args.docx)
    target_sections = filter_sections(all_sections, section_selector) if section_selector else all_sections
    reporter.finish(f"Found {len(all_sections)} sections" + (f" (targeting {len(target_sections)})" if section_selector else ""))

    store = RunStore(args.save_dir)
    if args.resume:
        run = store.resume_run(args.resume)
        validate_resume_sections(store, run, all_sections)
        store.update_manifest(run, status="running")
        reporter.start(f"Resuming saved run {run.id} from {run.path}")
    else:
        run = store.start_run(args.docx.name, all_sections, args.run_id)
        reporter.start(f"Saving run artifacts to {run.path}")

    output = resolve_suggest_output(args)

    suggestions: list[Suggestion]
    if args.dry_run:
        suggestions = [
            {
                "title": section.title,
                "summary": f"{len(section.text)} characters",
                "suggestions": [],
            }
            for section in target_sections
        ]
        context_brief = f"Dry run only. Found {len(all_sections)} sections."
        store.save_text(run, "report.md", render_markdown_report(args.docx.name, context_brief, suggestions))
        store.save_text(run, "report.json", render_json_report(args.docx.name, context_brief, suggestions))
        store.update_manifest(
            run,
            status="completed",
            completed_sections=len(suggestions),
            completed_at=dt.datetime.now().replace(microsecond=0).isoformat(),
        )
        write_suggest_output(args, output, context_brief, suggestions)
        reporter.finish(f"Wrote dry-run report to {output}")
        print(f"Wrote dry-run section report to {output}")
        print(f"Saved local run to {run.path}")
        return 0

    client = OpenAICompatibleClient.from_settings(args, config, dotenv)
    suggestions = load_partial_suggestions(store, run) if args.resume else []
    already_done_titles = {str(s.get("title", "")) for s in suggestions}
    pending_sections = [s for s in target_sections if s.title not in already_done_titles]

    try:
        context_path = run.path / "context_brief.md"
        if args.resume and context_path.exists():
            reporter.start("Loading saved whole-manuscript context")
            context_brief = context_path.read_text(encoding="utf-8").strip()
        else:
            reporter.start("Building whole-manuscript context")
            context_brief = build_context_brief(client, all_sections, args.max_context_chars, reporter, style_guide)
            store.save_text(run, "context_brief.md", context_brief + "\n")

        if len(suggestions) > len(all_sections):
            raise CliError("Saved run has more partial suggestions than the current document has sections.")
        for index, suggestion in enumerate(suggestions):
            if isinstance(suggestion.get("title"), str) and suggestion["title"] != all_sections[index].title:
                raise CliError("Saved partial suggestions do not match this document's current section order.")

        total = len(pending_sections)
        for done, section in enumerate(pending_sections):
            reporter.advance("Generating section suggestions", done, total)
            suggestion = section_suggestions(
                client, section, all_sections, context_brief, args.max_section_chars, focus, style_guide
            )
            suggestions.append(suggestion)
            store.save_json(run, "suggestions.partial.json", suggestions)
            store.update_manifest(run, status="running", completed_sections=len(suggestions))
            reporter.show_fact()
            reporter.advance("Generating section suggestions", done + 1, total)
    except KeyboardInterrupt:
        store.save_json(run, "suggestions.partial.json", suggestions)
        store.update_manifest(
            run,
            status="paused",
            completed_sections=len(suggestions),
            paused_at=dt.datetime.now().replace(microsecond=0).isoformat(),
        )
        print_error(
            "Paused analysis. Resume with: "
            f"editorial suggest {shlex.quote(str(args.docx))} --resume {shlex.quote(run.id)} "
            f"--save-dir {shlex.quote(str(args.save_dir))}"
        )
        return 130

    store.save_json(run, "suggestions.json", suggestions)
    markdown_report = render_markdown_report(args.docx.name, context_brief, suggestions)
    json_report = render_json_report(args.docx.name, context_brief, suggestions)
    store.save_text(run, "report.md", markdown_report)
    store.save_text(run, "report.json", json_report)
    store.update_manifest(
        run,
        status="completed",
        completed_sections=len(suggestions),
        completed_at=dt.datetime.now().replace(microsecond=0).isoformat(),
    )
    write_suggest_output(args, output, context_brief, suggestions)
    reporter.finish(f"Wrote editorial suggestions to {output}")
    print(f"Wrote editorial suggestions to {output}")
    print(f"Saved local run to {run.path}")
    return 0


def resolve_suggest_output(args: argparse.Namespace) -> Path:
    output = cast(Path | None, args.output)
    docx = cast(Path, args.docx)
    if output:
        return output
    fmt = getattr(args, "output_format", "markdown")
    if fmt == "json":
        return docx.with_name(f"{docx.stem}_editorial_suggestions.json")
    if fmt == "html":
        return docx.with_name(f"{docx.stem}_editorial_suggestions.html")
    if fmt == "docx":
        return docx.with_name(f"{docx.stem}_editorial_suggestions.docx")
    if getattr(args, "single_file", False):
        return docx.with_name(f"{docx.stem}_editorial_suggestions.md")
    return docx.with_name(f"{docx.stem}_editorial_suggestions")


def write_suggest_output(
    args: argparse.Namespace,
    output: Path,
    context_brief: str,
    suggestions: list[Suggestion],
) -> Path:
    fmt = getattr(args, "output_format", "markdown")
    if fmt == "json":
        output.write_text(render_report(args.docx.name, context_brief, suggestions, "json"), encoding="utf-8")
        return output
    if fmt == "html":
        output.write_text(render_report(args.docx.name, context_brief, suggestions, "html"), encoding="utf-8")
        return output
    if fmt == "docx":
        write_docx_report(output, args.docx.name, context_brief, suggestions)
        return output
    if getattr(args, "single_file", False):
        output.write_text(render_report(args.docx.name, context_brief, suggestions, "markdown"), encoding="utf-8")
        return output
    return write_markdown_report_directory(output, args.docx.name, context_brief, suggestions)


def validate_resume_sections(store: RunStore, run: RunRecord, sections: list[Section]) -> None:
    manifest = store.load_manifest(run)
    manifest_count = manifest.get("section_count")
    if isinstance(manifest_count, int) and manifest_count != len(sections):
        raise CliError(
            f"Saved run expects {manifest_count} sections, but the current document has {len(sections)} sections."
        )
    manifest_sections = manifest.get("sections")
    if not isinstance(manifest_sections, list):
        return
    for index, manifest_section in enumerate(manifest_sections):
        if index >= len(sections) or not isinstance(manifest_section, dict):
            continue
        title = manifest_section.get("title")
        if isinstance(title, str) and title != sections[index].title:
            raise CliError("Saved run section outline does not match this document.")


def load_partial_suggestions(store: RunStore, run: RunRecord) -> list[Suggestion]:
    partial_path = run.path / "suggestions.partial.json"
    if not partial_path.exists():
        return []
    payload = store.load_json(run.id, "suggestions.partial.json")
    if not isinstance(payload, list):
        raise CliError("Saved partial suggestions are not a JSON list.")
    suggestions: list[Suggestion] = []
    for item in payload:
        if not isinstance(item, dict):
            raise CliError("Saved partial suggestions contain a non-object item.")
        suggestions.append(item)
    return suggestions


# ── compare ───────────────────────────────────────────────────────────────────

def run_compare(args: argparse.Namespace) -> int:
    store = RunStore(args.save_dir)
    id1 = store.resolve_run(args.run1).name
    id2 = store.resolve_run(args.run2).name

    raw1 = store.load_json(id1, "suggestions.json")
    raw2 = store.load_json(id2, "suggestions.json")
    if not isinstance(raw1, list) or not isinstance(raw2, list):
        raise CliError("Both runs must have a completed suggestions.json artifact.")
    sug1 = cast(list[Suggestion], raw1)
    sug2 = cast(list[Suggestion], raw2)

    rendered = render_compare_report(id1, id2, sug1, sug2, output_format=args.format)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
        print(f"Wrote comparison to {args.output}")
    else:
        print(rendered, end="")
    return 0


# ── diff ──────────────────────────────────────────────────────────────────────

def run_diff(args: argparse.Namespace) -> int:
    reporter = make_reporter(args)
    reporter.banner("Editorial", "Structural manuscript diff")
    reporter.start(f"Reading {args.docx1.name}")
    sections1 = load_sections(args.docx1)
    reporter.start(f"Reading {args.docx2.name}")
    sections2 = load_sections(args.docx2)
    reporter.finish(f"Comparing {len(sections1)} vs {len(sections2)} sections")

    rendered = render_diff_report(args.docx1.name, args.docx2.name, sections1, sections2, output_format=args.format)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
        print(f"Wrote diff to {args.output}")
    else:
        print(rendered, end="")
    return 0


# ── watch ─────────────────────────────────────────────────────────────────────

def run_watch(args: argparse.Namespace, config: JsonObject, dotenv: dict[str, str]) -> int:
    reporter = make_reporter(args)
    reporter.banner("Editorial", f"Watching {args.docx.name} every {args.interval}s")
    last_mtime: float | None = None
    run_count = 0

    while True:
        try:
            mtime = args.docx.stat().st_mtime
        except FileNotFoundError:
            reporter.start(f"Waiting for {args.docx.name} to appear…")
            time.sleep(args.interval)
            continue

        if mtime == last_mtime:
            time.sleep(args.interval)
            continue

        last_mtime = mtime
        run_count += 1
        reporter.start(f"Change detected (pass {run_count}), generating suggestions…")

        style_guide = load_style_guide(getattr(args, "style_guide", None))
        focus: str | None = getattr(args, "focus", None)
        section_selector: str | None = getattr(args, "section", None)

        try:
            all_sections = load_sections(args.docx)
            target_sections = filter_sections(all_sections, section_selector) if section_selector else all_sections

            watch_run_id = f"watch-{args.docx.stem}"
            store = RunStore(args.save_dir)
            run = store.start_run(args.docx.name, all_sections, watch_run_id)

            client = OpenAICompatibleClient.from_settings(args, config, dotenv)
            context_brief = build_context_brief(client, all_sections, args.max_context_chars, reporter, style_guide)
            store.save_text(run, "context_brief.md", context_brief + "\n")

            suggestions: list[Suggestion] = []
            total = len(target_sections)
            for done, section in enumerate(target_sections):
                reporter.advance("Generating section suggestions", done, total)
                sug = section_suggestions(
                    client, section, all_sections, context_brief, args.max_section_chars, focus, style_guide
                )
                suggestions.append(sug)
                reporter.advance("Generating section suggestions", done + 1, total)

            output = resolve_suggest_output(args)
            write_suggest_output(args, output, context_brief, suggestions)
            store.update_manifest(
                run,
                status="completed",
                completed_sections=len(suggestions),
                completed_at=dt.datetime.now().replace(microsecond=0).isoformat(),
            )
            reporter.finish(f"Pass {run_count} complete → {output}")
            print(f"[watch] Pass {run_count} written to {output}")
        except (CliError, LLMError) as exc:
            print_error(f"Pass {run_count} failed: {exc}")

        time.sleep(args.interval)


# ── chat ──────────────────────────────────────────────────────────────────────

def run_chat(args: argparse.Namespace, config: JsonObject, dotenv: dict[str, str]) -> int:
    store = RunStore(args.save_dir)
    run_path = store.resolve_run(args.run_id)

    context_path = run_path / "context_brief.md"
    suggestions_path = run_path / "suggestions.json"

    if not context_path.exists():
        raise CliError(f"No context brief found in run {args.run_id}. Run 'editorial suggest' first.")
    if not suggestions_path.exists():
        raise CliError(f"No suggestions found in run {args.run_id}. Run 'editorial suggest' to completion first.")

    context_brief = context_path.read_text(encoding="utf-8").strip()
    raw_suggestions = store.load_json(run_path.name, "suggestions.json")
    suggestions_text = ""
    if isinstance(raw_suggestions, list):
        parts = []
        for item in raw_suggestions:
            if isinstance(item, dict):
                title = str(item.get("title", "Untitled"))
                notes = item.get("suggestions") or []
                if isinstance(notes, list):
                    parts.append(f"**{title}**\n" + "\n".join(f"- {n}" for n in notes if n))
        suggestions_text = "\n\n".join(parts)

    system_prompt = (
        f"You are a helpful editorial assistant. The writer is asking follow-up questions about "
        f"the editorial suggestions for their manuscript.\n\n"
        f"Whole-manuscript context brief:\n{context_brief}\n\n"
        f"Editorial suggestions by section:\n{suggestions_text}\n\n"
        f"Answer concisely and specifically. Do not repeat suggestions verbatim unless asked."
    )

    client = OpenAICompatibleClient.from_settings(args, config, {})
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    print(f"Chatting about run: {run_path.name}")
    print("Type your question, or Ctrl+D / 'exit' to quit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except EOFError:
            print()
            break
        if not user_input or user_input.lower() in {"exit", "quit"}:
            break
        messages.append({"role": "user", "content": user_input})
        try:
            response = client.chat(messages)
        except LLMError as exc:
            print_error(str(exc))
            messages.pop()
            continue
        messages.append({"role": "assistant", "content": response})
        print(f"\nEditorial: {response}\n")

    return 0


# ── clean ─────────────────────────────────────────────────────────────────────

def run_clean(args: argparse.Namespace) -> int:
    store = RunStore(args.save_dir)
    all_runs = store.list_runs(limit=99999)

    if args.status:
        candidates = [r for r in all_runs if str(r.get("status", "")) == args.status]
        description = f"all '{args.status}' runs"
    else:
        candidates = all_runs[args.keep:]
        description = f"runs beyond the {args.keep} most recent"

    if not candidates:
        print(f"Nothing to delete ({description}).")
        return 0

    print(f"Will delete {len(candidates)} run(s) ({description}):")
    for r in candidates:
        print(f"  {r.get('id')}  {r.get('status')}  {r.get('started_at')}")

    if not args.yes:
        try:
            answer = input("Delete? [y/N] ").strip().lower()
        except EOFError:
            answer = ""
        if answer not in {"y", "yes"}:
            print("Aborted.")
            return 0

    deleted = store.clean(keep=args.keep, status=args.status)
    print(f"Deleted {len(deleted)} run(s).")
    return 0
