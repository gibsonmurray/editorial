import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core"
import type { Editor } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type {
    EditSuggestion,
    EditType,
    SegmentStatus,
    SuggestionTag,
} from "@/types"

interface SuggestionDecorationState {
    focusedId: string | null
    inlineDiffs: boolean
}

type SuggestionAttrs = {
    id: string
    type: EditType
    before: string
    after: string
    tag: SuggestionTag
    status: SegmentStatus
}

interface SuggestionSpan {
    suggestion: EditSuggestion
    kind: "mark" | "marker"
}

export const suggestionDecorationKey = new PluginKey<SuggestionDecorationState>(
    "editorial-suggestion-decorations",
)

function attrsFromSuggestion(suggestion: EditSuggestion): SuggestionAttrs {
    return {
        id: suggestion.id,
        type: suggestion.type,
        before: suggestion.before,
        after: suggestion.after,
        tag: suggestion.tag,
        status: suggestion.status,
    }
}

function attrsToSuggestion(
    attrs: Partial<SuggestionAttrs>,
    range: EditSuggestion["range"],
): EditSuggestion | null {
    if (!attrs.id || !attrs.type || !attrs.tag) return null
    return {
        id: attrs.id,
        type: attrs.type,
        before: attrs.before ?? "",
        after: attrs.after ?? "",
        tag: attrs.tag,
        status: attrs.status ?? "pending",
        range,
    }
}

function sameAttrs(a: Partial<SuggestionAttrs>, b: Partial<SuggestionAttrs>) {
    return (
        a.id === b.id &&
        a.type === b.type &&
        a.before === b.before &&
        a.after === b.after &&
        a.tag === b.tag &&
        (a.status ?? "pending") === (b.status ?? "pending")
    )
}

function collectSuggestionSpans(doc: Editor["state"]["doc"]) {
    const spans: SuggestionSpan[] = []
    const byId = new Map<string, SuggestionSpan>()

    doc.descendants((node, pos) => {
        if (node.type.name === "suggestionMarker") {
            const suggestion = attrsToSuggestion(node.attrs, {
                from: pos,
                to: pos + node.nodeSize,
            })
            if (suggestion) spans.push({ suggestion, kind: "marker" })
            return false
        }

        if (!node.isText || !node.text) return
        const mark = node.marks.find((item) => item.type.name === "suggestion")
        if (!mark) return

        const from = pos
        const to = pos + node.nodeSize
        const existing = byId.get(mark.attrs.id)
        if (existing && sameAttrs(existing.suggestion, mark.attrs)) {
            existing.suggestion.range.from = Math.min(
                existing.suggestion.range.from,
                from,
            )
            existing.suggestion.range.to = Math.max(
                existing.suggestion.range.to,
                to,
            )
            return
        }

        const suggestion = attrsToSuggestion(mark.attrs, { from, to })
        if (!suggestion) return

        const span = { suggestion, kind: "mark" as const }
        spans.push(span)
        byId.set(suggestion.id, span)
    })

    return spans
}

function buildDecorations(
    doc: Editor["state"]["doc"],
    state: SuggestionDecorationState,
) {
    const decorations: Decoration[] = []
    const spans = collectSuggestionSpans(doc)

    for (const { suggestion, kind } of spans) {
        if (suggestion.status !== "pending") continue

        const isFocused = suggestion.id === state.focusedId
        if (!state.inlineDiffs && !isFocused) continue

        const selectedClass = isFocused ? " pm-suggestion-selected" : ""

        if (!state.inlineDiffs) {
            decorations.push(
                Decoration.inline(
                    suggestion.range.from,
                    Math.max(suggestion.range.to, suggestion.range.from + 1),
                    { class: "pm-suggestion-highlight" },
                ),
            )
            continue
        }

        if (kind === "mark" && suggestion.before) {
            decorations.push(
                Decoration.inline(
                    suggestion.range.from,
                    Math.max(suggestion.range.to, suggestion.range.from + 1),
                    {
                        class: `pm-suggestion-before${selectedClass}`,
                        "data-suggestion-id": suggestion.id,
                    },
                ),
            )
        }

        if (suggestion.after) {
            const node = document.createElement("span")
            node.className = `pm-suggestion-after${selectedClass}`
            node.textContent = suggestion.after
            node.contentEditable = "false"
            node.dataset.suggestionId = suggestion.id
            decorations.push(
                Decoration.widget(suggestion.range.to, node, {
                    side: 1,
                    key: `${suggestion.id}-after`,
                    ignoreSelection: true,
                }),
            )
        }
    }

    return DecorationSet.create(doc, decorations)
}

