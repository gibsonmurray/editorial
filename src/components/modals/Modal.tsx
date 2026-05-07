import { type ReactNode, useEffect, useId } from "react"

interface ModalProps {
    open: boolean
    onClose: () => void
    kicker: string
    title: string
    children: ReactNode
    footer?: ReactNode
}

export function Modal({
    open,
    onClose,
    kicker,
    title,
    children,
    footer,
}: ModalProps) {
    const titleId = useId()
    const descriptionId = useId()

    useEffect(() => {
        if (!open) return

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose()
        }

        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [onClose, open])

    if (!open) return null

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
            >
                <header className="modal-head">
                    <div className="kicker" id={descriptionId}>
                        {kicker}
                    </div>
                    <h2 className="title" id={titleId}>
                        {title}
                    </h2>
                </header>

                <div className="modal-body">{children}</div>

                {footer && <footer className="modal-foot">{footer}</footer>}
            </section>
        </div>
    )
}
