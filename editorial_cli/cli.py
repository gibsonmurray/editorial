from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from editorial_cli.config import DEFAULT_CONFIG_PATH, DEFAULT_SAVE_DIR, TOML_DECODE_ERROR, load_cli_config
from editorial_cli.document import extract_docx_parts, split_document
from editorial_cli.errors import CliError, LLMError, friendly_error_message, print_error
from editorial_cli.llm import OpenAICompatibleClient, build_context_brief, section_suggestions
from editorial_cli.models import JsonObject, Section, Suggestion
from editorial_cli.reports import render_json_report, render_markdown_report, render_outline, render_report
from editorial_cli.runs import RunStore
from editorial_cli.terminal_ui import make_reporter, render_doctor_report, render_runs


COMMANDS = {"suggest", "outline", "doctor", "runs", "show"}


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
    parser.add_argument("--debug", action="store_true", help="Show Python tracebacks for unexpected failures.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    suggest = subparsers.add_parser(
        "suggest",
        help="Generate context-aware editorial suggestions for every chapter or scene.",
    )
    add_docx_argument(suggest)
    suggest.add_argument("-o", "--output", type=Path, help="Markdown output path.")
    suggest.add_argument(
        "--output-format",
        choices=("markdown", "json"),
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
    if args.command == "doctor":
        print(render_doctor_report(args, config))
        return 0

    if args.command == "runs":
        print(render_runs(RunStore(args.save_dir).list_runs(args.limit), as_json=args.json))
        return 0

    if args.command == "show":
        path = RunStore(args.save_dir).resolve_run(args.run_id) / args.file
        print(path.read_text(encoding="utf-8"), end="")
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

    return run_suggest(args, config)


def load_sections(docx: Path) -> list[Section]:
    parts = extract_docx_parts(docx)
    sections = split_document(parts)
    if not sections:
        raise CliError("No manuscript text was found after splitting the document.")
    return sections


def run_suggest(args: argparse.Namespace, config: JsonObject) -> int:
    reporter = make_reporter(args)
    reporter.banner("Editorial", "Context-aware revision suggestions")
    reporter.start("Reading manuscript")
    sections = load_sections(args.docx)
    reporter.finish(f"Found {len(sections)} sections")

    store = RunStore(args.save_dir)
    run = store.start_run(args.docx.name, sections, args.run_id)
    reporter.start(f"Saving run artifacts to {run.path}")

    suffix = "json" if args.output_format == "json" else "md"
    output = args.output or args.docx.with_name(f"{args.docx.stem}_editorial_suggestions.{suffix}")

    suggestions: list[Suggestion]
    if args.dry_run:
        suggestions = [
            {
                "title": section.title,
                "summary": f"{len(section.text)} characters",
                "suggestions": [],
            }
            for section in sections
        ]
        context_brief = f"Dry run only. Found {len(sections)} sections."
        report = render_report(args.docx.name, context_brief, suggestions, args.output_format)
        store.save_text(run, "report.md", render_markdown_report(args.docx.name, context_brief, suggestions))
        store.save_text(run, "report.json", render_json_report(args.docx.name, context_brief, suggestions))
        output.write_text(report, encoding="utf-8")
        reporter.finish(f"Wrote dry-run report to {output}")
        print(f"Wrote dry-run section report to {output}")
        print(f"Saved local run to {run.path}")
        return 0

    client = OpenAICompatibleClient.from_settings(args, config)
    reporter.start("Building whole-manuscript context")
    context_brief = build_context_brief(client, sections, args.max_context_chars, reporter)
    store.save_text(run, "context_brief.md", context_brief + "\n")

    suggestions = []
    for section in sections:
        reporter.advance("Generating section suggestions", section.index - 1, len(sections))
        suggestion = section_suggestions(client, section, sections, context_brief, args.max_section_chars)
        suggestions.append(suggestion)
        store.save_json(run, "suggestions.partial.json", suggestions)
        reporter.show_fact()
        reporter.advance("Generating section suggestions", section.index, len(sections))

    store.save_json(run, "suggestions.json", suggestions)
    markdown_report = render_markdown_report(args.docx.name, context_brief, suggestions)
    json_report = render_json_report(args.docx.name, context_brief, suggestions)
    store.save_text(run, "report.md", markdown_report)
    store.save_text(run, "report.json", json_report)
    output.write_text(render_report(args.docx.name, context_brief, suggestions, args.output_format), encoding="utf-8")
    reporter.finish(f"Wrote editorial suggestions to {output}")
    print(f"Wrote editorial suggestions to {output}")
    print(f"Saved local run to {run.path}")
    return 0
