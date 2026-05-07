import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import type { Settings, ProviderId } from "@/types"

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
}

export function SettingsModal({
    open,
    onClose,
    settings,
    setSettings,
}: SettingsModalProps) {
    const [showKey, setShowKey] = useState(false)
    const update = <K extends keyof Settings>(k: K, v: Settings[K]) =>
        setSettings({ ...settings, [k]: v })

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogDescription>
                        Editorial — Connection
                    </DialogDescription>
                    <DialogTitle>The Connection</DialogTitle>
                </DialogHeader>

                <div className="input-row">
                    <div className="field">
                        <label className="field-label">Provider</label>
                        <Select
                            value={settings.provider}
                            items={Object.fromEntries(
                                PROVIDERS.map((p) => [p.id, p.label]),
                            )}
                            onValueChange={(val) => {
                                if (!val) return
                                const p = val as ProviderId
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
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PROVIDERS.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="field">
                        <label className="field-label">Model</label>
                        <Input
                            value={settings.model}
                            onChange={(e) => update("model", e.target.value)}
                            placeholder="e.g. claude-opus-4-5"
                            spellCheck={false}
                        />
                    </div>
                </div>
                <div className="field">
                    <label className="field-label">API key</label>
                    <div className="key-row">
                        <Input
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
                    <label className="field-label">
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
                    <Input
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
                    ※ Settings are stored in your browser only. Requests go
                    directly from your browser to the provider.
                </div>

                <DialogFooter>
                    <Button variant="default" onClick={onClose}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
