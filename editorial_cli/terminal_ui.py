from __future__ import annotations

import json
import os
import shutil
import sys

from editorial_cli.config import DEFAULT_SAVE_DIR

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
    Table = None


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


def make_reporter(args) -> ProgressReporter:
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


def render_doctor_report(args, config: dict[str, object]) -> str:
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
