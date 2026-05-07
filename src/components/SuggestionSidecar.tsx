import { useEffect, useRef } from "react"
import {
    Check,
    X,
    LocateFixed,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react"
import { TAG_META } from "@/suggestions"
import type { EditSuggestion, SuggestionTag } from "@/types"

interface SuggestionSidecarProps {
    suggestions: EditSuggestion[]
    focusedId: string | null
    filter: SuggestionTag | "all"
    collapsed: boolean
    inlineDiffs: boolean
    onFilter: (filter: SuggestionTag | "all") => void
    onToggleCollapsed: () => void
    onInlineDiffsChange: (next: boolean) => void
    onFocus: (id: string) => void
    onAccept: (id: string) => void
    onReject: (id: string) => void
}

export function SuggestionSidecar({
    suggestions,
    focusedId,
    filter,
    collapsed,
    inlineDiffs,
    onFilter,
    onToggleCollapsed,
    onInlineDiffsChange,
    onFocus,
    onAccept,
    onReject,
}: SuggestionSidecarProps) {
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!focusedId || !listRef.current) return
        const card = listRef.current.querySelector<HTMLElement>(
            `[data-suggestion-id="${focusedId}"]`,
        )
        card?.scrollIntoView({ block: "nearest" })
    }, [focusedId])

    const pending = suggestions.filter((s) => s.status === "pending")
    const tags = Array.from(new Set(pending.map((s) => s.tag)))
    const visible =
        filter === "all" ? pending : pending.filter((s) => s.tag === filter)

    if (collapsed) {
        return (
            <aside className="suggestion-sidecar collapsed">
                <button
                    type="button"
                    className="sidecar-rail-toggle"
                    onClick={onToggleCollapsed}
                    title="Show suggestions"
                >
                    <PanelRightOpen size={18} />
                    <span>{pending.length}</span>
                </button>
                <span className="sidecar-rail-label">Review</span>
            </aside>
        )
    }

    return (
        <aside className="suggestion-sidecar">
            <div className="sidecar-head">
                <div>
                    <span className="sidecar-kicker">Review</span>
                    <h2>Suggestions</h2>
                </div>
                <div className="sidecar-head-actions">
                    <span className="pending-total">{pending.length}</span>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onToggleCollapsed}
                        title="Hide suggestions"
                    >
                        <PanelRightClose size={18} />
                    </button>
                </div>
            </div>

            <div className="tag-filters">
                <button
                    className={filter === "all" ? "active" : ""}
                    type="button"
                    onClick={() => onFilter("all")}
                >
                    All <span>{pending.length}</span>
                </button>
                {tags.map((tag) => (
                    <button
                        key={tag}
                        className={filter === tag ? "active" : ""}
                        type="button"
                        onClick={() => onFilter(tag)}
                    >
                        <i className={`tag-dot ${TAG_META[tag].tone}`} />
                        {TAG_META[tag].label}{" "}
                        <span>
                            {pending.filter((s) => s.tag === tag).length}
                        </span>
                    </button>
                ))}
            </div>

            <label className="diff-mode-toggle">
                <input
                    type="checkbox"
                    checked={inlineDiffs}
                    onChange={(event) =>
                        onInlineDiffsChange(event.currentTarget.checked)
                    }
                />
                <span />
                <strong>Inline diffs</strong>
                <small>
                    {inlineDiffs
                        ? "Showing pending edits in the document"
                        : "Only highlighting the selected suggestion"}
                </small>
            </label>

            <div className="suggestion-list" ref={listRef}>
                {visible.length === 0 ? (
                    <div className="suggestion-empty">
                        No pending suggestions.
                    </div>
                ) : (
                    visible.map((s) => (
                        <button
                            type="button"
                            key={s.id}
                            data-suggestion-id={s.id}
                            className={
                                "suggestion-card" +
                                (focusedId === s.id ? " focused" : "")
                            }
                            onClick={() => onFocus(s.id)}
                        >
                            <span
                                className={`tag-line ${TAG_META[s.tag].tone}`}
                            >
                                {TAG_META[s.tag].label}
                            </span>
                            {s.before && (
                                <span className="suggestion-before">
                                    {s.before}
                                </span>
                            )}
                            {s.after && (
                                <span className="suggestion-after">
                                    {s.after}
                                </span>
                            )}
                            <span className="suggestion-actions">
                                <span title="Find in document">
                                    <LocateFixed size={15} />
                                </span>
                                <span
                                    role="button"
                                    tabIndex={0}
                                    className="mini accept"
                                    title="Accept"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onAccept(s.id)
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter")
                                            onAccept(s.id)
                                    }}
                                >
                                    <Check size={15} />
                                </span>
                                <span
                                    role="button"
                                    tabIndex={0}
                                    className="mini reject"
                                    title="Reject"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onReject(s.id)
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter")
                                            onReject(s.id)
                                    }}
                                >
                                    <X size={15} />
                                </span>
                            </span>
                        </button>
                    ))
                )}
            </div>
        </aside>
    )
}
