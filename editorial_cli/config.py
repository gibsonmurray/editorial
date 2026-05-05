from __future__ import annotations

from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11 fallback.
    tomllib = None


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "editorial" / "config.toml"
DEFAULT_SAVE_DIR = Path.home() / ".local" / "share" / "editorial" / "runs"
TOML_DECODE_ERROR = tomllib.TOMLDecodeError if tomllib else ValueError


def load_cli_config(path: Path | None = None) -> dict[str, object]:
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        return {}
    if tomllib is None:
        raise RuntimeError("TOML config files require Python 3.11 or newer.")
    with config_path.open("rb") as file:
        return tomllib.load(file)
