import { Check, X } from "lucide-react"
import type { Segment } from "@/types"

export interface DocViewProps {
    segments: Segment[]
    focusedId: string | null
    setFocusedId: (id: string | null) => void
    onAccept: (id: string) => void
    onReject: (id: string) => void
    flashIds: Set<string>
}

export function DocView({
    segments,
    focusedId,
    setFocusedId,
    onAccept,
    onReject,
    flashIds,
}: DocViewProps) {
    if (!segments.length) return null

    return (
        <div className="doc">
            {segments.map((s) => {
                if (s.kind === "keep")
                    return (
                        <span key={s.id} className="seg">
                            {s.text}
                        </span>
                    )
                if (s.status === "accepted")
                    return (
                        <span key={s.id} className="seg">
                            {s.after}
                        </span>
                    )
                if (s.status === "rejected")
                    return (
                        <span key={s.id} className="seg">
                            {s.before}
                        </span>
                    )
                const isFlash = flashIds.has(s.id)
                const isFocused = focusedId === s.id
                return (
                    <span
                        key={s.id}
                        className={
                            "seg edit-pair" + (isFocused ? " focused" : "")
                        }
                        onClick={(e) => {
                            e.stopPropagation()
                            setFocusedId(s.id)
                        }}
                    >
                        {s.before && (
                            <del
                                className={"chunk" + (isFlash ? " flash" : "")}
                            >
                                {s.before}
                            </del>
                        )}
                        {s.after && (
                            <ins
                                className={"chunk" + (isFlash ? " flash" : "")}
                            >
                                {s.after}
                            </ins>
                        )}
                        <span className="chip-row" contentEditable={false}>
                            <button
                                className="accept"
                                title="Accept"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onAccept(s.id)
                                }}
                                aria-label="Accept"
                            >
                                <Check size={13} />
                            </button>
                            <button
                                className="reject"
                                title="Reject"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onReject(s.id)
                                }}
                                aria-label="Reject"
                            >
                                <X size={13} />
                            </button>
                        </span>
                    </span>
                )
            })}
        </div>
    )
}
