import { useEffect, useRef } from "react"
import {
    EditorContent,
    useEditor,
    type Editor,
    type JSONContent,
} from "@tiptap/react"
import { editorExtensions } from "@/editor/extensions"
import {
    getEditorSuggestions,
    installSuggestionAnnotations,
    updateSuggestionDecorations,
} from "@/editor/suggestionDecorations"
import type { EditSuggestion } from "@/types"

interface RichEditorProps {
    documentId: string | null
    content: JSONContent | null
    onEditorReady: (editor: Editor | null) => void
    onChange: (
        content: JSONContent,
        html: string,
        text: string,
        suggestions: EditSuggestion[],
    ) => void
    onDropFiles: (files: File[]) => void
    onSuggestionClick?: (id: string) => void
    suggestions: EditSuggestion[]
    focusedSuggestionId: string | null
    inlineDiffs: boolean
}

export function RichEditor({
    documentId,
    content,
    onEditorReady,
    onChange,
    onDropFiles,
    onSuggestionClick,
    suggestions,
    focusedSuggestionId,
    inlineDiffs,
}: RichEditorProps) {
    const loadedDocumentId = useRef<string | null>(null)
    const editor = useEditor({
        extensions: editorExtensions,
        content: content ?? "",
        immediatelyRender: false,
        onUpdate: ({ editor: current }) => {
            onChange(
                current.getJSON(),
                current.getHTML(),
                current.getText({ blockSeparator: "\n\n" }),
                getEditorSuggestions(current),
            )
        },
        editorProps: {
            attributes: {
                class: "rich-editor-body",
                spellcheck: "false",
            },
            handleDrop: (_view, event) => {
                const files = Array.from(event.dataTransfer?.files ?? [])
                if (!files.length) return false
                event.preventDefault()
                onDropFiles(files)
                return true
            },
        },
    })

    useEffect(() => {
        onEditorReady(editor)
        return () => onEditorReady(null)
    }, [editor, onEditorReady])

    useEffect(() => {
        if (
            !editor ||
            !content ||
            !documentId ||
            loadedDocumentId.current === documentId
        )
            return
        loadedDocumentId.current = documentId
        editor.commands.setContent(content, { emitUpdate: false })
    }, [content, documentId, editor])

    useEffect(() => {
        if (!editor) return
        if (!sameSuggestionList(getEditorSuggestions(editor), suggestions)) {
            installSuggestionAnnotations(editor, suggestions)
        }
    }, [documentId, editor, suggestions])

    useEffect(() => {
        if (!editor) return
        updateSuggestionDecorations(editor, focusedSuggestionId, inlineDiffs)
    }, [editor, focusedSuggestionId, inlineDiffs])

    const handleClick = (e: React.MouseEvent) => {
        if (!onSuggestionClick) return
        const el = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-suggestion-id]",
        )
        if (el?.dataset.suggestionId) onSuggestionClick(el.dataset.suggestionId)
    }

    return (
        <div onClick={handleClick}>
            <EditorContent editor={editor} className="rich-editor" />
        </div>
    )
}

function sameSuggestionList(a: EditSuggestion[], b: EditSuggestion[]) {
    const pendingA = a.filter((item) => item.status === "pending")
    const pendingB = b.filter((item) => item.status === "pending")
    if (pendingA.length !== pendingB.length) return false
    return pendingA.every((item, index) => {
        const other = pendingB[index]
        return (
            item.id === other.id &&
            item.type === other.type &&
            item.before === other.before &&
            item.after === other.after &&
            item.tag === other.tag &&
            item.range.from === other.range.from &&
            item.range.to === other.range.to
        )
    })
}
