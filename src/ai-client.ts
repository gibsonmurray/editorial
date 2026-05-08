import type { ActionId, EditOp, ProviderId } from "./types"

type CoreActionId = Exclude<ActionId, "custom">

export const ACTION_INSTRUCTIONS: Record<CoreActionId, string> = {
    grammar:
        "Fix grammar, spelling, punctuation, and obvious typos. Do not change wording, voice, or sentence structure beyond what's mechanically wrong.",
    light: "Make a light editorial pass. Fix only clear errors and obvious awkwardness. Preserve voice. Be very conservative.",
    proofread:
        "Proofread carefully and thoroughly. Fix grammar, spelling, punctuation, agreement, capitalization, and clear stylistic missteps. Preserve voice and meaning.",
    natural:
        "Make the writing sound more natural and human. Smooth out stilted phrasing, awkward constructions, and anything that reads as robotic. Preserve all meaning.",
    streamline:
        "Streamline the prose. Improve flow and transitions, fix choppy or run-on sentences, and make sentences read more cleanly. Preserve voice and meaning.",
    improve:
        "Improve the writing. Strengthen weak verbs, replace vague words with specific ones, vary sentence rhythm, and elevate phrasing. Preserve voice and meaning.",
    rewrite:
        "Rewrite for clarity and impact. You may restructure sentences and reword more aggressively, but preserve the author's intent and all factual content.",
    formal: "Make the writing more formal and professional. Remove contractions, elevate diction, replace colloquialisms with formal equivalents.",
    concise:
        "Tighten the prose. Remove filler words, redundancies, and weak hedges. Keep the substance intact.",
}

export const SYSTEM_TEMPLATE = (instruction: string): string =>
    `You are a professional editor. The user will give you text to edit.

Return ONLY a JSON object (no markdown, no explanation, no code fences) in this exact shape:
{
  "edits": [
    { "type": "delete", "original": "text to remove", "tag": "deletion" },
    { "type": "insert", "after": "anchor text", "text": "text to add", "tag": "insertion" },
    { "type": "replace", "original": "old text", "replacement": "new text", "tag": "grammar" }
  ]
}

Rules:
- "original" and "after" must be EXACT substrings of the user's text (preserve casing and whitespace).
- Every edit must include one tag: grammar, punctuation, clarity, style, tone, concision, insertion, or deletion.
- For replacements, make "original" and "replacement" the smallest changed span only. Do not include unchanged words around the edit.
- Make small, targeted edits rather than one giant replace covering the whole text.
- Each edit operates on a distinct piece of text. Do not overlap edits.
- Do not replace curly/smart quotes or apostrophes (‘’””) with straight ones (‘”). You may correct a curly quote that is the wrong direction (e.g. ‘ used where ‘ is correct).
- If no changes are needed, return {"edits": []}.

Apply this rule: ${instruction}`

export interface CallAIOptions {
    provider: ProviderId
    model: string
    apiKey: string
    baseURL: string
    systemPrompt: string
    userText: string
    signal?: AbortSignal
}

export interface StreamAIOptions extends CallAIOptions {
    onChunk: (text: string) => void
}

async function readSSEStream(
    response: Response,
    onData: (line: string) => void,
    signal?: AbortSignal,
): Promise<void> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
        while (true) {
            if (signal?.aborted) break
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed.startsWith("data: ")) onData(trimmed.slice(6))
            }
        }
    } finally {
        reader.releaseLock()
    }
}

