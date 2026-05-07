import type { JSONContent } from "@tiptap/react"

export type SegmentStatus = "pending" | "accepted" | "rejected"

export interface KeepSegment {
    id: string
    kind: "keep"
    text: string
}

export interface EditSegment {
    id: string
    kind: "edit"
    before: string
    after: string
    status: SegmentStatus
}

export type Segment = KeepSegment | EditSegment

export type EditType = "delete" | "replace" | "insert"

export type SuggestionTag =
    | "grammar"
    | "punctuation"
    | "clarity"
    | "style"
    | "tone"
    | "concision"
    | "insertion"
    | "deletion"

export interface EditOp {
    type: EditType
    original?: string
    replacement?: string
    after?: string
    text?: string
    tag?: SuggestionTag
}

export type ProviderId =
    | "anthropic"
    | "openai"
    | "google"
    | "mistral"
    | "groq"
    | "openrouter"
export type ActionId =
    | "grammar"
    | "light"
    | "proofread"
    | "natural"
    | "streamline"
    | "improve"
    | "rewrite"
    | "formal"
    | "concise"
    | "custom"

export interface Provider {
    id: ProviderId
    label: string
    defaultModel: string
}

export interface Action {
    id: ActionId
    name: string
    glyph: string
    hint: string
    primary?: boolean
}

export interface Settings {
    provider: ProviderId
    model: string
    apiKey: string
    baseURL: string
}

export interface HistoryEntry {
    id: string
    actionId: string
    name: string
    glyph: string
    when: string
    preview: string
    snapshot: { text: string; segments: Segment[] }
}

export interface Stats {
    words: number
    chars: number
}

export interface Snapshot {
    text: string
    segments: Segment[]
}

export interface SuggestionRange {
    from: number
    to: number
}

export interface EditSuggestion {
    id: string
    type: EditType
    before: string
    after: string
    tag: SuggestionTag
    status: SegmentStatus
    range: SuggestionRange
}

export interface RichDocument {
    id: string
    title: string
    content: JSONContent
    html: string
    suggestions: EditSuggestion[]
    createdAt: number
    updatedAt: number
}

export interface SavedInstruction {
    id: string
    name: string
    instruction: string
    createdAt: number
    updatedAt: number
    lastUsedAt?: number
}
