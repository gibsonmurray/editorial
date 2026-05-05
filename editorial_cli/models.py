from __future__ import annotations

import dataclasses
from pathlib import Path


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
