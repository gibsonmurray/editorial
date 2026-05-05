from __future__ import annotations

import datetime as dt
import json
import re
import uuid
from pathlib import Path
from typing import cast

from editorial_cli.config import DEFAULT_SAVE_DIR
from editorial_cli.models import JsonObject, JsonValue, RunRecord, Section
from editorial_cli.reports import preview_text, render_outline


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
        manifest: JsonObject = {
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

    def load_json(self, run_id: str, name: str) -> JsonValue:
        return cast(JsonValue, json.loads((self.resolve_run(run_id) / name).read_text(encoding="utf-8")))

    def resolve_run(self, run_id: str) -> Path:
        if run_id == "latest":
            pointer = self.base_dir / "latest.txt"
            if not pointer.exists():
                raise FileNotFoundError("No latest run has been saved yet.")
            run_id = pointer.read_text(encoding="utf-8").strip()
        return self.base_dir / safe_filename(run_id)

    def list_runs(self, limit: int = 10) -> list[JsonObject]:
        if not self.base_dir.exists():
            return []
        manifests: list[JsonObject] = []
        for manifest_path in self.base_dir.glob("*/manifest.json"):
            try:
                manifests.append(cast(JsonObject, json.loads(manifest_path.read_text(encoding="utf-8"))))
            except json.JSONDecodeError:
                continue
        manifests.sort(key=lambda item: str(item.get("started_at", "")), reverse=True)
        return manifests[:limit]


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned or "run"
