from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree

from editorial_cli.errors import CliError
from editorial_cli.models import DocumentPart, Section


__all__ = [
    "DocumentPart",
    "Section",
    "extract_docx_parts",
    "split_document",
]

WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CHAPTER_RE = re.compile(r"^\s*(chapter|prologue|epilogue|part)\b", re.IGNORECASE)
SCENE_BREAK_RE = re.compile(r"^\s*(?:[*#~]\s*){3,}$|^\s*-{3,}\s*$")


def extract_docx_parts(path: Path) -> list[DocumentPart]:
    if path.suffix.lower() != ".docx":
        raise CliError("Only .docx files are supported.")

    try:
        with zipfile.ZipFile(path) as docx:
            document_xml = docx.read("word/document.xml")
    except KeyError as exc:
        raise CliError(f"{path} does not look like a valid Word document.") from exc

    root = ElementTree.fromstring(document_xml)
    parts: list[DocumentPart] = []
    for paragraph in root.findall(".//w:body/w:p", WORD_NS):
        text = paragraph_text(paragraph)
        if not text:
            continue
        style = paragraph_style(paragraph)
        is_heading = is_heading_style(style) or bool(CHAPTER_RE.match(text))
        parts.append(DocumentPart(text=text, is_heading=is_heading, style=style))
    return parts


def paragraph_style(paragraph: ElementTree.Element) -> str | None:
    style = paragraph.find("./w:pPr/w:pStyle", WORD_NS)
    if style is None:
        return None
    return style.attrib.get(f"{{{WORD_NS['w']}}}val")


def paragraph_text(paragraph: ElementTree.Element) -> str:
    chunks: list[str] = []
    for node in paragraph.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag in {"t", "instrText"} and node.text:
            chunks.append(node.text)
        elif tag == "tab":
            chunks.append("\t")
        elif tag in {"br", "cr"}:
            chunks.append("\n")
    return "".join(chunks).strip()


def is_heading_style(style: str | None) -> bool:
    if not style:
        return False
    normalized = re.sub(r"[\s_-]+", "", style).lower()
    return normalized.startswith("heading")


def is_scene_break(text: str) -> bool:
    stripped = text.strip()
    return stripped in {"***", "* * *", "#", "###", "- - -"} or bool(SCENE_BREAK_RE.match(stripped))


def split_document(parts: Iterable[DocumentPart]) -> list[Section]:
    sections: list[Section] = []
    current_title = "Scene 1"
    current_chapter = "Scene"
    current_paragraphs: list[str] = []
    scene_number = 1

    def flush() -> None:
        nonlocal current_paragraphs
        text = "\n\n".join(current_paragraphs).strip()
        if text:
            sections.append(Section(title=current_title, text=text, index=len(sections) + 1))
        current_paragraphs = []

    for part in parts:
        if part.is_heading:
            flush()
            current_chapter = part.text
            current_title = part.text
            scene_number = 1
            continue

        if is_scene_break(part.text):
            flush()
            scene_number += 1
            current_title = f"{current_chapter} - Scene {scene_number}"
            continue

        current_paragraphs.append(part.text)

    flush()
    return sections
