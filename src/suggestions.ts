import type { Editor } from "@tiptap/react"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { EditOp, EditSuggestion, SuggestionTag } from "./types"

const DEFAULT_TAG_BY_TYPE: Record<string, SuggestionTag> = {
    delete: "deletion",
    insert: "insertion",
    replace: "style",
}

interface MinimalChange {
    before: string
    after: string
    startOffset: number
}

export const TAG_META: Record<SuggestionTag, { label: string; tone: string }> =
    {
        grammar: { label: "Grammar", tone: "red" },
        punctuation: { label: "Punctuation", tone: "amber" },
        clarity: { label: "Clarity", tone: "blue" },
        style: { label: "Style", tone: "violet" },
        tone: { label: "Tone", tone: "slate" },
        concision: { label: "Concision", tone: "green" },
        insertion: { label: "Insertion", tone: "green" },
        deletion: { label: "Deletion", tone: "red" },
    }

interface TextMap {
    text: string
    positions: Array<number | null>
}

function collectBlockText(node: PMNode, basePos: number, out: TextMap) {
    node.descendants((child, pos) => {
        if (!child.isText || !child.text) return
        for (let i = 0; i < child.text.length; i += 1) {
            out.text += child.text[i]
            out.positions.push(basePos + pos + i + 1)
        }
    })
}

export function plainTextWithPositions(editor: Editor): TextMap {
    const out: TextMap = { text: "", positions: [] }
    editor.state.doc.forEach((node, offset, index) => {
        if (index > 0) {
            out.text += "\n\n"
            out.positions.push(null, null)
        }
        collectBlockText(node, offset, out)
    })
    return out
}

function resolveRange(map: TextMap, start: number, end: number) {
    if (start === end) {
        const point = resolvePoint(map, start)
        return point == null ? null : { from: point, to: point }
    }

    let from: number | null = null
    let to: number | null = null

    for (let i = start; i < map.positions.length; i += 1) {
        if (map.positions[i] != null) {
            from = map.positions[i]
            break
        }
    }
    for (let i = Math.max(start, end - 1); i >= 0; i -= 1) {
        if (map.positions[i] != null) {
            to = (map.positions[i] as number) + 1
            break
        }
    }

    if (from == null && to != null) from = to
    if (to == null && from != null) to = from
    if (from == null || to == null) return null
    return { from, to: Math.max(from, to) }
}

function resolvePoint(map: TextMap, offset: number) {
    for (
        let i = Math.min(offset, map.positions.length - 1);
        i < map.positions.length;
        i += 1
    ) {
        if (map.positions[i] != null) return map.positions[i]
    }
    for (
        let i = Math.min(offset - 1, map.positions.length - 1);
        i >= 0;
        i -= 1
    ) {
        if (map.positions[i] != null) return (map.positions[i] as number) + 1
    }
    return null
}

function normalizeTag(op: EditOp): SuggestionTag {
    if (op.tag && op.tag in TAG_META) return op.tag
    return DEFAULT_TAG_BY_TYPE[op.type] ?? "style"
}

function commonPrefixLength(a: string, b: string) {
    const max = Math.min(a.length, b.length)
    let i = 0
    while (i < max && a[i] === b[i]) i += 1
    return i
}

function isWordChar(char: string | undefined) {
    return !!char && /[\p{L}\p{N}'’-]/u.test(char)
}

function commonSuffixLength(a: string, b: string, prefixLength: number) {
    const max = Math.min(a.length, b.length) - prefixLength
    let i = 0
    while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) {
        i += 1
    }
    return i
}

function splitsWordAtStart(text: string, start: number) {
    return (
        start > 0 &&
        start < text.length &&
        isWordChar(text[start - 1]) &&
        isWordChar(text[start])
    )
}

function splitsWordAtEnd(text: string, end: number) {
    return (
        end > 0 &&
        end < text.length &&
        isWordChar(text[end - 1]) &&
        isWordChar(text[end])
    )
}

