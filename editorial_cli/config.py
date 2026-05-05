from __future__ import annotations

import tomllib
from pathlib import Path
from typing import cast

from editorial_cli.models import JsonObject, JsonValue


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "editorial" / "config.toml"
DEFAULT_DOTENV_PATH = Path(".env")
DEFAULT_SAVE_DIR = Path.home() / ".local" / "share" / "editorial" / "runs"
TOML_DECODE_ERROR = tomllib.TOMLDecodeError


def load_cli_config(path: Path | None = None) -> JsonObject:
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        return {}
    with config_path.open("rb") as file:
        return cast(JsonObject, tomllib.load(file))


def load_dotenv_file(path: Path | None = None) -> dict[str, str]:
    env_path = path or DEFAULT_DOTENV_PATH
    if not env_path.exists():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key_value = parse_dotenv_line(line)
        if key_value is None:
            continue
        key, value = key_value
        values[key] = value
    return values


def parse_dotenv_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].lstrip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key:
        return None
    return key, clean_dotenv_value(value)


def clean_dotenv_value(value: str) -> str:
    stripped = value.strip()
    if len(stripped) >= 2 and stripped[0] == stripped[-1] and stripped[0] in {"'", '"'}:
        return stripped[1:-1]
    if " #" in stripped:
        return stripped.split(" #", 1)[0].rstrip()
    return stripped


def config_table(config: JsonObject, key: str) -> JsonObject:
    value = config.get(key)
    if not isinstance(value, dict):
        return {}
    return value


def config_string(config: JsonObject, key: str) -> str | None:
    value: JsonValue = config.get(key)
    return value if isinstance(value, str) else None


def env_string(dotenv: dict[str, str], key: str) -> str | None:
    value = dotenv.get(key)
    return value if value else None
