import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

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
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogDescription>
                        Editorial — Custom Instruction
                    </DialogDescription>
                    <DialogTitle>A note to the editor</DialogTitle>
                </DialogHeader>

                <Textarea
                    autoFocus
                    value={v}
                    onChange={(e) => setV(e.target.value)}
                    placeholder="e.g. Rewrite this in the voice of a Victorian novelist, keeping the meaning intact."
                    className="min-h-[120px]"
                />

                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        disabled={!v.trim()}
                        onClick={() => {
                            onSubmit(v.trim())
                            setV("")
                        }}
                    >
                        Submit instruction
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
