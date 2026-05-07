import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditOp, EditSuggestion, SuggestionTag } from './types';

const DEFAULT_TAG_BY_TYPE: Record<string, SuggestionTag> = {
  delete: 'deletion',
  insert: 'insertion',
  replace: 'style',
};

export const TAG_META: Record<SuggestionTag, { label: string; tone: string }> = {
  grammar: { label: 'Grammar', tone: 'red' },
  punctuation: { label: 'Punctuation', tone: 'amber' },
  clarity: { label: 'Clarity', tone: 'blue' },
  style: { label: 'Style', tone: 'violet' },
  tone: { label: 'Tone', tone: 'slate' },
  concision: { label: 'Concision', tone: 'green' },
  insertion: { label: 'Insertion', tone: 'green' },
  deletion: { label: 'Deletion', tone: 'red' },
};

interface TextMap {
  text: string;
  positions: Array<number | null>;
}

function collectBlockText(node: PMNode, basePos: number, out: TextMap) {
  node.descendants((child, pos) => {
    if (!child.isText || !child.text) return;
    for (let i = 0; i < child.text.length; i += 1) {
      out.text += child.text[i];
      out.positions.push(basePos + pos + i + 1);
    }
  });
}

export function plainTextWithPositions(editor: Editor): TextMap {
  const out: TextMap = { text: '', positions: [] };
  editor.state.doc.forEach((node, offset, index) => {
    if (index > 0) {
      out.text += '\n\n';
      out.positions.push(null, null);
    }
    collectBlockText(node, offset, out);
  });
  return out;
}

function resolveRange(map: TextMap, start: number, end: number) {
  let from: number | null = null;
  let to: number | null = null;

  for (let i = start; i < map.positions.length; i += 1) {
    if (map.positions[i] != null) {
      from = map.positions[i];
      break;
    }
  }
  for (let i = Math.max(start, end - 1); i >= 0; i -= 1) {
    if (map.positions[i] != null) {
      to = (map.positions[i] as number) + 1;
      break;
    }
  }

  if (from == null && to != null) from = to;
  if (to == null && from != null) to = from;
  if (from == null || to == null) return null;
  return { from, to: Math.max(from, to) };
}

function normalizeTag(op: EditOp): SuggestionTag {
  if (op.tag && op.tag in TAG_META) return op.tag;
  return DEFAULT_TAG_BY_TYPE[op.type] ?? 'style';
}

export function suggestionsFromEdits(editor: Editor, edits: EditOp[]): EditSuggestion[] {
  const map = plainTextWithPositions(editor);
  const suggestions: EditSuggestion[] = [];
  let cursor = 0;

  edits.forEach((op, index) => {
    let start = -1;
    let end = -1;
    let before = '';
    let after = '';

    if (op.type === 'replace') {
      before = op.original ?? '';
      after = op.replacement ?? '';
      if (!before) return;
      start = map.text.indexOf(before, cursor);
      end = start + before.length;
    } else if (op.type === 'delete') {
      before = op.original ?? '';
      if (!before) return;
      start = map.text.indexOf(before, cursor);
      end = start + before.length;
    } else if (op.type === 'insert') {
      const anchor = op.after ?? '';
      after = op.text ?? '';
      if (!after) return;
      if (anchor) {
        const anchorStart = map.text.indexOf(anchor, cursor);
        if (anchorStart === -1) return;
        start = anchorStart + anchor.length;
        end = start;
      } else {
        start = cursor;
        end = cursor;
      }
    }

    if (start < 0) return;
    const range = resolveRange(map, start, end);
    if (!range) return;

    suggestions.push({
      id: `s${Date.now()}-${index}`,
      type: op.type,
      before,
      after,
      tag: normalizeTag(op),
      status: 'pending',
      range,
    });
    cursor = Math.max(cursor, end);
  });

  return suggestions;
}

export function applySuggestion(editor: Editor, suggestion: EditSuggestion) {
  if (suggestion.type === 'delete') {
    editor.chain().focus().deleteRange(suggestion.range).run();
    return;
  }

  if (suggestion.type === 'insert') {
    editor.chain().focus().insertContentAt(suggestion.range.from, suggestion.after).run();
    return;
  }

  editor.chain().focus().insertContentAt(suggestion.range, suggestion.after).run();
}

export function focusSuggestion(editor: Editor, suggestion: EditSuggestion) {
  const { from, to } = suggestion.range;
  editor.chain().focus().setTextSelection({ from, to: Math.max(from, to) }).scrollIntoView().run();
}
