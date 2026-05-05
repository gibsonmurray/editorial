# Editorial

Editorial is a native macOS prototype for a Grammarly-like line editor that works across apps through the macOS Accessibility API.

## What works now

- A single menu bar popover with a compact sidebar and expandable review pane.
- Accessibility permission prompt and status checks.
- Focused text capture from apps that expose text through Accessibility, including many standard text fields and editors.
- AI editing through the OpenAI Responses API.
- A compact menu bar popover.
- An expandable review view with a GitHub-style original-vs-draft diff preview.
- A visible process log so users can watch capture, editing, and apply steps.
- Apply edited text back to the focused app when that app allows Accessibility writes.
- Copy fallback for apps that allow reading but block direct replacement.

## Run

```sh
cd /Users/gibsonmurray/Developer/editorial
export OPENAI_API_KEY="your-api-key"
swift run Editorial
```

Optional:

```sh
export EDITORIAL_MODEL="gpt-5.4-mini"
```

On first launch, grant Accessibility permission in System Settings. After granting permission, relaunching from the same terminal is usually the least surprising path while this is still a Swift Package prototype.

## Product direction

The next milestone is a real app bundle with:

- a global hotkey,
- text-area overlays,
- inline suggestions,
- a review queue with accept/reject actions,
- app-specific adapters for editors like Vellum when generic Accessibility behavior is limited.

## Editorial CLI

This repository also includes a Python CLI for `.docx` manuscript review. It splits a Word manuscript into chapters/scenes, builds a whole-manuscript context brief, calls an OpenAI-compatible LLM, and saves Markdown/JSON editorial suggestions with local run history.

See [CLI.md](CLI.md) for install, configuration, and command usage.
