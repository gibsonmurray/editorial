import { useState } from "react"
import { Modal } from "./Modal"

export interface CustomPromptModalProps {
    open: boolean
    onClose: () => void
    onSubmit: (instruction: string) => void
}

export function CustomPromptModal({
    open,
    onClose,
    onSubmit,
}: CustomPromptModalProps) {
    const [v, setV] = useState("")

    return (
        <Modal
            open={open}
            onClose={onClose}
            kicker="Editorial — Custom Instruction"
            title="A note to the editor"
            footer={
                <>
                    <button className="btn" type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn primary"
                        type="button"
                        disabled={!v.trim()}
                        onClick={() => {
                            onSubmit(v.trim())
                            setV("")
                        }}
                    >
                        Submit instruction
                    </button>
                </>
            }
        >
            <textarea
                autoFocus
                value={v}
                onChange={(e) => setV(e.target.value)}
                placeholder="e.g. Rewrite this in the voice of a Victorian novelist, keeping the meaning intact."
                className="min-h-[120px]"
            />
        </Modal>
    )
}
