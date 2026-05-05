from __future__ import annotations

import json
import os
import re
import textwrap
import urllib.error
import urllib.request
from typing import cast

from editorial_cli.config import config_string, config_table, env_string
from editorial_cli.errors import LLMError
from editorial_cli.models import JsonObject, Suggestion, Section
from editorial_cli.terminal_ui import ProgressReporter
from editorial_cli.protocols import LLMArgs


class OpenAICompatibleClient:
    def __init__(
        self,
        model: str,
        base_url: str = "https://api.openai.com/v1",
        api_key: str | None = None,
        timeout: int = 120,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    @classmethod
    def from_settings(
        cls,
        args: LLMArgs,
        config: JsonObject,
        dotenv: dict[str, str] | None = None,
    ) -> "OpenAICompatibleClient":
        dotenv = dotenv or {}
        llm_config = config_table(config, "llm")
        model = (
            args.model
            or env_string(dotenv, "LLM_MODEL")
            or config_string(llm_config, "model")
            or os.environ.get("LLM_MODEL")
        )
        if not model:
            raise LLMError("Set --model or LLM_MODEL before calling the LLM.")

        base_url = (
            args.base_url
            or env_string(dotenv, "LLM_BASE_URL")
            or env_string(dotenv, "OPENAI_BASE_URL")
            or config_string(llm_config, "base_url")
            or os.environ.get("LLM_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or "https://api.openai.com/v1"
        )
        api_key = (
            args.api_key
            or env_string(dotenv, "LLM_API_KEY")
            or env_string(dotenv, "OPENAI_API_KEY")
            or config_string(llm_config, "api_key")
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )
        if not api_key and "localhost" not in base_url and "127.0.0.1" not in base_url:
            raise LLMError("Set --api-key, LLM_API_KEY, or OPENAI_API_KEY for non-local LLM endpoints.")

        return cls(model=model, base_url=base_url, api_key=api_key, timeout=args.timeout)

    @classmethod
    def from_env(cls, args: LLMArgs) -> "OpenAICompatibleClient":
        return cls.from_settings(args, {})

    def chat(self, messages: list[dict[str, str]], temperature: float = 0.25) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = cast(JsonObject, json.loads(response.read().decode("utf-8")))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise LLMError(f"LLM request failed with HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise LLMError(f"Could not reach LLM endpoint: {exc}") from exc

        try:
            choices = data["choices"]
            if not isinstance(choices, list) or not choices:
                raise TypeError("missing choices")
            first_choice = choices[0]
            if not isinstance(first_choice, dict):
                raise TypeError("invalid choice")
            message = first_choice["message"]
            if not isinstance(message, dict):
                raise TypeError("invalid message")
            content = message["content"]
            if not isinstance(content, str):
                raise TypeError("invalid content")
            return content.strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Unexpected LLM response shape: {data}") from exc


def chunk_text(text: str, max_chars: int) -> list[str]:
    paragraphs = [para.strip() for para in text.split("\n\n") if para.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for paragraph in paragraphs:
        if current and current_len + len(paragraph) + 2 > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(paragraph)
        current_len += len(paragraph) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text[:max_chars]]


def build_context_brief(
    client: OpenAICompatibleClient,
    sections: list[Section],
    max_chars: int,
    reporter: ProgressReporter | None = None,
    style_guide: str | None = None,
) -> str:
    full_text = "\n\n".join(f"{section.title}\n{section.text}" for section in sections)
    chunks = chunk_text(full_text, max_chars)
    style_block = f"\n\nHouse style guide to apply:\n{style_guide}" if style_guide else ""

    chunk_briefs: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        if reporter:
            reporter.advance("Building context brief", index - 1, len(chunks))
        chunk_briefs.append(
            client.chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are an expert fiction editor. Produce compact notes that preserve plot, "
                            "character arcs, recurring motifs, unresolved questions, and authorial style."
                            + style_block
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Manuscript chunk {index} of {len(chunks)}:\n\n{chunk}\n\n"
                            "Return concise notes under these headings: Plot/Continuity, Characters, "
                            "World/Setting, Authorial Style, Craft Patterns."
                        ),
                    },
                ]
            )
        )
        if reporter:
            reporter.advance("Building context brief", index, len(chunks))

    if len(chunk_briefs) == 1:
        return chunk_briefs[0]

    return client.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are an expert fiction editor synthesizing manuscript notes into a reusable "
                    "context brief for later section-level critique."
                    + style_block
                ),
            },
            {
                "role": "user",
                "content": (
                    "Merge these chunk notes into one compact whole-manuscript context and style brief. "
                    "Keep continuity facts, major arcs, authorial habits, and revision-sensitive style notes.\n\n"
                    + "\n\n---\n\n".join(chunk_briefs)
                ),
            },
        ]
    )


def section_suggestions(
    client: OpenAICompatibleClient,
    section: Section,
    sections: list[Section],
    context_brief: str,
    max_section_chars: int,
    focus: str | None = None,
    style_guide: str | None = None,
) -> Suggestion:
    previous_title = sections[section.index - 2].title if section.index > 1 else "None"
    next_title = sections[section.index].title if section.index < len(sections) else "None"
    section_text = section.text[:max_section_chars]
    truncated = "\n\n[Section text truncated for prompt budget.]" if len(section.text) > max_section_chars else ""
    focus_note = f"\n\nEditorial focus for this pass: {focus}" if focus else ""
    style_block = f"\n\nHouse style guide:\n{style_guide}" if style_guide else ""

    prompt = f"""
Whole-manuscript context and authorial style brief:
{context_brief}{style_block}{focus_note}

Current section: {section.title}
Previous section: {previous_title}
Next section: {next_title}

Section text:
{section_text}{truncated}

Give editorial suggestions for improving the text already written. Do not rewrite the scene.
Respond in JSON with this shape:
{{
  "summary": "one sentence",
  "suggestions": ["specific actionable note", "..."],
  "style_preservation": ["note about preserving or strengthening the author's style"],
  "continuity": ["context-aware continuity or setup/payoff note"],
  "line_level": ["optional sentence-level craft note"]
}}
"""
    raw = client.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a rigorous but tactful developmental and line editor. "
                    "Respect the author's existing voice and focus on suggestions, not replacement prose. "
                    "Return valid JSON only."
                ),
            },
            {"role": "user", "content": textwrap.dedent(prompt).strip()},
        ]
    )
    parsed = parse_json_response(raw)
    parsed["title"] = section.title
    return parsed


def parse_json_response(raw: str) -> Suggestion:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = cast(Suggestion, json.loads(cleaned))
    except json.JSONDecodeError:
        data = {"summary": "", "suggestions": [raw], "style_preservation": [], "continuity": [], "line_level": []}
    return data