export const SuggestionMark = Mark.create({
    name: "suggestion",
    inclusive: false,

    addAttributes() {
        return {
            id: { default: null },
            type: { default: "replace" },
            before: { default: "" },
            after: { default: "" },
            tag: { default: "style" },
            status: { default: "pending" },
        }
    },

    parseHTML() {
        return [{ tag: "span[data-suggestion-id]" }]
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-suggestion-id": HTMLAttributes.id,
            }),
            0,
        ]
    },
})

export const SuggestionMarker = Node.create({
    name: "suggestionMarker",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
        return {
            id: { default: null },
            type: { default: "insert" },
            before: { default: "" },
            after: { default: "" },
            tag: { default: "insertion" },
            status: { default: "pending" },
        }
    },

    parseHTML() {
        return [{ tag: "span[data-suggestion-marker]" }]
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-suggestion-marker": HTMLAttributes.id,
                class: "pm-suggestion-marker",
            }),
        ]
    },
})

export const SuggestionDecorations = Extension.create({
    name: "suggestionDecorations",

    addProseMirrorPlugins() {
        return [
            new Plugin<SuggestionDecorationState>({
                key: suggestionDecorationKey,
                state: {
                    init: () => ({
                        focusedId: null,
                        inlineDiffs: true,
                    }),
                    apply(tr, value) {
                        return tr.getMeta(suggestionDecorationKey) ?? value
                    },
                },
                props: {
                    decorations(state) {
                        return buildDecorations(
                            state.doc,
                            suggestionDecorationKey.getState(state) ?? {
                                focusedId: null,
                                inlineDiffs: true,
                            },
                        )
                    },
                },
            }),
        ]
    },
})

export function getEditorSuggestions(editor: Editor) {
    return collectSuggestionSpans(editor.state.doc).map(
        ({ suggestion }) => suggestion,
    )
}

export function clearSuggestionAnnotations(editor: Editor) {
    const { tr, schema, doc } = editor.state
    const markType = schema.marks.suggestion
    if (markType) tr.removeMark(0, doc.content.size, markType)

    const markerRanges: Array<{ from: number; to: number }> = []
    doc.descendants((node, pos) => {
        if (node.type.name === "suggestionMarker") {
            markerRanges.push({ from: pos, to: pos + node.nodeSize })
        }
    })
    markerRanges.reverse().forEach((range) => tr.delete(range.from, range.to))

    if (tr.docChanged) {
        tr.setMeta("addToHistory", false)
        editor.view.dispatch(tr)
    }
}

export function installSuggestionAnnotations(
    editor: Editor,
    suggestions: EditSuggestion[],
) {
    const { schema } = editor.state
    const markType = schema.marks.suggestion
    const markerType = schema.nodes.suggestionMarker
    let tr = editor.state.tr

    if (markType) tr.removeMark(0, editor.state.doc.content.size, markType)

    const markerRanges: Array<{ from: number; to: number }> = []
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "suggestionMarker") {
            markerRanges.push({ from: pos, to: pos + node.nodeSize })
        }
    })
    markerRanges.reverse().forEach((range) => tr.delete(range.from, range.to))

    const pending = suggestions
        .filter((suggestion) => suggestion.status === "pending")
        .sort((a, b) => b.range.from - a.range.from)

    for (const suggestion of pending) {
        const attrs = attrsFromSuggestion(suggestion)
        const from = tr.mapping.map(suggestion.range.from)
        if (suggestion.type === "insert") {
            if (!markerType) continue
            tr.insert(from, markerType.create(attrs))
            continue
        }

        if (!markType) continue
        tr.addMark(
            from,
            tr.mapping.map(suggestion.range.to),
            markType.create(attrs),
        )
    }

    if (tr.docChanged) {
        tr.setMeta("addToHistory", false)
        editor.view.dispatch(tr)
    }
}

export function updateSuggestionDecorations(
    editor: Editor,
    focusedId: string | null,
    inlineDiffs: boolean,
) {
    editor.view.dispatch(
        editor.state.tr.setMeta(suggestionDecorationKey, {
            focusedId,
            inlineDiffs,
        }),
    )
}
