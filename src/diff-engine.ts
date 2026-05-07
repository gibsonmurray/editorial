import type { EditOp, Segment, KeepSegment, EditSegment } from "./types"

export const EditOps = {
    computeSegments(originalText: string, edits: EditOp[]): Segment[] {
        if (!Array.isArray(edits) || edits.length === 0) {
            return [{ id: "all", kind: "keep", text: originalText }]
        }

        const segments: Segment[] = []
        let cursor = 0
        let segId = 0

        for (const op of edits) {
            let matchStart = -1
            let matchEnd = -1
            let before = ""
            let after = ""

            if (op.type === "delete") {
                const needle = op.original ?? ""
                if (!needle) continue
                matchStart = originalText.indexOf(needle, cursor)
                if (matchStart === -1) continue
                matchEnd = matchStart + needle.length
                before = needle
                after = ""
            } else if (op.type === "replace") {
                const needle = op.original ?? ""
                if (!needle) continue
                matchStart = originalText.indexOf(needle, cursor)
                if (matchStart === -1) continue
                matchEnd = matchStart + needle.length
                before = needle
                after = op.replacement ?? ""
            } else if (op.type === "insert") {
                const anchor = op.after ?? ""
                if (anchor) {
                    const idx = originalText.indexOf(anchor, cursor)
                    if (idx === -1) continue
                    matchStart = matchEnd = idx + anchor.length
                } else {
                    matchStart = matchEnd = cursor
                }
                before = ""
                after = op.text ?? ""
                if (!after) continue
            } else {
                continue
            }

            if (matchStart > cursor) {
                const keep: KeepSegment = {
                    id: "k" + segId++,
                    kind: "keep",
                    text: originalText.slice(cursor, matchStart),
                }
                segments.push(keep)
            }
            const edit: EditSegment = {
                id: "e" + segId++,
                kind: "edit",
                before,
                after,
                status: "pending",
            }
            segments.push(edit)
            cursor = matchEnd
        }

        if (cursor < originalText.length) {
            const keep: KeepSegment = {
                id: "k" + segId++,
                kind: "keep",
                text: originalText.slice(cursor),
            }
            segments.push(keep)
        }

        return segments
    },

    finalText(segments: Segment[]): string {
        return segments
            .map((s) => {
                if (s.kind === "keep") return s.text
                return s.status === "accepted" ? s.after : s.before
            })
            .join("")
    },

    pendingCount(segments: Segment[]): number {
        return segments.filter(
            (s) => s.kind === "edit" && s.status === "pending",
        ).length
    },

    totalEdits(segments: Segment[]): number {
        return segments.filter((s) => s.kind === "edit").length
    },
}
