import { useEffect, useRef } from "react"
import {
    EditorContent,
    useEditor,
    type Editor,
    type JSONContent,
} from "@tiptap/react"
import { editorExtensions } from "@/editor/extensions"
import { updateSuggestionDecorations } from "@/editor/suggestionDecorations"
import type { EditSuggestion } from "@/types"

interface RichEditorProps {
    documentId: string | null
    content: JSONContent | null
    onEditorReady: (editor: Editor | null) => void
    onChange: (content: JSONContent, html: string, text: string) => void
    onDropFiles: (files: File[]) => void
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
        updateSuggestionDecorations(
            editor,
            suggestions,
            focusedSuggestionId,
            inlineDiffs,
        )
    }, [editor, focusedSuggestionId, inlineDiffs, suggestions])

    return <EditorContent editor={editor} className="rich-editor" />
}
