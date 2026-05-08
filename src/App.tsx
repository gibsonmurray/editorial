import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import type { Editor, JSONContent } from "@tiptap/react"
import {
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react"
import {
    streamAI,
    extractEditsFromBuffer,
    ACTION_INSTRUCTIONS,
    SYSTEM_TEMPLATE,
    synthesizeInstructionName,
    synthesizeDocumentTitle,
} from "./ai-client"
import { createBlankDocument, db, touchInstruction, upsertDocument } from "./db"
import {
    applySuggestion,
    focusSuggestion,
    plainTextWithPositions,
    rejectSuggestionChange,
    suggestionsFromEdits,
    suggestionsNeedSync,
} from "./suggestions"
import {
    exportDocument,
    fileToImportedDocument,
    type ExportFormat,
} from "./import-export"
import type {
    ActionId,
    EditOp,
    EditSuggestion,
    ProviderId,
    RichDocument,
    SavedInstruction,
    Settings,
    Stats,
    SuggestionTag,
} from "./types"
import { Toolbar } from "@/components/Toolbar"
import { Sidebar, type SidebarMode } from "@/components/Sidebar"
import { RichEditor } from "@/components/RichEditor"
import { getEditorSuggestions } from "@/editor/suggestionDecorations"
import { SuggestionSidecar } from "@/components/SuggestionSidecar"
import { ErrorAlert } from "@/components/ErrorAlert"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { CustomPromptModal } from "@/components/modals/CustomPromptModal"
import { ConfirmModal } from "@/components/modals/ConfirmModal"
import { ExportModal } from "@/components/modals/ExportModal"

function usePersistedState<T>(
    key: string,
    initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [v, setV] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(`editorial:${key}`)
            if (raw === null) return initial
            return JSON.parse(raw) as T
        } catch {
            return initial
        }
    })
    useEffect(() => {
        try {
            localStorage.setItem(`editorial:${key}`, JSON.stringify(v))
        } catch {}
    }, [key, v])
    return [v, setV]
}

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(
        () => window.matchMedia(query).matches,
    )

    useEffect(() => {
        const media = window.matchMedia(query)
        const update = () => setMatches(media.matches)
        update()
        media.addEventListener("change", update)
        return () => media.removeEventListener("change", update)
    }, [query])

    return matches
}

