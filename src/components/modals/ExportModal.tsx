import {
    Clipboard,
    FileCode2,
    FileText,
    Printer,
    ScrollText,
} from "lucide-react"
import type React from "react"
import { Modal } from "./Modal"
import type { ExportFormat } from "@/import-export"

interface ExportModalProps {
    open: boolean
    onClose: () => void
    onExport: (format: ExportFormat) => void
    onCopy: () => void
}

const OPTIONS: Array<{
    format: ExportFormat
    label: string
    hint: string
    icon: React.ReactNode
}> = [
    {
        format: "docx",
        label: "DOCX",
        hint: "Editable Word document",
        icon: <ScrollText size={18} />,
    },
    {
        format: "pdf",
        label: "PDF",
        hint: "Open print-to-PDF view",
        icon: <Printer size={18} />,
    },
    {
        format: "html",
        label: "HTML",
        hint: "Preserve web formatting",
        icon: <FileCode2 size={18} />,
    },
    {
        format: "md",
        label: "Markdown",
        hint: "Portable plain markup",
        icon: <FileText size={18} />,
    },
    {
        format: "txt",
        label: "Text",
        hint: "Plain manuscript text",
        icon: <FileText size={18} />,
    },
]

export function ExportModal({
    open,
    onClose,
    onExport,
    onCopy,
}: ExportModalProps) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            kicker="Editorial — Export"
            title="Choose an output"
        >
            <div className="export-grid">
                <button
                    type="button"
                    className="export-option"
                    onClick={() => {
                        onCopy()
                        onClose()
                    }}
                >
                    <Clipboard size={18} />
                    <span>
                        <strong>Clipboard</strong>
                        <small>Rich text, ready to paste</small>
                    </span>
                </button>
                {OPTIONS.map((option) => (
                    <button
                        type="button"
                        key={option.format}
                        className="export-option"
                        onClick={() => {
                            onExport(option.format)
                            onClose()
                        }}
                    >
                        {option.icon}
                        <span>
                            <strong>{option.label}</strong>
                            <small>{option.hint}</small>
                        </span>
                    </button>
                ))}
            </div>
        </Modal>
    )
}
