import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import { SuggestionDecorations } from "./suggestionDecorations"

export const editorExtensions = [
    StarterKit.configure({
        heading: { levels: [1, 2, 3] },
    }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({
        placeholder: "Paste or write your draft here. Formatting is welcome.",
    }),
    SuggestionDecorations,
]
