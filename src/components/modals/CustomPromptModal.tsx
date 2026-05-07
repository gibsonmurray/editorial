import { useState } from "react"
import { Modal } from "./Modal"
import type { SavedInstruction } from "@/types"

export interface CustomPromptModalProps {
    open: boolean
    onClose: () => void
    instructions: SavedInstruction[]
    onSubmit: (instruction: string, existingId?: string) => void
}

export function CustomPromptModal({
    open,
    onClose,
    instructions,
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
            {instructions.length > 0 && (
                <div className="saved-instructions">
                    {instructions.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className="saved-instruction"
                            onClick={() => {
                                onSubmit(item.instruction, item.id)
                                setV("")
                            }}
                        >
                            <span>{item.name}</span>
                            <small>{item.instruction}</small>
                        </button>
                    ))}
                </div>
            )}
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
