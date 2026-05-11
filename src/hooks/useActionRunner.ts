import { useCallback, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import {
    ACTION_INSTRUCTIONS,
    SYSTEM_TEMPLATE,
    extractEditsFromBuffer,
    streamAI,
    synthesizeDocumentTitle,
    synthesizeAuthorStyle,
} from "@/ai-client"
import { db, upsertDocument } from "@/db"
import {
    focusSuggestion,
    plainTextWithPositions,
    suggestionsFromEdits,
} from "@/suggestions"
import type {
    ActionId,
    EditOp,
    EditSuggestion,
    RichDocument,
    Settings,
} from "@/types"

interface ActionRunnerOptions {
    editor: Editor | null
    activeDocument: RichDocument | null
    settings: Settings
    onSuggestionsChange: (suggestions: EditSuggestion[]) => void
    onFocusedIdChange: (id: string | null) => void
    onError: (msg: string | null) => void
    onSettingsOpen: () => void
    titleGenInitiated: React.MutableRefObject<Set<string>>
}

export function useActionRunner({
    editor,
    activeDocument,
    settings,
    onSuggestionsChange,
    onFocusedIdChange,
    onError,
    onSettingsOpen,
    titleGenInitiated,
}: ActionRunnerOptions) {
    const [busyAction, setBusyAction] = useState<ActionId | null>(null)
    const [streamingEditCount, setStreamingEditCount] = useState<number | null>(
        null,
    )
    const stableSuggestionIds = useRef<string[]>([])
    const abortControllerRef = useRef<AbortController | null>(null)

    const generateDocumentTitle = useCallback(
        async (docId: string, text: string, suggestions: EditSuggestion[]) => {
            try {
                const title = await synthesizeDocumentTitle({
                    ...settings,
                    text,
                })
                if (!title) return
                const latest = await db.documents.get(docId)
                if (!latest || latest.title !== "Untitled manuscript") return
                void upsertDocument({ ...latest, title, suggestions })
            } catch {}
        },
        [settings],
    )

    const runAction = useCallback(
        async (actionId: ActionId, customInstruction?: string) => {
            onError(null)
            if (!editor || !activeDocument) return

            const source = plainTextWithPositions(editor).text
            if (!source.trim()) {
                onError(
                    "Editor is empty. Paste, drop, or write some text first.",
                )
                return
            }
            if (!settings.apiKey) {
                onError("No API key set. Open Settings to add one.")
                onSettingsOpen()
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
                let authorStyle = activeDocument.authorStyle
                if (!authorStyle) {
                    try {
                        const synthesized = await synthesizeAuthorStyle({
                            ...settings,
                            text: source,
                        })
                        if (synthesized) {
                            authorStyle = synthesized
                            void upsertDocument({
                                ...activeDocument,
                                authorStyle,
                            })
                        }
                    } catch {
                        /* ignore style synthesis failures */
                    }
                }

                await streamAI({
                    ...settings,
                    systemPrompt: SYSTEM_TEMPLATE(instruction, authorStyle),
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
                        onSuggestionsChange(merged)
                        setStreamingEditCount(merged.length)
                        if (!firstSuggestionFocused && merged[0]) {
                            firstSuggestionFocused = true
                            onFocusedIdChange(merged[0].id)
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
                    onError(
                        `Could not parse editor response.\n\nRaw output:\n${rawBuffer.slice(0, 600)}`,
                    )
                    return
                }
                onSuggestionsChange(merged)
                if (!firstSuggestionFocused) {
                    onFocusedIdChange(merged[0]?.id ?? null)
                    if (merged[0]) focusSuggestion(editor, merged[0])
                }
                await upsertDocument({
                    ...activeDocument,
                    content: editor.getJSON(),
                    html: editor.getHTML(),
                    suggestions: merged,
                })

                if (
                    settings.apiKey &&
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
                    onError((e as Error).message || String(e))
            } finally {
                setBusyAction(null)
                setStreamingEditCount(null)
                abortControllerRef.current = null
            }
        },
        [
            activeDocument,
            editor,
            generateDocumentTitle,
            onError,
            onFocusedIdChange,
            onSettingsOpen,
            onSuggestionsChange,
            settings,
            titleGenInitiated,
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

    const cancelAction = useCallback(() => {
        abortControllerRef.current?.abort()
    }, [])

    return {
        busyAction,
        streamingEditCount,
        runAction,
        handleCompoundAction,
        cancelAction,
    }
}
