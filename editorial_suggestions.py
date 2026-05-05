#!/usr/bin/env python3
"""Generate chapter/scene-level editorial suggestions for a DOCX manuscript.

The script extracts text from a Word document, splits it into chapters and
scenes, asks an OpenAI-compatible chat endpoint for a whole-manuscript context
brief, then asks for focused suggestions for each section.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import re
import shutil
import sys
import textwrap
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11 fallback.
    tomllib = None

TOML_DECODE_ERROR = tomllib.TOMLDecodeError if tomllib else ValueError

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn, TimeElapsedColumn
    from rich.table import Table
except ModuleNotFoundError:  # pragma: no cover - plain fallback remains supported.
    Console = None
    Panel = None
    Progress = None
    SpinnerColumn = None
    TextColumn = None
    BarColumn = None
    TaskProgressColumn = None
    TimeElapsedColumn = None


WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CHAPTER_RE = re.compile(r"^\s*(chapter|prologue|epilogue|part)\b", re.IGNORECASE)
SCENE_BREAK_RE = re.compile(r"^\s*(?:[*#~]\s*){3,}$|^\s*-{3,}\s*$")
DEFAULT_CONFIG_PATH = Path.home() / ".config" / "editorial" / "config.toml"
DEFAULT_SAVE_DIR = Path.home() / ".local" / "share" / "editorial" / "runs"
COMMANDS = {"suggest", "outline", "doctor", "runs", "show"}
FUN_FACTS = [
    "Revision rewards specificity.",
    "A scene usually turns on a changed desire, decision, or danger.",
    "Line edits work best after continuity is stable.",
    "Repeated images become motifs when they evolve.",
    "A quiet cut can make a loud sentence land harder.",
    "Readers forgive mystery faster than confusion.",
]


@dataclasses.dataclass(frozen=True)
class DocumentPart:
    text: str
    is_heading: bool = False
    style: str | None = None


@dataclasses.dataclass(frozen=True)
class Section:
    title: str
    text: str
    index: int


@dataclasses.dataclass(frozen=True)
class RunRecord:
    id: str
    path: Path
    source: str
    started_at: str


class LLMError(RuntimeError):
    pass


class CliError(RuntimeError):
    pass


class ProgressReporter:
    def __init__(
        self,
        enabled: bool = True,
        fun_facts: bool = True,
        stream=None,
        facts: list[str] | None = None,
        pretty: bool | None = None,
    ) -> None:
        self.enabled = enabled
        self.fun_facts = fun_facts
        self.stream = stream or sys.stderr
        self.facts = facts or FUN_FACTS
        self._fact_index = 0
        self._rich_console = None
        self._rich_progress = None
        self._rich_tasks: dict[str, int] = {}
        if pretty is None:
            pretty = bool(getattr(self.stream, "isatty", lambda: False)())
        if enabled and pretty and Console and Progress:
            self._rich_console = Console(file=self.stream)

    def banner(self, title: str, subtitle: str = "") -> None:
        if not self.enabled:
            return
        if self._rich_console and Panel:
            body = subtitle or "Context-aware manuscript suggestions"
            self._rich_console.print(Panel(body, title=f"[bold cyan]{title}[/bold cyan]", border_style="cyan"))
            return
        self._write(f"{title}\n{subtitle}".strip())

    def start(self, message: str) -> None:
        if not self.enabled:
            return
        if self._rich_console:
            self._rich_console.print(f"[bold cyan]•[/bold cyan] {message}")
        else:
            self._write(message)
        self.show_fact()

    def advance(self, message: str, completed: int, total: int) -> None:
        if not self.enabled:
            return
        total = max(total, 1)
        completed = min(max(completed, 0), total)
        if self._rich_console:
            self._ensure_rich_progress()
            task_id = self._rich_tasks.get(message)
            if task_id is None:
                task_id = self._rich_progress.add_task(message, total=total)
                self._rich_tasks[message] = task_id
            self._rich_progress.update(task_id, completed=completed)
            if completed >= total:
                self._rich_progress.stop_task(task_id)
            return
        percent = int((completed / total) * 100)
        filled = int((completed / total) * 20)
        bar = "#" * filled + "-" * (20 - filled)
        self._write(f"{message} [{bar}] {percent}% ({completed}/{total})")

    def finish(self, message: str) -> None:
        if not self.enabled:
            return
        if self._rich_progress:
            self._rich_progress.stop()
            self._rich_progress = None
        if self._rich_console:
            self._rich_console.print(f"[bold green]✓[/bold green] {message}")
        else:
            self._write(message)

    def show_fact(self) -> None:
        if not self.enabled or not self.fun_facts or not self.facts:
            return
        fact = self.facts[self._fact_index % len(self.facts)]
        self._fact_index += 1
        if self._rich_console:
            self._rich_console.print(f"[dim]Fun fact: {fact}[/dim]")
        else:
            self._write(f"Fun fact: {fact}")

    def _ensure_rich_progress(self) -> None:
        if self._rich_progress:
            return
        self._rich_progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=self._rich_console,
            transient=False,
        )
        self._rich_progress.start()

    def _write(self, text: str) -> None:
        print(text, file=self.stream)


class RunStore:
    def __init__(self, base_dir: Path = DEFAULT_SAVE_DIR) -> None:
        self.base_dir = base_dir

    def start_run(self, source: str, sections: list[Section], run_id: str | None = None) -> RunRecord:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        now = dt.datetime.now().replace(microsecond=0).isoformat()
        run_id = run_id or f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        run_path = self.base_dir / safe_filename(run_id)
        run_path.mkdir(parents=True, exist_ok=False)
        record = RunRecord(id=run_path.name, path=run_path, source=source, started_at=now)
        manifest = {
            "id": record.id,
            "source": source,
            "started_at": now,
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
        self.save_json(record, "manifest.json", manifest)
        self.save_text(record, "outline.md", render_outline(source, sections, "markdown"))
        self.save_json(record, "outline.json", json.loads(render_outline(source, sections, "json")))
        (self.base_dir / "latest.txt").write_text(record.id + "\n", encoding="utf-8")
        return record

    def save_text(self, run: RunRecord, name: str, content: str) -> Path:
        path = run.path / name
        path.write_text(content, encoding="utf-8")
        return path

    def save_json(self, run: RunRecord, name: str, payload: object) -> Path:
        return self.save_text(run, name, json.dumps(payload, indent=2) + "\n")

    def load_json(self, run_id: str, name: str) -> object:
        return json.loads((self.resolve_run(run_id) / name).read_text(encoding="utf-8"))

    def resolve_run(self, run_id: str) -> Path:
        if run_id == "latest":
            pointer = self.base_dir / "latest.txt"
            if not pointer.exists():
                raise FileNotFoundError("No latest run has been saved yet.")
            run_id = pointer.read_text(encoding="utf-8").strip()
        return self.base_dir / safe_filename(run_id)

    def list_runs(self, limit: int = 10) -> list[dict[str, object]]:
        if not self.base_dir.exists():
            return []
        manifests: list[dict[str, object]] = []
        for manifest_path in self.base_dir.glob("*/manifest.json"):
            try:
                manifests.append(json.loads(manifest_path.read_text(encoding="utf-8")))
            except json.JSONDecodeError:
                continue
        manifests.sort(key=lambda item: str(item.get("started_at", "")), reverse=True)
        return manifests[:limit]


class OpenAICompatibleClient:
    def __init__(
        self,
        model: str,
        base_url: str = "https://api.openai.com/v1",
        api_key: str | None = None,
        timeout: int = 120,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    @classmethod
    def from_settings(cls, args: argparse.Namespace, config: dict[str, object]) -> "OpenAICompatibleClient":
        llm_config = dict(config.get("llm", {})) if isinstance(config.get("llm"), dict) else {}
        model = args.model or llm_config.get("model") or os.environ.get("LLM_MODEL")
        if not model:
            raise LLMError("Set --model or LLM_MODEL before calling the LLM.")

        base_url = (
            args.base_url
            or llm_config.get("base_url")
            or os.environ.get("LLM_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or "https://api.openai.com/v1"
        )
        api_key = (
            args.api_key
            or llm_config.get("api_key")
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )
        if not api_key and "localhost" not in base_url and "127.0.0.1" not in base_url:
            raise LLMError("Set --api-key, LLM_API_KEY, or OPENAI_API_KEY for non-local LLM endpoints.")

        return cls(model=model, base_url=base_url, api_key=api_key, timeout=args.timeout)

    @classmethod
    def from_env(cls, args: argparse.Namespace) -> "OpenAICompatibleClient":
        return cls.from_settings(args, {})

    def chat(self, messages: list[dict[str, str]], temperature: float = 0.25) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise LLMError(f"LLM request failed with HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise LLMError(f"Could not reach LLM endpoint: {exc}") from exc

        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Unexpected LLM response shape: {data}") from exc


def extract_docx_parts(path: Path) -> list[DocumentPart]:
    if path.suffix.lower() != ".docx":
        raise CliError("Only .docx files are supported.")

    try:
        with zipfile.ZipFile(path) as docx:
            document_xml = docx.read("word/document.xml")
    except KeyError as exc:
        raise CliError(f"{path} does not look like a valid Word document.") from exc

    root = ElementTree.fromstring(document_xml)
    parts: list[DocumentPart] = []
    for paragraph in root.findall(".//w:body/w:p", WORD_NS):
        text = paragraph_text(paragraph)
        if not text:
            continue
        style = paragraph_style(paragraph)
        is_heading = is_heading_style(style) or bool(CHAPTER_RE.match(text))
        parts.append(DocumentPart(text=text, is_heading=is_heading, style=style))
    return parts


def paragraph_style(paragraph: ElementTree.Element) -> str | None:
    style = paragraph.find("./w:pPr/w:pStyle", WORD_NS)
    if style is None:
        return None
    return style.attrib.get(f"{{{WORD_NS['w']}}}val")


def paragraph_text(paragraph: ElementTree.Element) -> str:
    chunks: list[str] = []
    for node in paragraph.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag in {"t", "instrText"} and node.text:
            chunks.append(node.text)
        elif tag == "tab":
            chunks.append("\t")
        elif tag in {"br", "cr"}:
            chunks.append("\n")
    return "".join(chunks).strip()


def is_heading_style(style: str | None) -> bool:
    if not style:
        return False
    normalized = re.sub(r"[\s_-]+", "", style).lower()
    return normalized.startswith("heading")


def is_scene_break(text: str) -> bool:
    stripped = text.strip()
    return stripped in {"***", "* * *", "#", "###", "- - -"} or bool(SCENE_BREAK_RE.match(stripped))


def split_document(parts: Iterable[DocumentPart]) -> list[Section]:
    sections: list[Section] = []
    current_title = "Scene 1"
    current_chapter = "Scene"
    current_paragraphs: list[str] = []
    scene_number = 1

    def flush() -> None:
        nonlocal current_paragraphs
        text = "\n\n".join(current_paragraphs).strip()
        if text:
            sections.append(Section(title=current_title, text=text, index=len(sections) + 1))
        current_paragraphs = []

    for part in parts:
        if part.is_heading:
            flush()
            current_chapter = part.text
            current_title = part.text
            scene_number = 1
            continue

        if is_scene_break(part.text):
            flush()
            scene_number += 1
            current_title = f"{current_chapter} - Scene {scene_number}"
            continue

        current_paragraphs.append(part.text)

    flush()
    return sections


def chunk_text(text: str, max_chars: int) -> list[str]:
    paragraphs = [para.strip() for para in text.split("\n\n") if para.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for paragraph in paragraphs:
        if current and current_len + len(paragraph) + 2 > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(paragraph)
        current_len += len(paragraph) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text[:max_chars]]


def build_context_brief(
    client: OpenAICompatibleClient,
    sections: list[Section],
    max_chars: int,
    reporter: ProgressReporter | None = None,
) -> str:
    full_text = "\n\n".join(f"{section.title}\n{section.text}" for section in sections)
    chunks = chunk_text(full_text, max_chars)

    chunk_briefs: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        if reporter:
            reporter.advance("Building context brief", index - 1, len(chunks))
        chunk_briefs.append(
            client.chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are an expert fiction editor. Produce compact notes that preserve plot, "
                            "character arcs, recurring motifs, unresolved questions, and authorial style."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Manuscript chunk {index} of {len(chunks)}:\n\n{chunk}\n\n"
                            "Return concise notes under these headings: Plot/Continuity, Characters, "
                            "World/Setting, Authorial Style, Craft Patterns."
                        ),
                    },
                ]
            )
        )
        if reporter:
            reporter.advance("Building context brief", index, len(chunks))

    if len(chunk_briefs) == 1:
        return chunk_briefs[0]

    return client.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are an expert fiction editor synthesizing manuscript notes into a reusable "
                    "context brief for later section-level critique."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Merge these chunk notes into one compact whole-manuscript context and style brief. "
                    "Keep continuity facts, major arcs, authorial habits, and revision-sensitive style notes.\n\n"
                    + "\n\n---\n\n".join(chunk_briefs)
                ),
            },
        ]
    )


def section_suggestions(
    client: OpenAICompatibleClient,
    section: Section,
    sections: list[Section],
    context_brief: str,
    max_section_chars: int,
) -> dict[str, object]:
    previous_title = sections[section.index - 2].title if section.index > 1 else "None"
    next_title = sections[section.index].title if section.index < len(sections) else "None"
    section_text = section.text[:max_section_chars]
    truncated = "\n\n[Section text truncated for prompt budget.]" if len(section.text) > max_section_chars else ""

    prompt = f"""
