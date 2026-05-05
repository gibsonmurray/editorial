#!/usr/bin/env python3
"""Backward-compatible launcher for the Editorial CLI package."""

from editorial_cli import (
    DocumentPart,
    OpenAICompatibleClient,
    ProgressReporter,
    RunStore,
    Section,
    build_context_brief,
    extract_docx_parts,
    load_cli_config,
    main,
    parse_args,
    render_json_report,
    render_markdown_report,
    render_outline,
    section_suggestions,
    split_document,
)

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


if __name__ == "__main__":
    raise SystemExit(main())
