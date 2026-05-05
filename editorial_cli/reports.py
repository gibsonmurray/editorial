from __future__ import annotations

import datetime as dt
import json
import re

from editorial_cli.models import Section


def render_markdown_report(source_name: str, context_brief: str, suggestions: list[dict[str, object]]) -> str:
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


def render_json_report(source_name: str, context_brief: str, suggestions: list[dict[str, object]]) -> str:
    payload = {
        "source": source_name,
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "context_brief": context_brief,
        "sections": suggestions,
    }
    return json.dumps(payload, indent=2) + "\n"


def render_report(
    source_name: str,
    context_brief: str,
    suggestions: list[dict[str, object]],
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


def add_markdown_list(lines: list[str], title: str, values: object) -> None:
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
