import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
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
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogDescription>Editorial — Revisions</DialogDescription>
                    <DialogTitle>The history</DialogTitle>
                </DialogHeader>

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
                                <div
                                    key={h.id}
                                    className="history-row"
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
                                </div>
                            ))}
                    </div>
                )}

                <DialogFooter>
                    <Button
                        variant="destructive"
                        onClick={onClearHistory}
                        disabled={!history.length}
                    >
                        Clear history
                    </Button>
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
