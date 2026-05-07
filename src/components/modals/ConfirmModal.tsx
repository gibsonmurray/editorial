import { Modal } from "./Modal"

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
        <Modal
            open={open}
            onClose={onClose}
            kicker="Editorial"
            title={title}
            footer={
                <>
                    <button className="btn" type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className={"btn " + (danger ? "danger" : "primary")}
                        type="button"
                        onClick={() => {
                            onConfirm()
                            onClose()
                        }}
                    >
                        {confirmLabel}
                    </button>
                </>
            }
        >
            <div
                style={{
                    fontSize: 13,
                    color: "var(--color-ink-soft)",
                    lineHeight: 1.6,
                }}
            >
                {body}
            </div>
        </Modal>
    )
}
