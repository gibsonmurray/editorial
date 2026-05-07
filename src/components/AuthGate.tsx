import { useState, useRef, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'editorial:auth'

async function sha256(text: string): Promise<string> {
    const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text)
    )
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

// Hash the env password once at startup so comparison is always consistent
const expectedHashPromise: Promise<string | null> = (() => {
    const pw = (import.meta.env.VITE_AUTH_PASSWORD ?? '').trim()
    if (!pw) return Promise.resolve(null)
    return sha256(pw)
})()

export default function AuthGate({ children }: { children: ReactNode }) {
    const [authed, setAuthed] = useState<boolean | null>(null)
    const [password, setPassword] = useState('')
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        expectedHashPromise.then((expected) => {
            if (!expected) { setAuthed(true); return }
            setAuthed(localStorage.getItem(STORAGE_KEY) === expected)
        })
    }, [])

    useEffect(() => {
        if (authed === false) inputRef.current?.focus()
    }, [authed])

    if (authed === null) return null
    if (authed) return <>{children}</>

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!password || loading) return
        setLoading(true)
        setError(false)
        const [inputHash, expected] = await Promise.all([sha256(password), expectedHashPromise])
        if (expected && inputHash === expected) {
            localStorage.setItem(STORAGE_KEY, inputHash)
            setAuthed(true)
        } else {
            setError(true)
            setPassword('')
            setLoading(false)
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                background: 'var(--color-paper)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2rem',
                    width: '100%',
                    maxWidth: '20rem',
                    padding: '0 1.5rem',
                }}
            >
                <div style={{ textAlign: 'center' }}>
                    <div
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '2.5rem',
                            fontWeight: 500,
                            letterSpacing: '-0.01em',
                            color: 'var(--color-ink)',
                            lineHeight: 1,
                            marginBottom: '0.35rem',
                        }}
                    >
                        Editorial
                    </div>
                    <div
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--color-ink-mute)',
                            letterSpacing: '0.05em',
                        }}
                    >
                        private access
                    </div>
                </div>

                <form
                    onSubmit={handleSubmit}
                    style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                >
                    <div style={{ position: 'relative' }}>
                        <input
                            ref={inputRef}
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value)
                                setError(false)
                            }}
                            placeholder="password"
                            autoComplete="current-password"
                            style={{
                                width: '100%',
                                padding: '0.6rem 2.5rem 0.6rem 0.75rem',
                                background: 'var(--color-paper-deep)',
                                border: `1px solid ${error ? 'var(--color-crimson)' : 'var(--color-rule)'}`,
                                color: 'var(--color-ink)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '13px',
                                outline: 'none',
                                boxSizing: 'border-box',
                                transition: 'border-color 0.15s',
                            }}
                            onFocus={(e) =>
                                (e.target.style.borderColor = error
                                    ? 'var(--color-crimson)'
                                    : 'var(--color-ink-faint)')
                            }
                            onBlur={(e) =>
                                (e.target.style.borderColor = error
                                    ? 'var(--color-crimson)'
                                    : 'var(--color-rule)')
                            }
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            tabIndex={-1}
                            style={{
                                position: 'absolute',
                                right: '0.6rem',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                color: 'var(--color-ink-mute)',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            {showPassword ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                                    <line x1="1" y1="1" x2="23" y2="23"/>
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            )}
                        </button>
                    </div>

                    {error && (
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                color: 'var(--color-crimson)',
                                textAlign: 'center',
                            }}
                        >
                            incorrect password
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!password || loading}
                        style={{
                            width: '100%',
                            padding: '0.6rem',
                            background: 'var(--color-ink-button)',
                            color: 'var(--color-paper)',
                            border: 'none',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            letterSpacing: '0.05em',
                            cursor: password && !loading ? 'pointer' : 'not-allowed',
                            opacity: password && !loading ? 1 : 0.45,
                            transition: 'opacity 0.15s',
                        }}
                    >
                        {loading ? 'checking...' : 'enter'}
                    </button>
                </form>
            </div>
        </div>
    )
}