export async function streamAI({
    provider,
    model,
    apiKey,
    baseURL,
    systemPrompt,
    userText,
    signal,
    onChunk,
}: StreamAIOptions): Promise<void> {
    if (!apiKey) throw new Error("Missing API key.")
    if (!model) throw new Error("Missing model.")

    if (provider === "anthropic") {
        const url =
            (baseURL?.trim() || "https://api.anthropic.com") + "/v1/messages"
        const res = await fetch(url, {
            method: "POST",
            signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                stream: true,
                system: systemPrompt,
                messages: [{ role: "user", content: userText }],
            }),
        })
        if (!res.ok) {
            const t = await res.text()
            throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`)
        }
        await readSSEStream(
            res,
            (data) => {
                try {
                    const parsed = JSON.parse(data) as {
                        type?: string
                        delta?: { type?: string; text?: string }
                    }
                    if (
                        parsed.type === "content_block_delta" &&
                        parsed.delta?.type === "text_delta" &&
                        parsed.delta.text
                    )
                        onChunk(parsed.delta.text)
                } catch {
                    // ignore malformed SSE lines
                }
            },
            signal,
        )
        return
    }

    const defaultBase: Partial<Record<ProviderId, string>> = {
        openai: "https://api.openai.com",
        google: "https://generativelanguage.googleapis.com/v1beta/openai",
        mistral: "https://api.mistral.ai",
        groq: "https://api.groq.com/openai",
        openrouter: "https://openrouter.ai/api",
    }
    const url =
        (baseURL?.trim() || defaultBase[provider] || "https://api.openai.com") +
        "/v1/chat/completions"

    const res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText },
            ],
            temperature: 0.3,
            stream: true,
        }),
    })
    if (!res.ok) {
        const t = await res.text()
        throw new Error(`${provider} ${res.status}: ${t.slice(0, 300)}`)
    }
    await readSSEStream(
        res,
        (data) => {
            if (data === "[DONE]") return
            try {
                const parsed = JSON.parse(data) as {
                    choices?: Array<{ delta?: { content?: string } }>
                }
                const text = parsed.choices?.[0]?.delta?.content
                if (text) onChunk(text)
            } catch {
                // ignore malformed SSE lines
            }
        },
        signal,
    )
}

export function extractEditsFromBuffer(
    buffer: string,
    cursor: number,
): { ops: EditOp[]; cursor: number } {
    const editsKeyIdx = buffer.indexOf('"edits"')
    if (editsKeyIdx === -1) return { ops: [], cursor }
    const arrayStart = buffer.indexOf("[", editsKeyIdx)
    if (arrayStart === -1) return { ops: [], cursor }

    let pos = Math.max(cursor, arrayStart + 1)
    const ops: EditOp[] = []

    while (pos < buffer.length) {
        while (pos < buffer.length && /[\s,]/.test(buffer[pos])) pos++
        if (pos >= buffer.length || buffer[pos] === "]") break
        if (buffer[pos] !== "{") break

        let depth = 0
        let i = pos
        let inStr = false
        let esc = false

        while (i < buffer.length) {
            const c = buffer[i]
            if (esc) {
                esc = false
                i++
                continue
            }
            if (c === "\\" && inStr) {
                esc = true
                i++
                continue
            }
            if (c === '"') {
                inStr = !inStr
                i++
                continue
            }
            if (!inStr) {
                if (c === "{") depth++
                else if (c === "}") {
                    depth--
                    if (depth === 0) {
                        i++
                        break
                    }
                }
            }
            i++
        }

        if (depth !== 0) break // incomplete object — wait for more tokens

        const objStr = buffer.slice(pos, i)
        try {
            const op = JSON.parse(objStr) as EditOp
            if (op.type) ops.push(op)
        } catch {
            /* malformed, skip */
        }
        pos = i
    }

    return { ops, cursor: pos }
}

export async function callAI({
    provider,
    model,
    apiKey,
    baseURL,
    systemPrompt,
    userText,
    signal,
}: CallAIOptions): Promise<string> {
    if (!apiKey) throw new Error("Missing API key.")
    if (!model) throw new Error("Missing model.")

    if (provider === "anthropic") {
        const url =
            (baseURL?.trim() || "https://api.anthropic.com") + "/v1/messages"
        const res = await fetch(url, {
            method: "POST",
            signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: "user", content: userText }],
            }),
        })
        if (!res.ok) {
            const t = await res.text()
            throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`)
        }
        const data = (await res.json()) as {
            content?: Array<{ text?: string }>
        }
        return data?.content?.map((b) => b.text ?? "").join("") ?? ""
    }

    const defaultBase: Partial<Record<ProviderId, string>> = {
        openai: "https://api.openai.com",
        google: "https://generativelanguage.googleapis.com/v1beta/openai",
        mistral: "https://api.mistral.ai",
        groq: "https://api.groq.com/openai",
        openrouter: "https://openrouter.ai/api",
    }
    const url =
        (baseURL?.trim() || defaultBase[provider] || "https://api.openai.com") +
        "/v1/chat/completions"

    const res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText },
            ],
            temperature: 0.3,
        }),
    })
    if (!res.ok) {
        const t = await res.text()
        throw new Error(`${provider} ${res.status}: ${t.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
    }
    return data?.choices?.[0]?.message?.content ?? ""
}

export async function synthesizeInstructionName(
    options: Omit<CallAIOptions, "systemPrompt" | "userText"> & {
        instruction: string
    },
): Promise<string> {
    const raw = await callAI({
        ...options,
        systemPrompt:
            'Name this editing instruction. Return ONLY JSON like {"name":"Short Name"}. Use 2 to 5 words, title case, no punctuation.',
        userText: options.instruction,
    })
    const s = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
    const first = s.indexOf("{")
    const last = s.lastIndexOf("}")
    const json = first >= 0 && last >= 0 ? s.slice(first, last + 1) : s
    const parsed = JSON.parse(json) as { name?: string }
    return (parsed.name ?? "").trim().slice(0, 48)
}

export async function synthesizeDocumentTitle(
    options: Omit<CallAIOptions, "systemPrompt" | "userText"> & {
        text: string
    },
): Promise<string> {
    const raw = await callAI({
        ...options,
        systemPrompt:
            'Give this document a short title. Return ONLY JSON like {"title":"Short Title"}. Use 2 to 6 words, title case, no punctuation.',
        userText: options.text.slice(0, 600),
    })
    const s = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
    const first = s.indexOf("{")
    const last = s.lastIndexOf("}")
    const json = first >= 0 && last >= 0 ? s.slice(first, last + 1) : s
    const parsed = JSON.parse(json) as { title?: string }
    return (parsed.title ?? "").trim().slice(0, 80)
}

export interface ParseEditsResult {
    edits: EditOp[]
    rawError?: string
}

export function parseEditsResponse(raw: string): ParseEditsResult {
    if (!raw) return { edits: [], rawError: "Empty response" }
    let s = raw.trim()
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "")
    const first = s.indexOf("{")
    const last = s.lastIndexOf("}")
    if (first !== -1 && last !== -1) s = s.slice(first, last + 1)
    try {
        const parsed = JSON.parse(s) as { edits?: EditOp[] }
        if (Array.isArray(parsed?.edits)) return { edits: parsed.edits }
        return { edits: [], rawError: "No edits[] in response" }
    } catch (e) {
        return {
            edits: [],
            rawError: "JSON parse failed: " + (e as Error).message,
        }
    }
}