Whole-manuscript context and authorial style brief:
{context_brief}

Current section: {section.title}
Previous section: {previous_title}
Next section: {next_title}

Section text:
{section_text}{truncated}

Give editorial suggestions for improving the text already written. Do not rewrite the scene.
Respond in JSON with this shape:
{{
  "summary": "one sentence",
  "suggestions": ["specific actionable note", "..."],
  "style_preservation": ["note about preserving or strengthening the author's style"],
  "continuity": ["context-aware continuity or setup/payoff note"],
  "line_level": ["optional sentence-level craft note"]
}}
"""
    raw = client.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a rigorous but tactful developmental and line editor. "
                    "Respect the author's existing voice and focus on suggestions, not replacement prose. "
                    "Return valid JSON only."
                ),
            },
            {"role": "user", "content": textwrap.dedent(prompt).strip()},
        ]
    )
    parsed = parse_json_response(raw)
    parsed["title"] = section.title
    return parsed


def parse_json_response(raw: str) -> dict[str, object]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = {"summary": "", "suggestions": [raw], "style_preservation": [], "continuity": [], "line_level": []}
    return data


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


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned or "run"


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


def load_cli_config(path: Path | None = None) -> dict[str, object]:
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        return {}
    if tomllib is None:
        raise RuntimeError("TOML config files require Python 3.11 or newer.")
    with config_path.open("rb") as file:
        return tomllib.load(file)


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


def friendly_error_message(exc: BaseException) -> str:
    if isinstance(exc, FileNotFoundError):
        if getattr(exc, "filename", None):
            return f"Could not find: {exc.filename}"
        return str(exc)
    if isinstance(exc, FileExistsError):
        if getattr(exc, "filename", None):
            return f"That saved run already exists: {exc.filename}"
        return str(exc)
    if isinstance(exc, PermissionError):
        if getattr(exc, "filename", None):
            return f"Permission denied: {exc.filename}"
        return "Permission denied."
    if isinstance(exc, zipfile.BadZipFile):
        return "Could not read the DOCX. Make sure the file is a valid .docx document."
    if isinstance(exc, ElementTree.ParseError):
        return "Could not parse the DOCX document XML."
    if isinstance(exc, TOML_DECODE_ERROR):
        return f"Could not parse config file: {exc}"
    message = str(exc).strip()
    return message or exc.__class__.__name__


def print_error(message: str) -> None:
    if Console and sys.stderr.isatty():
        Console(file=sys.stderr).print(Panel(message, title="[bold red]Error[/bold red]", border_style="red"))
    else:
        print(f"Error: {message}", file=sys.stderr)


def load_sections(docx: Path) -> list[Section]:
    parts = extract_docx_parts(docx)
    sections = split_document(parts)
    if not sections:
        raise CliError("No manuscript text was found after splitting the document.")
    return sections


def run_suggest(args: argparse.Namespace, config: dict[str, object]) -> int:
    reporter = make_reporter(args)
    reporter.banner("Editorial", "Context-aware revision suggestions")
    reporter.start("Reading manuscript")
    parts = extract_docx_parts(args.docx)
    sections = split_document(parts)
    if not sections:
        raise CliError("No manuscript text was found after splitting the document.")
    reporter.finish(f"Found {len(sections)} sections")

    store = RunStore(args.save_dir)
    run = store.start_run(args.docx.name, sections, args.run_id)
    reporter.start(f"Saving run artifacts to {run.path}")

    suffix = "json" if args.output_format == "json" else "md"
    output = args.output or args.docx.with_name(f"{args.docx.stem}_editorial_suggestions.{suffix}")

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

    suggestions: list[dict[str, object]] = []
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


def render_report(
    source_name: str,
    context_brief: str,
    suggestions: list[dict[str, object]],
    output_format: str,
) -> str:
    if output_format == "json":
        return render_json_report(source_name, context_brief, suggestions)
    return render_markdown_report(source_name, context_brief, suggestions)


def make_reporter(args: argparse.Namespace) -> ProgressReporter:
    return ProgressReporter(
        enabled=not getattr(args, "no_progress", False),
        fun_facts=not getattr(args, "no_fun_facts", False),
        pretty=not getattr(args, "plain", False),
    )


def render_runs(runs: list[dict[str, object]], as_json: bool = False) -> str:
    if as_json:
        return json.dumps(runs, indent=2)
    if not runs:
        return "No saved editorial runs yet."
    if Console and Table and sys.stdout.isatty():
        console = Console()
        table = Table(title="Saved Editorial Runs")
        table.add_column("Run")
        table.add_column("Source")
        table.add_column("Started")
        table.add_column("Sections", justify="right")
        for item in runs:
            table.add_row(
                str(item.get("id", "")),
                str(item.get("source", "")),
                str(item.get("started_at", "")),
                str(item.get("section_count", "")),
            )
        with console.capture() as capture:
            console.print(table)
        return capture.get().rstrip()
    lines = ["Saved editorial runs:"]
    for item in runs:
        lines.append(
            f"- {item.get('id')} | {item.get('source')} | "
            f"{item.get('section_count')} sections | {item.get('started_at')}"
        )
    return "\n".join(lines)


def render_doctor_report(args: argparse.Namespace, config: dict[str, object]) -> str:
    llm_config = dict(config.get("llm", {})) if isinstance(config.get("llm"), dict) else {}
    model = args.model or llm_config.get("model") or os.environ.get("LLM_MODEL")
    base_url = (
        args.base_url
        or llm_config.get("base_url")
        or os.environ.get("LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    api_key = (
        args.api_key
        or llm_config.get("api_key")
        or os.environ.get("LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    lines = [
        "Editorial CLI doctor",
        f"config: {args.config}",
        f"model: {model or 'not configured'}",
        f"endpoint: {base_url}",
        f"api key: {'configured' if api_key else 'not configured'}",
        f"rich ui: {'available' if Console else 'not installed'}",
        f"save dir: {getattr(args, 'save_dir', DEFAULT_SAVE_DIR)}",
        f"terminal width: {shutil.get_terminal_size((80, 20)).columns}",
    ]
    if not model:
        lines.append("status: missing model; set --model, LLM_MODEL, or [llm].model in config")
    elif not api_key and "localhost" not in str(base_url) and "127.0.0.1" not in str(base_url):
        lines.append("status: missing API key for non-local endpoint")
    else:
        lines.append("status: ready")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
