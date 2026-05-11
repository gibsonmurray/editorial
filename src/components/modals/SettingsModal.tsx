import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Modal } from "./Modal"
import { synthesizeAuthorStyle } from "@/ai-client"
import type { Settings, ProviderId, RichDocument } from "@/types"

const PROVIDERS = [
    { id: "anthropic", label: "Anthropic", defaultModel: "claude-opus-4-5" },
    { id: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
    { id: "google", label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
    { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest" },
    { id: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile" },
    {
        id: "openrouter",
        label: "OpenRouter",
        defaultModel: "anthropic/claude-opus-4-5",
    },
] as const

export interface SettingsModalProps {
    open: boolean
    onClose: () => void
    settings: Settings
    setSettings: (s: Settings) => void
    activeDocument?: RichDocument | null
    persistActiveDocument?: (patch: Partial<RichDocument>) => void
}

export function SettingsModal({
    open,
    onClose,
    settings,
    setSettings,
    activeDocument,
    persistActiveDocument,
}: SettingsModalProps) {
    const [showKey, setShowKey] = useState(false)
    const [authorStyle, setAuthorStyle] = useState("")
    const [synthesizing, setSynthesizing] = useState(false)
    const update = <K extends keyof Settings>(k: K, v: Settings[K]) =>
        setSettings({ ...settings, [k]: v })

    useEffect(() => {
        setAuthorStyle(activeDocument?.authorStyle ?? "")
    }, [activeDocument?.id, open])

    return (
        <Modal
            open={open}
            onClose={onClose}
            kicker="Editorial — Connection"
            title="The Connection"
            footer={
                <button className="btn primary" type="button" onClick={onClose}>
                    Done
                </button>
            }
        >
            <div className="input-row">
                <div className="field">
                    <label className="field-label" htmlFor="provider">
                        Provider
                    </label>
                    <select
                        id="provider"
                        className="select"
                        value={settings.provider}
                        onChange={(event) => {
                            const p = event.target.value as ProviderId
                            const found = PROVIDERS.find((x) => x.id === p)
                            setSettings({
                                ...settings,
                                provider: p,
                                model: found
                                    ? found.defaultModel
                                    : settings.model,
                            })
                        }}
                    >
                        {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="field">
                    <label className="field-label" htmlFor="model">
                        Model
                    </label>
                    <input
                        id="model"
                        className="input"
                        value={settings.model}
                        onChange={(e) => update("model", e.target.value)}
                        placeholder="e.g. claude-opus-4-5"
                        spellCheck={false}
                    />
                </div>
            </div>
            <div className="field">
                <label className="field-label" htmlFor="api-key">
                    API key
                </label>
                <div className="key-row">
                    <input
                        id="api-key"
                        className="input"
                        type={showKey ? "text" : "password"}
                        value={settings.apiKey}
                        onChange={(e) => update("apiKey", e.target.value)}
                        placeholder="sk-..."
                        style={{ paddingRight: 32 }}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <button
                        type="button"
                        className="reveal"
                        onClick={() => setShowKey((s) => !s)}
                        title={showKey ? "Hide" : "Reveal"}
                    >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                </div>
            </div>
            <div className="field">
                <label className="field-label" htmlFor="base-url">
                    Base URL{" "}
                    <span
                        style={{
                            textTransform: "none",
                            letterSpacing: 0,
                            fontStyle: "italic",
                            color: "var(--color-ink-faint)",
                        }}
                    >
                        — optional
                    </span>
                </label>
                <input
                    id="base-url"
                    className="input"
                    value={settings.baseURL}
                    onChange={(e) => update("baseURL", e.target.value)}
                    placeholder="https://… (override)"
                    spellCheck={false}
                />
            </div>
            <div
                style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--color-ink-faint)",
                    fontStyle: "italic",
                    lineHeight: 1.5,
                }}
            >
                ※ Settings are stored in your browser only. Requests go directly
                from your browser to the provider.
            </div>

            <div style={{ marginTop: 16 }}>
                <label className="field-label">Author style (document)</label>
                <textarea
                    className="input"
                    value={authorStyle}
                    onChange={(e) => setAuthorStyle(e.target.value)}
                    placeholder={
                        activeDocument
                            ? "Short description of the author's voice (e.g. 'concise, informal, uses short sentences')"
                            : "Open a document to edit its author style"
                    }
                    rows={3}
                    disabled={!activeDocument}
                    style={{ width: "100%", resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                        type="button"
                        className="btn"
                        disabled={!activeDocument}
                        onClick={() => {
                            if (!activeDocument || !persistActiveDocument) return
                            persistActiveDocument({ authorStyle })
                        }}
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        className="btn"
                        disabled={!activeDocument || !settings.apiKey || synthesizing}
                        onClick={async () => {
                            if (!activeDocument) return
                            setSynthesizing(true)
                            try {
                                const text = (activeDocument.html || "").replace(/<[^>]*>/g, " ")
                                const style = await synthesizeAuthorStyle({
                                    provider: settings.provider,
                                    model: settings.model,
                                    apiKey: settings.apiKey,
                                    baseURL: settings.baseURL,
                                    text,
                                })
                                setAuthorStyle(style)
                                if (persistActiveDocument)
                                    persistActiveDocument({ authorStyle: style })
                            } catch {
                                /* ignore */
                            } finally {
                                setSynthesizing(false)
                            }
                        }}
                    >
                        {synthesizing ? "Synthesizing…" : "Resynthesize"}
                    </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-ink-faint)" }}>
                    This short description is stored with the document and used to preserve the author's voice when making edits.
                </div>
            </div>
        </Modal>
    )
}
