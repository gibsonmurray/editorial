import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface ConfirmModalProps {
    open: boolean
    title: string
    body: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
    onClose: () => void
}

export function ConfirmModal({
    open,
    title,
    body,
    confirmLabel,
    danger,
    onConfirm,
    onClose,
}: ConfirmModalProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogDescription>Editorial</DialogDescription>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <div
                    style={{
                        fontSize: 13,
                        color: "var(--color-ink-soft)",
                        lineHeight: 1.6,
                    }}
                >
                    {body}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant={danger ? "destructive" : "default"}
                        onClick={() => {
                            onConfirm()
                            onClose()
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
