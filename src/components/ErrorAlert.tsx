export interface ErrorAlertProps {
    error: string | null
    onDismiss: () => void
}

export function ErrorAlert({ error, onDismiss }: ErrorAlertProps) {
    if (!error) return null
    return (
        <div className="alert">
            <div style={{ flex: 1 }}>
                <div
                    style={{
                        fontWeight: 600,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        fontSize: 10,
                        marginBottom: 4,
                    }}
                >
                    ✗ Editorial returns
                </div>
                <div
                    style={{
                        color: "var(--color-ink)",
                        fontSize: 12,
                        fontFamily: "IBM Plex Mono, monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {error}
                </div>
            </div>
            <button className="x" onClick={onDismiss} aria-label="Dismiss">
                ✕
            </button>
        </div>
    )
}
