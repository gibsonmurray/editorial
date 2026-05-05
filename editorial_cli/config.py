from __future__ import annotations

import tomllib
from pathlib import Path
from typing import cast

from editorial_cli.models import JsonObject, JsonValue


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "editorial" / "config.toml"
DEFAULT_SAVE_DIR = Path.home() / ".local" / "share" / "editorial" / "runs"
TOML_DECODE_ERROR = tomllib.TOMLDecodeError


def load_cli_config(path: Path | None = None) -> JsonObject:
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        return {}
    with config_path.open("rb") as file:
        return cast(JsonObject, tomllib.load(file))


def config_table(config: JsonObject, key: str) -> JsonObject:
    value = config.get(key)
    if not isinstance(value, dict):
        return {}
    return value


def config_string(config: JsonObject, key: str) -> str | None:
    value: JsonValue = config.get(key)
    return value if isinstance(value, str) else None
