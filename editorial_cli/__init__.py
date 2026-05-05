"""Editorial CLI package."""

from editorial_cli.cli import main, parse_args
from editorial_cli.config import load_cli_config
from editorial_cli.document import DocumentPart, Section, extract_docx_parts, split_document
from editorial_cli.llm import OpenAICompatibleClient, build_context_brief, section_suggestions
from editorial_cli.reports import render_json_report, render_markdown_report, render_outline
from editorial_cli.runs import RunStore
from editorial_cli.terminal_ui import ProgressReporter

__all__ = [
    "DocumentPart",
    "OpenAICompatibleClient",
    "ProgressReporter",
    "RunStore",
    "Section",
    "build_context_brief",
    "extract_docx_parts",
    "load_cli_config",
    "main",
    "parse_args",
    "render_json_report",
    "render_markdown_report",
    "render_outline",
    "section_suggestions",
    "split_document",
]
