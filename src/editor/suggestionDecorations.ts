import { Extension, type Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditSuggestion } from '@/types';

interface SuggestionDecorationState {
  suggestions: EditSuggestion[];
  focusedId: string | null;
  inlineDiffs: boolean;
}

export const suggestionDecorationKey = new PluginKey<SuggestionDecorationState>('editorial-suggestion-decorations');

function buildDecorations(doc: Editor['state']['doc'], state: SuggestionDecorationState) {
  const decorations: Decoration[] = [];
  const pending = state.suggestions.filter(s => s.status === 'pending');

  for (const suggestion of pending) {
    const isFocused = suggestion.id === state.focusedId;
    if (!state.inlineDiffs && !isFocused) continue;

    const selectedClass = isFocused ? ' pm-suggestion-selected' : '';

    if (!state.inlineDiffs) {
      decorations.push(Decoration.inline(
        suggestion.range.from,
        Math.max(suggestion.range.to, suggestion.range.from + 1),
        { class: 'pm-suggestion-highlight' },
      ));
      continue;
    }

    if (suggestion.before) {
      decorations.push(Decoration.inline(
        suggestion.range.from,
        Math.max(suggestion.range.to, suggestion.range.from + 1),
        { class: `pm-suggestion-before${selectedClass}` },
      ));
    }

    if (suggestion.after) {
      const node = document.createElement('span');
      node.className = `pm-suggestion-after${selectedClass}`;
      node.textContent = suggestion.after;
      decorations.push(Decoration.widget(suggestion.range.to, node, { side: 1, key: `${suggestion.id}-after` }));
    }
  }

  return DecorationSet.create(doc, decorations);
}

export const SuggestionDecorations = Extension.create({
  name: 'suggestionDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestionDecorationState>({
        key: suggestionDecorationKey,
        state: {
          init: () => ({ suggestions: [], focusedId: null, inlineDiffs: true }),
          apply(tr, value) {
            return tr.getMeta(suggestionDecorationKey) ?? value;
          },
        },
        props: {
          decorations(state) {
            return buildDecorations(state.doc, suggestionDecorationKey.getState(state) ?? { suggestions: [], focusedId: null, inlineDiffs: true });
          },
        },
      }),
    ];
  },
});

export function updateSuggestionDecorations(
  editor: Editor,
  suggestions: EditSuggestion[],
  focusedId: string | null,
  inlineDiffs: boolean,
) {
  editor.view.dispatch(editor.state.tr.setMeta(suggestionDecorationKey, { suggestions, focusedId, inlineDiffs }));
}
