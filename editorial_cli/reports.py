from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

from editorial_cli.models import JsonValue, Section, Suggestion


def render_markdown_report(source_name: str, context_brief: str, suggestions: list[Suggestion]) -> str:
    lines = [
        f"# Editorial Suggestions for {source_name}",
        "",
        f"Generated: {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "## Whole-Manuscript Context and Style Brief",
        "",
    ]
    lines.extend(f"> {line}" if line else ">" for line in context_brief.splitlines())
    lines.append("")

    for item in suggestions:
        lines.extend(["", f"## {item.get('title', 'Untitled Section')}", ""])
        summary = str(item.get("summary") or "").strip()
        if summary:
            lines.extend(["**Summary:** " + summary, ""])
        add_markdown_list(lines, "Suggestions", item.get("suggestions"))
        add_markdown_list(lines, "Style Preservation", item.get("style_preservation"))
        add_markdown_list(lines, "Continuity", item.get("continuity"))
        add_markdown_list(lines, "Line-Level Notes", item.get("line_level"))

    return "\n".join(lines).strip() + "\n"


def render_json_report(source_name: str, context_brief: str, suggestions: list[Suggestion]) -> str:
    payload = {
        "source": source_name,
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "context_brief": context_brief,
        "sections": suggestions,
    }
    return json.dumps(payload, indent=2) + "\n"


def render_markdown_section_report(source_name: str, suggestion: Suggestion) -> str:
    title = str(suggestion.get("title") or "Untitled Section").strip() or "Untitled Section"
    lines = [
        f"# {title}",
        "",
        f"Source: {source_name}",
        "",
    ]
    summary = str(suggestion.get("summary") or "").strip()
    if summary:
        lines.extend(["**Summary:** " + summary, ""])
    add_markdown_list(lines, "Suggestions", suggestion.get("suggestions"))
    add_markdown_list(lines, "Style Preservation", suggestion.get("style_preservation"))
    add_markdown_list(lines, "Continuity", suggestion.get("continuity"))
    add_markdown_list(lines, "Line-Level Notes", suggestion.get("line_level"))
    return "\n".join(lines).strip() + "\n"


def render_markdown_index(source_name: str, suggestions: list[Suggestion], filenames: list[str]) -> str:
    lines = [
        f"# Editorial Suggestions for {source_name}",
        "",
        f"Generated: {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "## Files",
        "",
        "- [Whole-Manuscript Context and Style Brief](context_brief.md)",
    ]
    for suggestion, filename in zip(suggestions, filenames, strict=False):
        title = str(suggestion.get("title") or "Untitled Section").strip() or "Untitled Section"
        lines.append(f"- [{title}]({filename})")
    return "\n".join(lines).strip() + "\n"


def write_markdown_report_directory(
    output_dir: Path,
    source_name: str,
    context_brief: str,
    suggestions: list[Suggestion],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filenames = section_report_filenames(suggestions)
    (output_dir / "context_brief.md").write_text(render_context_brief(context_brief), encoding="utf-8")
    (output_dir / "index.md").write_text(render_markdown_index(source_name, suggestions, filenames), encoding="utf-8")
    for suggestion, filename in zip(suggestions, filenames, strict=False):
        (output_dir / filename).write_text(render_markdown_section_report(source_name, suggestion), encoding="utf-8")
    return output_dir


def render_context_brief(context_brief: str) -> str:
    lines = ["# Whole-Manuscript Context and Style Brief", ""]
    lines.extend(context_brief.splitlines())
    return "\n".join(lines).strip() + "\n"


def section_report_filenames(suggestions: list[Suggestion]) -> list[str]:
    seen: dict[str, int] = {}
    filenames: list[str] = []
    for index, suggestion in enumerate(suggestions, start=1):
        title = str(suggestion.get("title") or "untitled-section")
        slug = slugify_filename(title)
        seen[slug] = seen.get(slug, 0) + 1
        suffix = f"-{seen[slug]}" if seen[slug] > 1 else ""
        filenames.append(f"{index:03d}-{slug}{suffix}.md")
    return filenames


def render_report(
    source_name: str,
    context_brief: str,
    suggestions: list[Suggestion],
    output_format: str,
) -> str:
    if output_format == "json":
        return render_json_report(source_name, context_brief, suggestions)
    return render_markdown_report(source_name, context_brief, suggestions)


def render_outline(source_name: str, sections: list[Section], output_format: str = "text") -> str:
    if output_format == "json":
        payload = {
            "source": source_name,
            "section_count": len(sections),
            "sections": [
                {
                    "index": section.index,
                    "title": section.title,
                    "characters": len(section.text),
                    "preview": preview_text(section.text),
                }
                for section in sections
            ],
        }
        return json.dumps(payload, indent=2) + "\n"

    if output_format == "markdown":
        lines = ["# Manuscript Outline", "", f"Source: {source_name}", "", f"Sections: {len(sections)}", ""]
        for section in sections:
            lines.extend(
                [
                    f"## {section.index}. {section.title}",
                    "",
                    f"- Characters: {len(section.text)}",
                    f"- Preview: {preview_text(section.text)}",
                    "",
                ]
            )
        return "\n".join(lines).strip() + "\n"

    width = max([len(section.title) for section in sections] + [5])
    lines = [f"Manuscript outline for {source_name}", f"Sections: {len(sections)}", ""]
    for section in sections:
        lines.append(
            f"{section.index:>3}. {section.title:<{width}}  "
            f"{len(section.text):>7} chars  {preview_text(section.text)}"
        )
    return "\n".join(lines).strip() + "\n"


def preview_text(text: str, limit: int = 120) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def slugify_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or "untitled-section"


def add_markdown_list(lines: list[str], title: str, values: JsonValue) -> None:
    if not values:
        return
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    if not cleaned:
        return
    lines.extend([f"**{title}:**", ""])
    lines.extend(f"- {value}" for value in cleaned)
    lines.append("")
