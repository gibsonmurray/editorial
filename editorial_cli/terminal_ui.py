from __future__ import annotations

import json
import os
import shutil
import sys
from typing import TextIO

from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskID, TaskProgressColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from editorial_cli.config import DEFAULT_SAVE_DIR, config_string, config_table, env_string
from editorial_cli.models import JsonObject
from editorial_cli.protocols import DoctorArgs, InterfaceArgs


FUN_FACTS = [
    "Revision rewards specificity.",
    "A scene usually turns on a changed desire, decision, or danger.",
    "Line edits work best after continuity is stable.",
    "Repeated images become motifs when they evolve.",
    "A quiet cut can make a loud sentence land harder.",
    "Readers forgive mystery faster than confusion.",
]


class ProgressReporter:
    def __init__(
        self,
        enabled: bool = True,
        fun_facts: bool = True,
        stream: TextIO | None = None,
        facts: list[str] | None = None,
        pretty: bool | None = None,
    ) -> None:
        self.enabled = enabled
        self.fun_facts = fun_facts
        self.stream = stream or sys.stderr
        self.facts = facts or FUN_FACTS
        self._fact_index = 0
        self._rich_console: Console | None = None
        self._rich_progress: Progress | None = None
        self._rich_tasks: dict[str, TaskID] = {}
        self._fact_line_active = False
        self._fact_line_width = 0
        if pretty is None:
            pretty = bool(getattr(self.stream, "isatty", lambda: False)())
        if enabled and pretty:
            self._rich_console = Console(file=self.stream)

    def banner(self, title: str, subtitle: str = "") -> None:
        if not self.enabled:
            return
        self._finish_fact_line()
        if self._rich_console:
            body = subtitle or "Context-aware manuscript suggestions"
            self._rich_console.print(Panel(body, title=f"[bold cyan]{title}[/bold cyan]", border_style="cyan"))
            return
        self._write(f"{title}\n{subtitle}".strip())

    def start(self, message: str) -> None:
        if not self.enabled:
            return
        self._finish_fact_line()
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
            self._finish_fact_line()
            self._ensure_rich_progress()
            task_id = self._rich_tasks.get(message)
            progress = self._rich_progress
            if progress is None:
                raise RuntimeError("Progress UI was not initialized.")
            if task_id is None:
                task_id = progress.add_task(message, total=total)
                self._rich_tasks[message] = task_id
            progress.update(task_id, completed=completed)
            if completed >= total:
                progress.stop_task(task_id)
            return
        percent = int((completed / total) * 100)
        filled = int((completed / total) * 20)
        bar = "#" * filled + "-" * (20 - filled)
        self._write(f"{message} [{bar}] {percent}% ({completed}/{total})")

    def finish(self, message: str) -> None:
        if not self.enabled:
            return
        self._finish_fact_line()
        progress = self._rich_progress
        if progress:
            progress.stop()
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
        self._replace_fact_line(f"Fun fact: {fact}")

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
        self._finish_fact_line()
        print(text, file=self.stream)

    def _replace_fact_line(self, text: str) -> None:
        padding = " " * max(self._fact_line_width - len(text), 0)
        self.stream.write(f"\r{text}{padding}")
        self.stream.flush()
        self._fact_line_active = True
        self._fact_line_width = len(text)

    def _finish_fact_line(self) -> None:
        if not self._fact_line_active:
            return
        self.stream.write("\n")
        self.stream.flush()
        self._fact_line_active = False
        self._fact_line_width = 0


def make_reporter(args: InterfaceArgs) -> ProgressReporter:
    return ProgressReporter(
        enabled=not getattr(args, "no_progress", False),
        fun_facts=not getattr(args, "no_fun_facts", False),
        pretty=not getattr(args, "plain", False),
    )


def render_runs(runs: list[JsonObject], as_json: bool = False) -> str:
    if as_json:
        return json.dumps(runs, indent=2)
    if not runs:
        return "No saved editorial runs yet."
    if sys.stdout.isatty():
        console = Console()
        table = Table(title="Saved Editorial Runs")
        table.add_column("Run")
        table.add_column("Source")
        table.add_column("Started")
        table.add_column("Status")
        table.add_column("Sections", justify="right")
        for item in runs:
            table.add_row(
                str(item.get("id", "")),
                str(item.get("source", "")),
                str(item.get("started_at", "")),
                str(item.get("status", "")),
                str(item.get("section_count", "")),
            )
        with console.capture() as capture:
            console.print(table)
        return capture.get().rstrip()
    lines = ["Saved editorial runs:"]
    for item in runs:
        lines.append(
            f"- {item.get('id')} | {item.get('source')} | "
            f"{item.get('section_count')} sections | {item.get('status', 'unknown')} | {item.get('started_at')}"
        )
    return "\n".join(lines)


def render_doctor_report(args: DoctorArgs, config: JsonObject, dotenv: dict[str, str] | None = None) -> str:
    dotenv = dotenv or {}
    llm_config = config_table(config, "llm")
    model = (
        args.model
        or env_string(dotenv, "LLM_MODEL")
        or config_string(llm_config, "model")
        or os.environ.get("LLM_MODEL")
    )
    base_url = (
        args.base_url
        or env_string(dotenv, "LLM_BASE_URL")
        or env_string(dotenv, "OPENAI_BASE_URL")
        or config_string(llm_config, "base_url")
        or os.environ.get("LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    api_key = (
        args.api_key
        or env_string(dotenv, "LLM_API_KEY")
        or env_string(dotenv, "OPENAI_API_KEY")
        or config_string(llm_config, "api_key")
        or os.environ.get("LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    lines = [
        "Editorial CLI doctor",
        f"config: {args.config}",
        f"env file: {args.env_file}",
        f"model: {model or 'not configured'}",
        f"endpoint: {base_url}",
        f"api key: {'configured' if api_key else 'not configured'}",
        "rich ui: available",
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
