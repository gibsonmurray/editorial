# Editorial CLI

A small command-line app for turning a Word manuscript into context-aware editorial suggestions.

It extracts text from a `.docx`, splits the manuscript into chapters and scenes, asks an OpenAI-compatible chat endpoint for a whole-manuscript context and style brief, then generates suggestions for each section without rewriting the prose.

## Install

From this directory:

```bash
python3 -m pip install -e .
```

That exposes the `editorial` command and installs the pretty terminal UI dependency.

## Configure

The CLI loads `.env` from the current working directory by default, and those values override shell environment variables and TOML config defaults. CLI flags still win when provided directly.

```dotenv
LLM_MODEL=gpt-4.1
OPENAI_API_KEY=...
```

Use a different dotenv file when needed:

```bash
editorial --env-file ./draft.env doctor
```

Shell environment variables also work:

```bash
export LLM_MODEL="gpt-4.1"
export OPENAI_API_KEY="..."
```

Or create `~/.config/editorial/config.toml` for non-secret defaults:

```toml
[llm]
model = "gpt-4.1"
base_url = "https://api.openai.com/v1"
api_key = "..."
```

For local OpenAI-compatible servers, omit the API key if the endpoint does not need one:

```toml
[llm]
model = "llama3.1"
base_url = "http://localhost:11434/v1"
```

## Commands

Preview how the document will be split:

```bash
editorial outline manuscript.docx
editorial outline manuscript.docx --format markdown -o outline.md
editorial outline manuscript.docx --format json -o outline.json
```

Check LLM configuration:

```bash
editorial doctor
```

Generate suggestions:

```bash
editorial suggest manuscript.docx
editorial suggest manuscript.docx -o suggestions/
```

Markdown output defaults to a directory with `index.md`, `context_brief.md`, and one numbered Markdown file per chapter or scene.

Write one combined Markdown file when needed:

```bash
editorial suggest manuscript.docx --single-file -o suggestions.md
```

Generate JSON instead of Markdown:

```bash
editorial suggest manuscript.docx --output-format json -o suggestions.json
```

Pause a live analysis with `Ctrl+C`. The current run is marked `paused`, completed section suggestions stay in `suggestions.partial.json`, and the CLI prints a resume command.

Resume a paused run:

```bash
editorial suggest manuscript.docx --resume latest
editorial suggest manuscript.docx --resume 20260505-143000-a1b2c3 --save-dir ./editorial-runs
```

Every `suggest` run is autosaved locally. By default, artifacts go to:

```text
~/.local/share/editorial/runs
```

Each run folder includes:

- `manifest.json`
- `outline.md`
- `outline.json`
- `context_brief.md` for live LLM runs
- `suggestions.partial.json` while generation is in progress
- `suggestions.json`
- `report.md`
- `report.json`

The manifest records run `status` and `completed_sections`, so interrupted analyses can be inspected before resuming.

List recent local runs:

```bash
editorial runs
editorial runs --json
```

Show a saved artifact:

```bash
editorial show latest
editorial show latest --file report.json
editorial show 20260505-143000-a1b2c3 --file outline.md
```

Use a custom save location or stable run id:

```bash
editorial suggest manuscript.docx --save-dir ./editorial-runs --run-id draft-2-pass
```

## Interface Options

The CLI uses Rich panels, status lines, progress bars, and fun facts during longer work.

For clean scripting or CI logs:

```bash
editorial suggest manuscript.docx --no-progress
editorial suggest manuscript.docx --plain
editorial suggest manuscript.docx --no-fun-facts
```

Expected operational errors fail cleanly with a short message and exit code `1`.
Use `--debug` before the subcommand when you want the full Python traceback:

```bash
editorial --debug outline manuscript.docx
```

## Project Structure

The CLI lives in the `editorial_cli` package:

- `cli.py`: command parsing and command orchestration
- `config.py`: config paths and TOML loading
- `document.py`: DOCX extraction and chapter/scene splitting
- `llm.py`: OpenAI-compatible client and editing prompts
- `reports.py`: Markdown, JSON, and outline rendering
- `runs.py`: local run folders, manifests, and saved artifacts
- `terminal_ui.py`: Rich progress UI, loading states, doctor output, and run tables
- `errors.py`: neat user-facing CLI failures

## Development Checks

Install development tools:

```bash
python3 -m pip install -e ".[dev]"
```

Run the test and type-check suite:

```bash
python3 -m unittest discover -s tests
python3 -m mypy
```

## Split Rules

The splitter treats Word heading styles and chapter-like text such as `Chapter`, `Part`, `Prologue`, and `Epilogue` as section boundaries. Scene breaks such as `***`, `* * *`, `###`, and `---` start a new scene under the current chapter.