function minimizeReplacement(
    before: string,
    after: string,
): MinimalChange | null {
    if (before === after) return null

    const prefix = commonPrefixLength(before, after)
    const suffix = commonSuffixLength(before, after, prefix)
    let beforeStart = prefix
    let afterStart = prefix
    let beforeEnd = before.length - suffix
    let afterEnd = after.length - suffix

    while (
        splitsWordAtStart(before, beforeStart) ||
        splitsWordAtStart(after, afterStart)
    ) {
        beforeStart = Math.max(0, beforeStart - 1)
        afterStart = Math.max(0, afterStart - 1)
    }

    while (
        splitsWordAtEnd(before, beforeEnd) ||
        splitsWordAtEnd(after, afterEnd)
    ) {
        beforeEnd = Math.min(before.length, beforeEnd + 1)
        afterEnd = Math.min(after.length, afterEnd + 1)
    }

    return {
        before: before.slice(beforeStart, beforeEnd),
        after: after.slice(afterStart, afterEnd),
        startOffset: beforeStart,
    }
}

function suggestionTypeForChange(op: EditOp, before: string, after: string) {
    if (op.type !== "replace") return op.type
    if (!before && after) return "insert"
    if (before && !after) return "delete"
    return "replace"
}

export function suggestionsFromEdits(
    editor: Editor,
    edits: EditOp[],
): EditSuggestion[] {
    const map = plainTextWithPositions(editor)
    const suggestions: EditSuggestion[] = []
    let cursor = 0

    edits.forEach((op, index) => {
        let start = -1
        let end = -1
        let before = ""
        let after = ""

        if (op.type === "replace") {
            before = op.original ?? ""
            after = op.replacement ?? ""
            if (!before) return
            start = map.text.indexOf(before, cursor)
            end = start + before.length
            if (start === -1) return
            const minimal = minimizeReplacement(before, after)
            if (!minimal) return
            before = minimal.before
            after = minimal.after
            start += minimal.startOffset
            end = start + before.length
        } else if (op.type === "delete") {
            before = op.original ?? ""
            if (!before) return
            start = map.text.indexOf(before, cursor)
            end = start + before.length
        } else if (op.type === "insert") {
            const anchor = op.after ?? ""
            after = op.text ?? ""
            if (!after) return
            if (anchor) {
                const anchorStart = map.text.indexOf(anchor, cursor)
                if (anchorStart === -1) return
                start = anchorStart + anchor.length
                end = start
            } else {
                start = cursor
                end = cursor
            }
            if (map.text.slice(start, start + after.length) === after) return
        }

        if (start < 0) return
        const range = resolveRange(map, start, end)
        if (!range) return

        suggestions.push({
            id: `s${Date.now()}-${index}`,
            type: suggestionTypeForChange(op, before, after),
            before,
            after,
            tag: normalizeTag(op),
            status: "pending",
            range,
        })
        cursor = Math.max(cursor, end)
    })

    return suggestions
}

function sameSuggestionState(a: EditSuggestion, b: EditSuggestion) {
    return (
        a.status === b.status &&
        a.range.from === b.range.from &&
        a.range.to === b.range.to &&
        a.type === b.type &&
        a.before === b.before &&
        a.after === b.after
    )
}

export function suggestionsNeedSync(
    current: EditSuggestion[],
    next: EditSuggestion[],
) {
    return (
        current.length !== next.length ||
        current.some((item, index) => !sameSuggestionState(item, next[index]))
    )
}

export function applySuggestion(editor: Editor, suggestion: EditSuggestion) {
    if (suggestion.type === "delete") {
        editor.chain().focus().deleteRange(suggestion.range).run()
        return
    }

    editor.commands.focus()
    if (suggestion.type === "insert") {
        editor.view.dispatch(
            editor.state.tr
                .insertText(suggestion.after ?? "", suggestion.range.from)
                .scrollIntoView(),
        )
        return
    }

    editor.view.dispatch(
        editor.state.tr
            .insertText(
                suggestion.after ?? "",
                suggestion.range.from,
                suggestion.range.to,
            )
            .scrollIntoView(),
    )
}

export function rejectSuggestionChange(
    editor: Editor,
    suggestion: EditSuggestion,
) {
    editor.commands.focus()

    if (suggestion.type === "insert") {
        editor.chain().deleteRange(suggestion.range).run()
        return
    }

    const markType = editor.state.schema.marks.suggestion
    if (!markType) return
    editor.view.dispatch(
        editor.state.tr
            .removeMark(suggestion.range.from, suggestion.range.to, markType)
            .scrollIntoView(),
    )
}

export function focusSuggestion(editor: Editor, suggestion: EditSuggestion) {
    const { from, to } = suggestion.range
    editor
        .chain()
        .focus()
        .setTextSelection({ from, to: Math.max(from, to) })
        .scrollIntoView()
        .run()
}
