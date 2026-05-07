import React from "react"
import {
    Undo2,
    Redo2,
    FileCheck,
    FileX,
    CheckSquare,
    XSquare,
    FileInput,
    FileOutput,
    Copy,
    Check,
    Eraser,
    Settings2,
} from "lucide-react"

interface ToolbarButtonProps {
    icon: React.ReactNode
    label: string
    kbd?: string
    onClick?: () => void
    disabled?: boolean
    className?: string
    badge?: number
}

function ToolbarButton({
    icon,
    label,
    kbd,
    onClick,
    disabled,
    className = "",
    badge,
}: ToolbarButtonProps) {
    return (
        <button
            className={"tb-btn " + className}
            onClick={onClick}
            disabled={disabled}
        >
            <span className="ic">{icon}</span>
            <span className="lbl">
                <span>{label}</span>
                {kbd && <span className="kbd">{kbd}</span>}
            </span>
            {badge != null && badge > 0 && (
                <span className="badge-dot">{badge}</span>
            )}
        </button>
    )
}

export interface ToolbarProps {
    onUndo: () => void
    onRedo: () => void
    canUndo: boolean
    canRedo: boolean
    onAcceptFocused: () => void
    onRejectFocused: () => void
    hasFocused: boolean
    onAcceptAll: () => void
    onRejectAll: () => void
    pendingCount: number
    onImport: () => void
    onExport: () => void
    onCopy: () => void
    copied?: boolean
    onClear: () => void
    onSettings: () => void
    busy: boolean
    hasText: boolean
    hasDocument?: boolean
}

export function Toolbar({
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onAcceptFocused,
    onRejectFocused,
    hasFocused,
    onAcceptAll,
    onRejectAll,
    pendingCount,
    onImport,
    onExport,
    onCopy,
    copied = false,
    onClear,
    onSettings,
    busy,
    hasText,
    hasDocument = true,
}: ToolbarProps) {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    const cmd = isMac ? "⌘" : "Ctrl"
    const shift = "⇧"

    return (
        <div className="toolbar">
            <div className="tb-group">
                <ToolbarButton
                    icon={<Undo2 size={18} />}
                    label="Undo"
                    kbd={`${cmd}Z`}
                    onClick={onUndo}
                    disabled={!canUndo}
                />
                <ToolbarButton
                    icon={<Redo2 size={18} />}
                    label="Redo"
                    kbd={`${cmd}${shift}Z`}
                    onClick={onRedo}
                    disabled={!canRedo}
                />
            </div>
            <div className="tb-group">
                <ToolbarButton
                    icon={<FileCheck size={18} />}
                    label="Accept"
                    kbd={`${cmd}K`}
                    className="accept"
                    onClick={onAcceptFocused}
                    disabled={!hasFocused}
                />
                <ToolbarButton
                    icon={<CheckSquare size={18} />}
                    label="Accept All"
                    kbd={`${cmd}${shift}K`}
                    className="accept-all"
                    onClick={onAcceptAll}
                    disabled={!pendingCount}
                    badge={pendingCount}
                />
                <ToolbarButton
                    icon={<FileX size={18} />}
                    label="Reject"
                    kbd={`${cmd}L`}
                    className="reject"
                    onClick={onRejectFocused}
                    disabled={!hasFocused}
                />
                <ToolbarButton
                    icon={<XSquare size={18} />}
                    label="Reject All"
                    kbd={`${cmd}${shift}L`}
                    className="reject-all"
                    onClick={onRejectAll}
                    disabled={!pendingCount}
                />
            </div>
            <div className="tb-group">
                <ToolbarButton
                    icon={<FileInput size={18} />}
                    label="Import"
                    onClick={onImport}
                />
                <ToolbarButton
                    icon={<FileOutput size={18} />}
                    label="Export"
                    onClick={onExport}
                    disabled={!hasDocument || !hasText}
                />
                <ToolbarButton
                    icon={copied ? <Check size={18} /> : <Copy size={18} />}
                    label="Copy"
                    onClick={onCopy}
                    disabled={!hasDocument || !hasText}
                    className={copied ? "copied" : ""}
                />
                <ToolbarButton
                    icon={<Eraser size={18} />}
                    label="Clear"
                    onClick={onClear}
                    disabled={!hasDocument || !hasText}
                />
            </div>
            <div className="tb-group">
                <ToolbarButton
                    icon={<Settings2 size={18} />}
                    label="Settings"
                    onClick={onSettings}
                />
            </div>
            <div className="spacer" />
            <div
                className={
                    "tb-status" +
                    (busy ? " busy" : "") +
                    (pendingCount > 0 ? " has-edits" : "")
                }
            >
                <span className="dot" />
                <span className="text">
                    {busy
                        ? "Consulting editor…"
                        : pendingCount > 0
                          ? `${pendingCount} pending`
                          : hasText
                            ? "Ready"
                            : "Empty"}
                </span>
            </div>
        </div>
    )
}
