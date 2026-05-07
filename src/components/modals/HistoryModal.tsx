import { Modal } from "./Modal"
import type { HistoryEntry } from "@/types"

export interface HistoryModalProps {
    open: boolean
    onClose: () => void
    history: HistoryEntry[]
    onRevert: (id: string) => void
    onClearHistory: () => void
}

export function HistoryModal({
    open,
    onClose,
    history,
    onRevert,
    onClearHistory,
}: HistoryModalProps) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            kicker="Editorial — Revisions"
            title="The history"
            footer={
                <>
                    <button
                        className="btn danger"
                        type="button"
                        onClick={onClearHistory}
                        disabled={!history.length}
                    >
                        Clear history
                    </button>
                    <button className="btn" type="button" onClick={onClose}>
                        Close
                    </button>
                </>
            }
        >
            {history.length === 0 ? (
                <div className="history-empty">
                    No revisions yet. Run an editor's mark to begin.
                </div>
            ) : (
                <div className="history-list">
                    {history
                        .slice()
                        .reverse()
                        .map((h) => (
                            <button
                                key={h.id}
                                className="history-row"
                                type="button"
                                onClick={() => {
                                    onRevert(h.id)
                                    onClose()
                                }}
                            >
                                <span className="glyph">{h.glyph}</span>
                                <div className="info">
                                    <div className="name">{h.name}</div>
                                    <div className="when">{h.when}</div>
                                </div>
                                <div className="preview">{h.preview}</div>
                            </button>
                        ))}
                </div>
            )}
        </Modal>
    )
}
