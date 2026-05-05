from __future__ import annotations

import sys
import zipfile
from xml.etree import ElementTree

from editorial_cli.config import TOML_DECODE_ERROR

try:
    from rich.console import Console
    from rich.panel import Panel
except ModuleNotFoundError:  # pragma: no cover - plain fallback remains supported.
    Console = None
    Panel = None


class CliError(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


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
    if Console and Panel and sys.stderr.isatty():
        Console(file=sys.stderr).print(Panel(message, title="[bold red]Error[/bold red]", border_style="red"))
    else:
        print(f"Error: {message}", file=sys.stderr)