function fallbackInstructionName(instruction: string) {
    const words = instruction
        .replace(/[^\w\s'-]/g, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
    return (
        words
            .map(
                (word) =>
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
            )
            .join(" ") || "Custom Instruction"
    )
}

function wordsAndChars(text: string): Stats {
    return {
        words: (text.trim().match(/\S+/g) ?? []).length,
        chars: text.length,
    }
}

export default function App() {
    const [provider, setProvider] = usePersistedState<ProviderId>(
        "provider",
        "anthropic",
    )
    const [model, setModel] = usePersistedState<string>(
        "model",
        "claude-opus-4-5",
    )
    const [apiKey, setApiKey] = usePersistedState<string>("apiKey", "")
    const [baseURL, setBaseURL] = usePersistedState<string>("baseURL", "")
    const [activeDocumentId, setActiveDocumentId] = usePersistedState<
        string | null
    >("activeDocumentId", null)
    const [sidebarMode, setSidebarMode] = usePersistedState<SidebarMode>(
        "sidebarMode",
        "documents",
    )
    const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState<boolean>(
        "sidebarCollapsed",
        false,
    )
    const [suggestionsCollapsed, setSuggestionsCollapsed] =
        usePersistedState<boolean>("suggestionsCollapsed", false)
    const [inlineDiffs, setInlineDiffs] = usePersistedState<boolean>(
        "inlineDiffs",
        true,
    )

    const documents = useLiveQuery(
        () => db.documents.orderBy("updatedAt").reverse().toArray(),
        [],
        [],
    )
    const instructions = useLiveQuery(
        () => db.instructions.orderBy("updatedAt").reverse().toArray(),
        [],
        [],
    )

    const [editor, setEditor] = useState<Editor | null>(null)
    const [editorText, setEditorText] = useState("")
    const [localSuggestions, setLocalSuggestions] = useState<EditSuggestion[]>(
        [],
    )
    const [focusedSuggestionId, setFocusedSuggestionId] = useState<
        string | null
    >(null)
    const [suggestionFilter, setSuggestionFilter] = useState<
        SuggestionTag | "all"
    >("all")
    const [busyAction, setBusyAction] = useState<ActionId | null>(null)
    const [streamingEditCount, setStreamingEditCount] = useState<number | null>(
        null,
    )
    const stableSuggestionIds = useRef<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [customOpen, setCustomOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [confirmClear, setConfirmClear] = useState(false)
    const [documentToDelete, setDocumentToDelete] =
        useState<RichDocument | null>(null)
    const [copied, setCopied] = useState(false)
    const [titleEditing, setTitleEditing] = useState(false)
    const [titleDraft, setTitleDraft] = useState("")
    const compactLayout = useMediaQuery("(max-width: 900px)")
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const [mobileSuggestionsOpen, setMobileSuggestionsOpen] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const saveTimer = useRef<number | null>(null)
    const titleGenInitiated = useRef(new Set<string>())
    const abortControllerRef = useRef<AbortController | null>(null)

    const activeDocument = useMemo(
        () => documents.find((doc) => doc.id === activeDocumentId) ?? null,
        [activeDocumentId, documents],
    )

    useEffect(() => {
        if (activeDocumentId && !activeDocument) setActiveDocumentId(null)
    }, [activeDocument, activeDocumentId, documents, setActiveDocumentId])

    useEffect(() => {
        if (activeDocument) setSidebarMode("marks")
    }, [activeDocument?.id]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setLocalSuggestions(activeDocument?.suggestions ?? [])
        setFocusedSuggestionId(
            activeDocument?.suggestions.find((s) => s.status === "pending")
                ?.id ?? null,
        )
    }, [activeDocument?.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const settings: Settings = { provider, model, apiKey, baseURL }
    const setSettings = (next: Settings) => {
        setProvider(next.provider)
        setModel(next.model)
        setApiKey(next.apiKey)
        setBaseURL(next.baseURL)
    }

    const fallbackText = activeDocument?.html.replace(/<[^>]*>/g, " ") ?? ""
    const currentText = editorText || fallbackText
    const stats = useMemo(() => wordsAndChars(currentText), [currentText])
    const pendingCount = localSuggestions.filter(
        (s) => s.status === "pending",
    ).length
    const hasText = !!currentText.trim()
    const hasDocument = !!activeDocument
    const effectiveSidebarCollapsed = compactLayout
        ? !mobileSidebarOpen
        : sidebarCollapsed
    const effectiveSuggestionsCollapsed = compactLayout
        ? !mobileSuggestionsOpen
        : suggestionsCollapsed

    useEffect(() => {
        if (!compactLayout) {
            setMobileSidebarOpen(false)
            setMobileSuggestionsOpen(false)
        }
    }, [compactLayout])

    const persistActiveDocument = useCallback(
        (patch: Partial<RichDocument>) => {
            if (!activeDocument) return
            void upsertDocument({
                ...activeDocument,
                suggestions: localSuggestions,
                ...patch,
            })
        },
        [activeDocument, localSuggestions],
    )

    const generateDocumentTitle = useCallback(
        async (docId: string, text: string, suggestions: EditSuggestion[]) => {
            try {
                const title = await synthesizeDocumentTitle({
                    provider,
                    model,
                    apiKey,
                    baseURL,
                    text,
                })
                if (!title) return
                const latest = await db.documents.get(docId)
                if (!latest || latest.title !== "Untitled manuscript") return
                void upsertDocument({ ...latest, title, suggestions })
            } catch {}
        },
        [apiKey, baseURL, model, provider],
    )

    const scheduleDocumentSave = useCallback(
        (
            content: JSONContent,
            html: string,
            text: string,
            suggestions: EditSuggestion[],
        ) => {
            setEditorText(text)
            setLocalSuggestions((current) =>
                suggestionsNeedSync(current, suggestions)
                    ? suggestions
                    : current,
            )
            if (!activeDocument) return
            if (saveTimer.current) window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => {
                void upsertDocument({
                    ...activeDocument,
                    content,
                    html,
                    suggestions,
                })
            }, 300)
        },
        [activeDocument],
    )

    const createDocumentFromHtml = useCallback(
        async (title: string, html: string) => {
            if (!editor) return
            editor.commands.setContent(html, { emitUpdate: false })
            const next = createBlankDocument(title)
            const doc: RichDocument = {
                ...next,
                content: editor.getJSON(),
                html: editor.getHTML(),
                suggestions: [],
            }
            await upsertDocument(doc)
            setActiveDocumentId(doc.id)
        },
        [editor, setActiveDocumentId],
    )

    const importFiles = useCallback(
        async (files: File[]) => {
            setError(null)
            try {
                for (const file of files) {
                    const imported = await fileToImportedDocument(file)
                    await createDocumentFromHtml(imported.title, imported.html)
                }
            } catch (e) {
                setError((e as Error).message || String(e))
            }
        },
        [createDocumentFromHtml],
    )

    const runAction = useCallback(
        async (actionId: ActionId, customInstruction?: string) => {
            setError(null)
            if (!editor || !activeDocument) return
            const source = plainTextWithPositions(editor).text
            if (!source.trim()) {
                setError(
                    "Editor is empty. Paste, drop, or write some text first.",
                )
                return
            }
            if (!apiKey) {
                setError("No API key set. Open Settings to add one.")
                setSettingsOpen(true)
                return
            }

            const instruction =
                actionId === "custom"
                    ? (customInstruction ?? "")
                    : ACTION_INSTRUCTIONS[
                          actionId as Exclude<ActionId, "custom">
                      ]
            if (!instruction) return

            setBusyAction(actionId)
            stableSuggestionIds.current = []
            const accEdits: EditOp[] = []
            let bufferCursor = 0
            let rawBuffer = ""
            let firstSuggestionFocused = false
            const abortController = new AbortController()
            abortControllerRef.current = abortController

            try {
                await streamAI({
                    provider,
                    model,
                    apiKey,
                    baseURL,
                    systemPrompt: SYSTEM_TEMPLATE(instruction),
                    userText: source,
                    signal: abortController.signal,
                    onChunk: (text) => {
                        rawBuffer += text
                        const { ops, cursor } = extractEditsFromBuffer(
                            rawBuffer,
                            bufferCursor,
                        )
                        if (ops.length === 0) return
                        bufferCursor = cursor
                        accEdits.push(...ops)
                        const fresh = suggestionsFromEdits(editor, accEdits)
                        const merged = fresh.map((s, i) => ({
                            ...s,
                            id: stableSuggestionIds.current[i] ?? s.id,
                        }))
                        stableSuggestionIds.current = merged.map((s) => s.id)
                        setLocalSuggestions(merged)
                        setStreamingEditCount(merged.length)
                        if (!firstSuggestionFocused && merged[0]) {
                            firstSuggestionFocused = true
                            setFocusedSuggestionId(merged[0].id)
                            focusSuggestion(editor, merged[0])
                        }
                    },
                })

                const finalSuggestions = suggestionsFromEdits(editor, accEdits)
                const merged = finalSuggestions.map((s, i) => ({
                    ...s,
                    id: stableSuggestionIds.current[i] ?? s.id,
                }))
                if (merged.length === 0 && accEdits.length === 0) {
                    // nothing came through — rawBuffer has the full response for error reporting
                    setError(
                        `Could not parse editor response.\n\nRaw output:\n${rawBuffer.slice(0, 600)}`,
                    )
                    return
                }
                setLocalSuggestions(merged)
                if (!firstSuggestionFocused) {
                    setFocusedSuggestionId(merged[0]?.id ?? null)
                    if (merged[0]) focusSuggestion(editor, merged[0])
                }
                await upsertDocument({
                    ...activeDocument,
                    content: editor.getJSON(),
                    html: editor.getHTML(),
                    suggestions: merged,
                })

                if (
                    apiKey &&
                    activeDocument.title === "Untitled manuscript" &&
                    !titleGenInitiated.current.has(activeDocument.id)
                ) {
                    titleGenInitiated.current.add(activeDocument.id)
                    void generateDocumentTitle(
                        activeDocument.id,
                        source,
                        merged,
                    )
                }
            } catch (e) {
                if ((e as Error).name !== "AbortError")
                    setError((e as Error).message || String(e))
            } finally {
                setBusyAction(null)
                setStreamingEditCount(null)
                abortControllerRef.current = null
            }
        },
        [
            activeDocument,
            apiKey,
            baseURL,
            editor,
            generateDocumentTitle,
            model,
            provider,
        ],
    )

    const handleCompoundAction = useCallback(
        async (ids: ActionId[]) => {
            if (ids.length === 0) return
            if (ids.length === 1) {
                await runAction(ids[0])
                return
            }
            const numbered = ids
                .map(
                    (id, i) =>
                        `${i + 1}. ${ACTION_INSTRUCTIONS[id as Exclude<ActionId, "custom">]}`,
                )
                .join("\n\n")
            const combined =
                `Apply ALL of the following editorial goals in a single unified pass. ` +
                `Address every goal simultaneously with the same set of targeted edits:\n\n` +
                numbered
            await runAction("custom", combined)
        },
        [runAction],
    )

    const handleCustomInstruction = async (
        instruction: string,
        existingId?: string,
    ) => {
        setCustomOpen(false)
        if (existingId) {
            await touchInstruction(existingId)
            await runAction("custom", instruction)
            return
        }

        let name = fallbackInstructionName(instruction)
        if (apiKey) {
            try {
                name = await synthesizeInstructionName({
                    provider,
                    model,
                    apiKey,
                    baseURL,
                    instruction,
                })
            } catch {
                name = fallbackInstructionName(instruction)
            }
        }
        const item: SavedInstruction = {
            id: crypto.randomUUID(),
            name,
            instruction,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastUsedAt: Date.now(),
        }
        await db.instructions.add(item)
        await runAction("custom", instruction)
    }

    const updateSuggestions = (next: EditSuggestion[]) => {
        setLocalSuggestions(next)
        persistActiveDocument({
            content: editor?.getJSON(),
            html: editor?.getHTML(),
            suggestions: next,
        })
    }

    const acceptSuggestion = (id: string) => {
        if (!editor) return
        const suggestion = getEditorSuggestions(editor).find(
            (s) => s.id === id && s.status === "pending",
        )
        if (!suggestion) return
        applySuggestion(editor, suggestion)
        const next = getEditorSuggestions(editor)
        const nextPending = next.find((s) => s.status === "pending")
        updateSuggestions(next)
        setFocusedSuggestionId(nextPending?.id ?? null)
        if (nextPending) focusSuggestion(editor, nextPending)
    }

    const rejectSuggestion = (id: string) => {
        if (!editor) return
        const suggestion = getEditorSuggestions(editor).find(
            (s) => s.id === id && s.status === "pending",
        )
        if (!suggestion) return
        rejectSuggestionChange(editor, suggestion)
        const next = getEditorSuggestions(editor)
        const nextPending = next.find((s) => s.status === "pending")
        updateSuggestions(next)
        setFocusedSuggestionId(nextPending?.id ?? null)
        if (nextPending) focusSuggestion(editor, nextPending)
    }

    const focusSidecarSuggestion = (id: string) => {
        const suggestion = localSuggestions.find((s) => s.id === id)
        setFocusedSuggestionId(id)
        if (editor && suggestion) focusSuggestion(editor, suggestion)
    }

    const acceptAll = () => {
        if (!editor) return
        const pending = [...getEditorSuggestions(editor)]
            .filter((s) => s.status === "pending")
            .sort((a, b) => b.range.from - a.range.from)
        pending.forEach((suggestion) => applySuggestion(editor, suggestion))
        const next = getEditorSuggestions(editor)
        updateSuggestions(next)
        setFocusedSuggestionId(null)
    }

    const rejectAll = () => {
        if (!editor) return
        const pending = [...getEditorSuggestions(editor)]
            .filter((s) => s.status === "pending")
            .sort((a, b) => b.range.from - a.range.from)
        pending.forEach((suggestion) =>
            rejectSuggestionChange(editor, suggestion),
        )
        const next = getEditorSuggestions(editor)
        updateSuggestions(next)
        setFocusedSuggestionId(null)
    }

    const handleAction = (id: ActionId) => {
        if (id === "custom") setCustomOpen(true)
        else void runAction(id)
    }

    const onExport = async (format: ExportFormat) => {
        if (!editor || !activeDocument) return
        try {
            await exportDocument(editor, activeDocument.title, format)
        } catch (e) {
            setError((e as Error).message || String(e))
        }
    }

    const onCopy = () => {
        if (!editor) return
        void navigator.clipboard
            .write([
                new ClipboardItem({
                    "text/html": new Blob([editor.getHTML()], {
                        type: "text/html",
                    }),
                    "text/plain": new Blob(
                        [editor.getText({ blockSeparator: "\n\n" })],
                        { type: "text/plain" },
                    ),
                }),
            ])
            .catch(() =>
                navigator.clipboard.writeText(
                    editor.getText({ blockSeparator: "\n\n" }),
                ),
            )
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
    }

    const clearDocument = () => {
        if (!editor) return
        editor.commands.clearContent()
        setLocalSuggestions([])
        persistActiveDocument({
            content: editor.getJSON(),
            html: editor.getHTML(),
            suggestions: [],
        })
    }

    const deleteDocument = async (doc: RichDocument) => {
        await db.documents.delete(doc.id)
        if (activeDocumentId !== doc.id) return
        setActiveDocumentId(null)
    }

    const activeSuggestion = focusedSuggestionId
        ? localSuggestions.find(
              (s) => s.id === focusedSuggestionId && s.status === "pending",
          )
        : null
    const toggleSidebar = () => {
        if (compactLayout) setMobileSidebarOpen((open) => !open)
        else setSidebarCollapsed((v) => !v)
    }
    const toggleSuggestions = () => {
        if (compactLayout) setMobileSuggestionsOpen((open) => !open)
        else setSuggestionsCollapsed((v) => !v)
    }

    return (
        <div
            className={
                "app" +
                (effectiveSuggestionsCollapsed
                    ? " suggestions-collapsed"
                    : "") +
                (effectiveSidebarCollapsed ? " sidebar-collapsed" : "")
            }
        >
            <div className="paper-grain coarse" />
            <div className="paper-grain" />

            <div className="mobile-topbar">
                <button
                    type="button"
                    className={
                        "mobile-topbar-btn" +
                        (mobileSidebarOpen ? " active" : "")
                    }
                    onClick={() => {
                        setMobileSidebarOpen((open) => !open)
                        setMobileSuggestionsOpen(false)
                    }}
                    title={
                        mobileSidebarOpen ? "Hide documents" : "Show documents"
                    }
                    aria-label={
                        mobileSidebarOpen ? "Hide documents" : "Show documents"
                    }
                    aria-expanded={mobileSidebarOpen}
                >
                    {mobileSidebarOpen ? (
                        <PanelLeftClose size={18} />
                    ) : (
                        <PanelLeftOpen size={18} />
                    )}
                </button>
                <span className="mobile-topbar-title">Editorial</span>
                <button
                    type="button"
                    className={
                        "mobile-topbar-btn review" +
                        (mobileSuggestionsOpen ? " active" : "")
                    }
                    onClick={() => {
                        setMobileSuggestionsOpen((open) => !open)
                        setMobileSidebarOpen(false)
                    }}
                    title={
                        mobileSuggestionsOpen
                            ? "Hide suggestions"
                            : "Show suggestions"
                    }
                    aria-label={
                        mobileSuggestionsOpen
                            ? "Hide suggestions"
                            : "Show suggestions"
                    }
                    aria-expanded={mobileSuggestionsOpen}
                >
                    {mobileSuggestionsOpen ? (
                        <PanelRightClose size={18} />
                    ) : (
                        <PanelRightOpen size={18} />
                    )}
                    <span>{pendingCount}</span>
                </button>
            </div>

            <Sidebar
                onAction={handleAction}
                onCompoundAction={handleCompoundAction}
                busyAction={busyAction}
                loading={!!busyAction}
                hasText={hasText}
                hasDocument={hasDocument}
                hasKey={!!apiKey}
                stats={stats}
                documents={documents}
                activeDocumentId={activeDocument?.id ?? null}
                mode={sidebarMode}
                sidebarCollapsed={effectiveSidebarCollapsed}
                onModeChange={setSidebarMode}
                onToggleSidebar={toggleSidebar}
                onNewDocument={async () => {
                    const doc = createBlankDocument()
                    await upsertDocument(doc)
                    setActiveDocumentId(doc.id)
                }}
                onSelectDocument={setActiveDocumentId}
                onDeleteDocument={(id) => {
                    const doc = documents.find((item) => item.id === id)
                    if (doc) setDocumentToDelete(doc)
                }}
            />

            <main className="pane">
                <Toolbar
                    onUndo={() => editor?.chain().focus().undo().run()}
                    onRedo={() => editor?.chain().focus().redo().run()}
                    canUndo={!!editor}
                    canRedo={!!editor}
                    onAcceptFocused={() => {
                        if (focusedSuggestionId)
                            acceptSuggestion(focusedSuggestionId)
                    }}
                    onRejectFocused={() => {
                        if (focusedSuggestionId)
                            rejectSuggestion(focusedSuggestionId)
                    }}
                    hasFocused={!!activeSuggestion}
                    onAcceptAll={acceptAll}
                    onRejectAll={rejectAll}
                    pendingCount={pendingCount}
                    onImport={() => fileInputRef.current?.click()}
                    onExport={() => setExportOpen(true)}
                    onCopy={onCopy}
                    copied={copied}
                    onClear={() => setConfirmClear(true)}
                    onSettings={() => setSettingsOpen(true)}
                    busy={!!busyAction}
                    onCancel={() => abortControllerRef.current?.abort()}
                    streamingEditCount={streamingEditCount}
                    hasText={hasText}
                    hasDocument={hasDocument}
                />

                {error && (
                    <ErrorAlert
                        error={error}
                        onDismiss={() => setError(null)}
                    />
                )}

                <div className="canvas">
                    <div className="canvas-frame">
                        <span className="corner tl" />
                        <span className="corner tr" />
                        <span className="corner bl" />
                        <span className="corner br" />
                        <div className="canvas-header">
                            {activeDocument && titleEditing ? (
                                <input
                                    className="title-edit"
                                    autoFocus
                                    value={titleDraft}
                                    onChange={(e) =>
                                        setTitleDraft(e.target.value)
                                    }
                                    onBlur={() => {
                                        setTitleEditing(false)
                                        const next = titleDraft.trim()
                                        if (
                                            next &&
                                            next !== activeDocument.title
                                        )
                                            void upsertDocument({
                                                ...activeDocument,
                                                title: next,
                                            })
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                            e.currentTarget.blur()
                                        if (e.key === "Escape") {
                                            setTitleDraft(activeDocument.title)
                                            setTitleEditing(false)
                                        }
                                    }}
                                />
                            ) : (
                                <span
                                    className={
                                        activeDocument ? "title-label" : ""
                                    }
                                    onClick={() => {
                                        if (!activeDocument) return
                                        setTitleDraft(activeDocument.title)
                                        setTitleEditing(true)
                                    }}
                                >
                                    {activeDocument?.title ??
                                        "No document selected"}
                                </span>
                            )}
                            <span className="right">
                                <span
                                    className={`pill ${pendingCount > 0 ? "review" : ""}`}
                                >
                                    <span className="swatch" />
                                    {activeDocument
                                        ? pendingCount > 0
                                            ? `${pendingCount} pending edit${pendingCount === 1 ? "" : "s"}`
                                            : "No pending edits"
                                        : "No document"}
                                </span>
                                <span>
                                    {stats.words} words · {stats.chars} chars
                                </span>
                            </span>
                        </div>
                        <div className="editor-area">
                            {activeDocument ? (
                                <RichEditor
                                    documentId={activeDocument.id}
                                    content={activeDocument.content}
                                    onEditorReady={setEditor}
                                    onChange={scheduleDocumentSave}
                                    onDropFiles={(files) => {
                                        void importFiles(files)
                                    }}
                                    onSuggestionClick={
                                        !effectiveSuggestionsCollapsed
                                            ? focusSidecarSuggestion
                                            : undefined
                                    }
                                    suggestions={localSuggestions}
                                    focusedSuggestionId={focusedSuggestionId}
                                    inlineDiffs={inlineDiffs}
                                />
                            ) : documents.length > 0 ? (
                                <div className="empty-canvas">
                                    <h2>No document selected</h2>
                                    <p>
                                        Choose a document from the sidebar to
                                        open it.
                                    </p>
                                </div>
                            ) : (
                                <div className="empty-canvas">
                                    <h2>No documents</h2>
                                    <p>
                                        Create a blank document or import a rich
                                        text file to begin.
                                    </p>
                                    <div>
                                        <button
                                            type="button"
                                            className="btn primary"
                                            onClick={async () => {
                                                const doc =
                                                    createBlankDocument()
                                                await upsertDocument(doc)
                                                setActiveDocumentId(doc.id)
                                            }}
                                        >
                                            New Document
                                        </button>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={() =>
                                                fileInputRef.current?.click()
                                            }
                                        >
                                            Import File
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="status-line">
                        <span>
                            {provider.toUpperCase()} · {model || "—"}
                        </span>
                        <span>
                            {busyAction
                                ? "⟳ consulting the editor…"
                                : copied
                                  ? "✓ copied rich text"
                                  : pendingCount > 0
                                    ? `${pendingCount} pending change${pendingCount === 1 ? "" : "s"}`
                                    : "autosaved locally"}
                        </span>
                    </div>
                </div>
            </main>

            <SuggestionSidecar
                suggestions={localSuggestions}
                focusedId={focusedSuggestionId}
                filter={suggestionFilter}
                collapsed={effectiveSuggestionsCollapsed}
                inlineDiffs={inlineDiffs}
                onFilter={setSuggestionFilter}
                onToggleCollapsed={toggleSuggestions}
                onInlineDiffsChange={setInlineDiffs}
                onFocus={focusSidecarSuggestion}
                onAccept={acceptSuggestion}
                onReject={rejectSuggestion}
            />

            <input
                type="file"
                accept=".txt,.md,.html,.htm,.docx,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                ref={fileInputRef}
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) void importFiles(files)
                    e.target.value = ""
                }}
                style={{ display: "none" }}
            />

            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={settings}
                setSettings={setSettings}
            />
            <CustomPromptModal
                open={customOpen}
                onClose={() => setCustomOpen(false)}
                instructions={instructions}
                onSubmit={handleCustomInstruction}
            />
            <ExportModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                onExport={(format) => {
                    void onExport(format)
                }}
                onCopy={onCopy}
            />
            <ConfirmModal
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                title="Clear the manuscript?"
                body="This empties the current document and discards pending edits. The document remains in your library."
                confirmLabel="Clear"
                danger
                onConfirm={clearDocument}
            />
            <ConfirmModal
                open={!!documentToDelete}
                onClose={() => setDocumentToDelete(null)}
                title="Delete this document?"
                body={`This removes "${documentToDelete?.title ?? "Untitled manuscript"}" from this browser. This cannot be undone.`}
                confirmLabel="Delete"
                danger
                onConfirm={() => {
                    if (documentToDelete) void deleteDocument(documentToDelete)
                    setDocumentToDelete(null)
                }}
            />
        </div>
    )
}
