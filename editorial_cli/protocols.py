from __future__ import annotations

from pathlib import Path
from typing import Protocol


class InterfaceArgs(Protocol):
    no_progress: bool
    no_fun_facts: bool
    plain: bool


class LLMArgs(Protocol):
    model: str | None
    base_url: str | None
    api_key: str | None
    timeout: int


class DoctorArgs(LLMArgs, Protocol):
    config: Path
    save_dir: Path
