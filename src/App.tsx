import React, {
  useState, useEffect, useRef, useMemo, useCallback,
} from 'react'
import { EditOps } from './diff-engine'
import { callAI, parseEditsResponse, ACTION_INSTRUCTIONS, SYSTEM_TEMPLATE } from './ai-client'
import type {
  Segment, ActionId, ProviderId, Provider, Action, Settings, HistoryEntry, Stats, Snapshot,
} from './types'

// ─── Constants ───────────────────────────────────────────

const PROVIDERS: Provider[] = [
  { id: 'anthropic',   label: 'Anthropic',      defaultModel: 'claude-opus-4-5' },
  { id: 'openai',      label: 'OpenAI',          defaultModel: 'gpt-4o' },
  { id: 'google',      label: 'Google Gemini',   defaultModel: 'gemini-2.0-flash' },
  { id: 'mistral',     label: 'Mistral',         defaultModel: 'mistral-large-latest' },
  { id: 'groq',        label: 'Groq',            defaultModel: 'llama-3.3-70b-versatile' },
  { id: 'openrouter',  label: 'OpenRouter',      defaultModel: 'anthropic/claude-opus-4-5' },
]

const SAMPLE_TEXT = `The proposal, in its present form, has a number of issues that we will need to address before circulating it more widely. Firstly, the executive summary is overly verbose and could probably be cut down significantly without losing any of it's substance. Secondly, there are several places where the tone shifts abruptly from formal to casual, which is jarring to the reader.

We should also reconsider the section on market positioning — it leans heavily on jargon and assumes the reader is already familiar with our internal terminology, which most of the board members are not. Lastly, the conclusion ends rather abruptly, without a clear call to action or summary of next steps.

I'd suggest we set aside an hour tomorrow morning to go through it together and address these points one by one.`

const ACTIONS: Action[] = [
  { id: 'grammar',    name: 'Grammar',      glyph: '⁋', hint: 'Fix mistakes',     primary: true },
  { id: 'light',      name: 'Light',        glyph: '·', hint: 'Touch-ups only' },
  { id: 'proofread',  name: 'Proofread',    glyph: '✓', hint: 'Full proofread' },
  { id: 'natural',    name: 'Natural',      glyph: '∼', hint: 'More human' },
  { id: 'streamline', name: 'Streamline',   glyph: '⇉', hint: 'Smooth flow' },
  { id: 'improve',    name: 'Improve',      glyph: '✦', hint: 'Strengthen prose' },
  { id: 'rewrite',    name: 'Rewrite',      glyph: '↻', hint: 'Heavier rework' },
  { id: 'formal',     name: 'Formal',       glyph: '§', hint: 'Elevate tone' },
  { id: 'concise',    name: 'Concise',      glyph: '↤', hint: 'Cut filler' },
  { id: 'custom',     name: 'Custom Prompt', glyph: '+', hint: 'Your instruction' },
]

// ─── Persisted state hook ─────────────────────────────────

function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('editorial:' + key)
      if (raw === null) return initial
      return JSON.parse(raw) as T
    } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem('editorial:' + key, JSON.stringify(v)) } catch {}
  }, [key, v])
  return [v, setV]
}

// ─── Icons ───────────────────────────────────────────────

type SvgProps = React.SVGProps<SVGSVGElement>

const I = {
  Undo:      (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9"/></svg>,
  Redo:      (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0-5 5v0a5 5 0 0 0 5 5h6"/></svg>,
  AcceptDoc: (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14l2 2 4-4"/></svg>,
  RejectDoc: (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12l4 4M14 12l-4 4"/></svg>,
  AcceptAll: (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="13" height="13" rx="1.5"/><path d="M16 8h5v13H8v-5"/><path d="M6 9.5l2.5 2.5L13 7.5"/></svg>,
  RejectAll: (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="13" height="13" rx="1.5"/><path d="M16 8h5v13H8v-5"/><path d="M7 7l5 5M12 7l-5 5"/></svg>,
  Import:    (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 4h5v16h-5"/><path d="M14 12H3"/><path d="M7 8l-4 4 4 4"/></svg>,
  Export:    (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M10 4H5v16h5"/><path d="M10 12h11"/><path d="M17 8l4 4-4 4"/></svg>,
  Copy:      (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>,
  Clear:     (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 13l-7-7-9 9 4 4h7l5-5z"/><path d="M9 6l7 7"/></svg>,
  History:   (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v5l3 2"/></svg>,
  Settings:  (p: SvgProps) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  Eye:       (p: SvgProps) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  EyeOff:    (p: SvgProps) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-3.7 4.6M6 6.6A17 17 0 0 0 2 11s3.5 7 10 7c1.5 0 2.9-.3 4.1-.8"/></svg>,
  Check:     (p: SvgProps) => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 12l5 5L20 6"/></svg>,
  X:         (p: SvgProps) => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M5 5l14 14M19 5L5 19"/></svg>,
}

// ─── Toolbar ─────────────────────────────────────────────

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  kbd?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  badge?: number
}

function ToolbarButton({ icon, label, kbd, onClick, disabled, className = '', badge }: ToolbarButtonProps) {
  return (
    <button className={'tb-btn ' + className} onClick={onClick} disabled={disabled}>
      <span className="ic">{icon}</span>
      <span className="lbl">
        <span>{label}</span>
        {kbd && <span className="kbd">{kbd}</span>}
      </span>
      {badge != null && badge > 0 && <span className="badge-dot">{badge}</span>}
    </button>
  )
}

interface ToolbarProps {
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onAcceptFocused: () => void
  onRejectFocused: () => void
  hasFocused: boolean
  onAcceptAll: () => void
  onRejectAll: () => void
  pendingCount: number
  onImport: () => void
  onExport: () => void
  onCopy: () => void
  onClear: () => void
  onHistory: () => void
  onSettings: () => void
  busy: boolean
  hasText: boolean
}

function Toolbar({
  onUndo, onRedo, canUndo, canRedo,
  onAcceptFocused, onRejectFocused, hasFocused,
  onAcceptAll, onRejectAll, pendingCount,
  onImport, onExport, onCopy, onClear,
  onHistory, onSettings,
  busy, hasText,
}: ToolbarProps) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const cmd   = isMac ? '⌘' : 'Ctrl'
  const shift = '⇧'

  return (
    <div className="toolbar">
      <div className="tb-group">
        <ToolbarButton icon={<I.Undo />} label="Undo" kbd={`${cmd}Z`} onClick={onUndo} disabled={!canUndo} />
        <ToolbarButton icon={<I.Redo />} label="Redo" kbd={`${cmd}${shift}Z`} onClick={onRedo} disabled={!canRedo} />
      </div>
      <div className="tb-group">
        <ToolbarButton icon={<I.AcceptDoc />} label="Accept" kbd={`${cmd}K`} className="accept" onClick={onAcceptFocused} disabled={!hasFocused} />
        <ToolbarButton icon={<I.AcceptAll />} label="Accept All" kbd={`${cmd}${shift}K`} className="accept-all" onClick={onAcceptAll} disabled={!pendingCount} badge={pendingCount} />
        <ToolbarButton icon={<I.RejectDoc />} label="Reject" kbd={`${cmd}L`} className="reject" onClick={onRejectFocused} disabled={!hasFocused} />
        <ToolbarButton icon={<I.RejectAll />} label="Reject All" kbd={`${cmd}${shift}L`} className="reject-all" onClick={onRejectAll} disabled={!pendingCount} />
      </div>
      <div className="tb-group">
        <ToolbarButton icon={<I.Import />} label="Import" onClick={onImport} />
        <ToolbarButton icon={<I.Export />} label="Export" onClick={onExport} disabled={!hasText} />
        <ToolbarButton icon={<I.Copy />} label="Copy" onClick={onCopy} disabled={!hasText} />
        <ToolbarButton icon={<I.Clear />} label="Clear" onClick={onClear} disabled={!hasText} />
      </div>
      <div className="tb-group">
        <ToolbarButton icon={<I.History />} label="History" onClick={onHistory} />
        <ToolbarButton icon={<I.Settings />} label="Settings" onClick={onSettings} />
      </div>
      <div className="spacer" />
      <div className={'tb-status' + (busy ? ' busy' : '') + (pendingCount > 0 ? ' has-edits' : '')}>
        <span className="dot" />
        <span className="text">
          {busy ? 'Consulting editor…' : pendingCount > 0 ? `${pendingCount} pending` : hasText ? 'Ready' : 'Empty'}
        </span>
      </div>
    </div>
  )
}

// ─── DocView ─────────────────────────────────────────────

interface DocViewProps {
  segments: Segment[]
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  onAccept: (id: string) => void
  onReject: (id: string) => void
  flashIds: Set<string>
}

function DocView({ segments, focusedId, setFocusedId, onAccept, onReject, flashIds }: DocViewProps) {
  if (!segments.length) return null

  return (
    <div className="doc">
      {segments.map(s => {
        if (s.kind === 'keep') return <span key={s.id} className="seg">{s.text}</span>
        if (s.status === 'accepted') return <span key={s.id} className="seg">{s.after}</span>
        if (s.status === 'rejected') return <span key={s.id} className="seg">{s.before}</span>
        const isFlash  = flashIds.has(s.id)
        const isFocused = focusedId === s.id
        return (
          <span
            key={s.id}
            className={'seg edit-pair' + (isFocused ? ' focused' : '')}
            onClick={e => { e.stopPropagation(); setFocusedId(s.id) }}>
            {s.before && <del className={'chunk' + (isFlash ? ' flash' : '')}>{s.before}</del>}
            {s.after  && <ins className={'chunk' + (isFlash ? ' flash' : '')}>{s.after}</ins>}
            <span className="chip-row" contentEditable={false}>
              <button className="accept" title="Accept" onClick={e => { e.stopPropagation(); onAccept(s.id) }} aria-label="Accept"><I.Check /></button>
              <button className="reject" title="Reject" onClick={e => { e.stopPropagation(); onReject(s.id) }} aria-label="Reject"><I.X /></button>
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────

interface SidebarProps {
  onAction: (id: ActionId) => void
  busyAction: ActionId | null
  loading: boolean
  hasText: boolean
  hasKey: boolean
  stats: Stats
}

function Sidebar({ onAction, busyAction, loading, hasText, hasKey, stats }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="font-display wordmark">Editorial</div>
        <div className="meta">an editor in residence</div>
      </div>
      <div className="sidebar-scroll">
        <div className="section">
          <div className="section-head">
            <span className="num">i.</span>
            <span className="title">Editor's Marks</span>
            <span className="rule" />
          </div>
          <div className="actions">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                className={'action ' + (a.primary ? 'primary' : '')}
                disabled={loading || (!hasText && a.id !== 'custom') || !hasKey}
                onClick={() => onAction(a.id)}
                title={a.hint}>
                <span className="glyph">{a.glyph}</span>
                <span className="label">
                  <span className="name">{a.name}</span>
                  <span className="hint">{a.hint}</span>
                </span>
                {busyAction === a.id && <span className="spinner" />}
              </button>
            ))}
          </div>
          {!hasKey && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic', lineHeight: 1.5 }}>
              ※ Open Settings to add your API key. Keys live only in this browser.
            </div>
          )}
        </div>
      </div>
      <div className="statbar">
        <div className="stat"><span className="num">{stats.words}</span><span className="lbl">words</span></div>
        <div className="sep" />
        <div className="stat"><span className="num">{stats.chars}</span><span className="lbl">chars</span></div>
      </div>
    </aside>
  )
}

// ─── Modals ──────────────────────────────────────────────

interface ModalShellProps {
  kicker: string
  title: string
  children: React.ReactNode
  onClose: () => void
  foot: React.ReactNode
}

function ModalShell({ kicker, title, children, onClose, foot }: ModalShellProps) {
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div className="kicker">{kicker}</div>
          <div className="title font-display">{title}</div>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{foot}</div>
      </div>
    </div>
  )
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  setSettings: (s: Settings) => void
}

function SettingsModal({ open, onClose, settings, setSettings }: SettingsModalProps) {
  const [showKey, setShowKey] = useState(false)
  if (!open) return null
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v })
  return (
    <ModalShell kicker="Editorial — Connection" title="The Connection" onClose={onClose} foot={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="input-row">
        <div className="field">
          <label className="field-label">Provider</label>
          <select className="select" value={settings.provider} onChange={e => {
            const p = e.target.value as ProviderId
            const found = PROVIDERS.find(x => x.id === p)
            setSettings({ ...settings, provider: p, model: found ? found.defaultModel : settings.model })
          }}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Model</label>
          <input className="input" value={settings.model} onChange={e => update('model', e.target.value)} placeholder="e.g. claude-opus-4-5" spellCheck={false} />
        </div>
      </div>
      <div className="field">
        <label className="field-label">API key</label>
        <div className="key-row">
          <input className="input" type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={e => update('apiKey', e.target.value)} placeholder="sk-..." style={{ paddingRight: 32 }} spellCheck={false} autoComplete="off" />
          <button type="button" className="reveal" onClick={() => setShowKey(s => !s)} title={showKey ? 'Hide' : 'Reveal'}>
            {showKey ? <I.EyeOff /> : <I.Eye />}
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field-label">Base URL <span style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-faint)' }}>— optional</span></label>
        <input className="input" value={settings.baseURL} onChange={e => update('baseURL', e.target.value)} placeholder="https://… (override)" spellCheck={false} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic', lineHeight: 1.5 }}>
        ※ Settings are stored in your browser only. Requests go directly from your browser to the provider.
      </div>
    </ModalShell>
  )
}

interface CustomPromptModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (instruction: string) => void
}

function CustomPromptModal({ open, onClose, onSubmit }: CustomPromptModalProps) {
  const [v, setV] = useState('')
  if (!open) return null
  return (
    <ModalShell kicker="Editorial — Custom Instruction" title="A note to the editor" onClose={onClose} foot={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!v.trim()} onClick={() => { onSubmit(v.trim()); setV('') }}>Submit instruction</button>
    </>}>
      <textarea autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="e.g. Rewrite this in the voice of a Victorian novelist, keeping the meaning intact." />
    </ModalShell>
  )
}

interface HistoryModalProps {
  open: boolean
  onClose: () => void
  history: HistoryEntry[]
  onRevert: (id: string) => void
  onClearHistory: () => void
}

function HistoryModal({ open, onClose, history, onRevert, onClearHistory }: HistoryModalProps) {
  if (!open) return null
  return (
    <ModalShell kicker="Editorial — Revisions" title="The history" onClose={onClose} foot={<>
      <button className="btn danger" onClick={onClearHistory} disabled={!history.length}>Clear history</button>
      <button className="btn" onClick={onClose}>Close</button>
    </>}>
      {history.length === 0
        ? <div className="history-empty">No revisions yet. Run an editor's mark to begin.</div>
        : <div className="history-list">
            {history.slice().reverse().map(h => (
              <div key={h.id} className="history-row" onClick={() => { onRevert(h.id); onClose() }}>
                <span className="glyph">{h.glyph}</span>
                <div className="info">
                  <div className="name">{h.name}</div>
                  <div className="when">{h.when}</div>
                </div>
                <div className="preview">{h.preview}</div>
              </div>
            ))}
          </div>
      }
    </ModalShell>
  )
}

interface ConfirmModalProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

function ConfirmModal({ open, title, body, confirmLabel, danger, onConfirm, onClose }: ConfirmModalProps) {
  if (!open) return null
  return (
    <ModalShell kicker="Editorial" title={title} onClose={onClose} foot={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
    </>}>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{body}</div>
    </ModalShell>
  )
}

interface ErrorAlertProps {
  error: string | null
  onDismiss: () => void
}

function ErrorAlert({ error, onDismiss }: ErrorAlertProps) {
  if (!error) return null
  return (
    <div className="alert">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 10, marginBottom: 4 }}>✗ Editorial returns</div>
        <div style={{ color: 'var(--ink)', fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</div>
      </div>
      <button className="x" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────

export default function App() {
  const [provider, setProvider] = usePersistedState<ProviderId>('provider', 'anthropic')
  const [model,    setModel]    = usePersistedState<string>('model', 'claude-opus-4-5')
  const [apiKey,   setApiKey]   = usePersistedState<string>('apiKey', '')
  const [baseURL,  setBaseURL]  = usePersistedState<string>('baseURL', '')

  const [text,     setText]     = useState(SAMPLE_TEXT)
  const [segments, setSegments] = useState<Segment[]>([])
  const [past,     setPast]     = useState<Snapshot[]>([])
  const [future,   setFuture]   = useState<Snapshot[]>([])

  const [focusedId,    setFocusedId]    = useState<string | null>(null)
  const [busyAction,   setBusyAction]   = useState<ActionId | null>(null)
  const [error,        setError]        = useState<string | null>(null)
  const [customOpen,   setCustomOpen]   = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen,  setHistoryOpen]  = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [flashIds,     setFlashIds]     = useState<Set<string>>(new Set())
  const [history,      setHistory]      = useState<HistoryEntry[]>([])
  const [copied,       setCopied]       = useState(false)

  const editorAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef  = useRef<HTMLInputElement>(null)

  const snapshot    = useCallback((): Snapshot => ({ text, segments }), [text, segments])
  const pushUndoHistory = useCallback(() => {
    setPast(p => [...p.slice(-49), snapshot()])
    setFuture([])
  }, [snapshot])

  const settings: Settings = { provider, model, apiKey, baseURL }
  const setSettings = (next: Settings) => {
    setProvider(next.provider)
    setModel(next.model)
    setApiKey(next.apiKey)
    setBaseURL(next.baseURL)
  }

  const currentRendered = useMemo(() =>
    segments.length ? EditOps.finalText(segments) : text,
    [segments, text])

  const stats: Stats = useMemo(() => {
    const t = currentRendered
    return { words: (t.trim().match(/\S+/g) ?? []).length, chars: t.length }
  }, [currentRendered])

  const pendingEdits = segments.filter(s => s.kind === 'edit' && s.status === 'pending')
  const pendingCount = pendingEdits.length
  const hasText = !!(text || '').trim() || segments.some(s => s.kind === 'keep' && s.text.trim())

  useEffect(() => {
    if (focusedId && pendingEdits.find(p => p.id === focusedId)) return
    setFocusedId(pendingEdits[0]?.id ?? null)
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI run ──────────────────────────────────────────────
  const runAction = useCallback(async (actionId: ActionId, customInstruction?: string) => {
    setError(null)
    if (!text.trim() && segments.length === 0) { setError('Editor is empty — paste or type some text first.'); return }
    if (!apiKey) { setError('No API key set. Open Settings to add one.'); setSettingsOpen(true); return }

    const sourceText  = currentRendered || text
    const instruction = actionId === 'custom'
      ? (customInstruction ?? '')
      : ACTION_INSTRUCTIONS[actionId as keyof typeof ACTION_INSTRUCTIONS]
    if (!instruction) return
    const systemPrompt = SYSTEM_TEMPLATE(instruction)

    setBusyAction(actionId)
    pushUndoHistory()
    try {
      const raw = await callAI({ provider, model, apiKey, baseURL, systemPrompt, userText: sourceText })
      const { edits, rawError } = parseEditsResponse(raw)
      if (rawError && (!edits || edits.length === 0)) {
        setError('Could not parse editor response.\n\n' + rawError + '\n\nRaw output (first 600 chars):\n' + raw.slice(0, 600))
        return
      }
      const segs = EditOps.computeSegments(sourceText, edits)
      setText(sourceText)
      setSegments(segs)

      const ids = new Set(segs.filter(s => s.kind === 'edit').map(s => s.id))
      setFlashIds(ids)
      setTimeout(() => setFlashIds(new Set()), 1300)

      const action    = ACTIONS.find(a => a.id === actionId)
      const editCount = segs.filter(s => s.kind === 'edit').length
      setHistory(h => [...h, {
        id: 'h' + Date.now(), actionId,
        name: (action?.name ?? 'Custom') + ` — ${editCount} edit${editCount === 1 ? '' : 's'}`,
        glyph: action?.glyph ?? '✎',
        when: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        preview: sourceText.slice(0, 60).replace(/\s+/g, ' ') + (sourceText.length > 60 ? '…' : ''),
        snapshot: { text: sourceText, segments: segs },
      }])
    } catch (e) {
      setError((e as Error).message || String(e))
    } finally {
      setBusyAction(null)
    }
  }, [provider, model, apiKey, baseURL, text, segments, currentRendered, pushUndoHistory])

  const handleAction = (id: ActionId) => { if (id === 'custom') { setCustomOpen(true) } else { void runAction(id) } }

  // ── Edit operations ──────────────────────────────────────
  const advanceFocus = (currentId: string) => {
    const idx  = pendingEdits.findIndex(p => p.id === currentId)
    const next = pendingEdits[idx + 1] ?? pendingEdits.find(p => p.id !== currentId)
    setFocusedId(next?.id ?? null)
  }
  const acceptOne = (id: string) => { pushUndoHistory(); setSegments(s => s.map(seg => seg.id === id ? { ...seg, status: 'accepted' as const } : seg)); advanceFocus(id) }
  const rejectOne = (id: string) => { pushUndoHistory(); setSegments(s => s.map(seg => seg.id === id ? { ...seg, status: 'rejected' as const } : seg)); advanceFocus(id) }
  const acceptAll = () => { if (!pendingCount) return; pushUndoHistory(); setSegments(s => s.map(seg => seg.kind === 'edit' && seg.status === 'pending' ? { ...seg, status: 'accepted' as const } : seg)) }
  const rejectAll = () => { if (!pendingCount) return; pushUndoHistory(); setSegments(s => s.map(seg => seg.kind === 'edit' && seg.status === 'pending' ? { ...seg, status: 'rejected' as const } : seg)) }
  const acceptFocused = () => { if (focusedId) acceptOne(focusedId) }
  const rejectFocused = () => { if (focusedId) rejectOne(focusedId) }

  // ── Undo / redo ──────────────────────────────────────────
  const undo = () => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setFuture(f => [snapshot(), ...f.slice(0, 49)])
    setPast(p => p.slice(0, -1))
    setText(prev.text); setSegments(prev.segments)
  }
  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setPast(p => [...p.slice(-49), snapshot()])
    setFuture(f => f.slice(1))
    setText(next.text); setSegments(next.segments)
  }

  // ── File I/O ─────────────────────────────────────────────
  const onImport = () => fileInputRef.current?.click()
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const t = await file.text()
    pushUndoHistory(); setText(t); setSegments([])
    e.target.value = ''
  }
  const onExport = () => {
    const blob = new Blob([currentRendered], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'editorial-' + new Date().toISOString().slice(0, 10) + '.txt'; a.click()
    URL.revokeObjectURL(url)
  }
  const onCopy = () => {
    void navigator.clipboard.writeText(currentRendered)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const onClearConfirmed = () => { pushUndoHistory(); setText(''); setSegments([]) }

  // ── Typing ───────────────────────────────────────────────
  const lastTypedSnapshot = useRef(text)
  const onTypingChange    = (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)
  const onTypingBlur      = () => {
    if (lastTypedSnapshot.current !== text) {
      setPast(p => [...p.slice(-49), { text: lastTypedSnapshot.current, segments: [] }])
      setFuture([])
      lastTypedSnapshot.current = text
    }
  }

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if      (k === 'z' && !e.shiftKey)              { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
      else if  (k === 'k' && e.shiftKey)              { e.preventDefault(); acceptAll() }
      else if  (k === 'k')                             { e.preventDefault(); acceptFocused() }
      else if  (k === 'l' && e.shiftKey)              { e.preventDefault(); rejectAll() }
      else if  (k === 'l')                             { e.preventDefault(); rejectFocused() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusedId, pendingCount, past.length, future.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onRevertHistory = (id: string) => {
    const entry = history.find(h => h.id === id)
    if (!entry) return
    pushUndoHistory(); setText(entry.snapshot.text); setSegments(entry.snapshot.segments)
  }

  return (
    <div className="app">
      <div className="paper-grain coarse" />
      <div className="paper-grain" />

      <Sidebar onAction={handleAction} busyAction={busyAction} loading={!!busyAction} hasText={hasText} hasKey={!!apiKey} stats={stats} />

      <main className="pane">
        <Toolbar
          onUndo={undo} onRedo={redo} canUndo={past.length > 0} canRedo={future.length > 0}
          onAcceptFocused={acceptFocused} onRejectFocused={rejectFocused} hasFocused={!!focusedId && pendingCount > 0}
          onAcceptAll={acceptAll} onRejectAll={rejectAll} pendingCount={pendingCount}
          onImport={onImport} onExport={onExport} onCopy={onCopy} onClear={() => setConfirmClear(true)}
          onHistory={() => setHistoryOpen(true)} onSettings={() => setSettingsOpen(true)}
          busy={!!busyAction} hasText={hasText} />

        {error && <ErrorAlert error={error} onDismiss={() => setError(null)} />}

        <div className="canvas">
          <div className="canvas-frame">
            <span className="corner tl" /><span className="corner tr" />
            <span className="corner bl" /><span className="corner br" />
            <div className="canvas-header">
              <span>Folio I — Manuscript</span>
              <span className="right">
                <span className={'pill ' + (pendingCount > 0 ? 'review' : '')}>
                  <span className="swatch" />
                  {pendingCount > 0 ? `${pendingCount} pending edit${pendingCount === 1 ? '' : 's'}` : 'No pending edits'}
                </span>
                <span>{stats.words} words · {stats.chars} chars</span>
              </span>
            </div>
            <div className="editor-area" ref={editorAreaRef}>
              {segments.length === 0
                ? <textarea className="write-textarea" value={text} onChange={onTypingChange} onBlur={onTypingBlur} placeholder="Paste or write your draft here. Then run an editor's mark from the sidebar." spellCheck={false} />
                : <DocView segments={segments} focusedId={focusedId} setFocusedId={setFocusedId} onAccept={acceptOne} onReject={rejectOne} flashIds={flashIds} />
              }
            </div>
          </div>
          <div className="status-line">
            <span>{provider.toUpperCase()} · {model || '—'}</span>
            <span>
              {busyAction ? '⟳ consulting the editor…' : copied ? '✓ copied to clipboard' : pendingCount > 0 ? `${pendingCount} pending change${pendingCount === 1 ? '' : 's'}` : 'awaiting instruction'}
            </span>
          </div>
        </div>
      </main>

      <input type="file" accept=".txt,.md,text/plain,text/markdown" ref={fileInputRef} onChange={e => { void onImportFile(e) }} style={{ display: 'none' }} />

      <SettingsModal    open={settingsOpen}  onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
      <CustomPromptModal open={customOpen}   onClose={() => setCustomOpen(false)}   onSubmit={instr => { setCustomOpen(false); void runAction('custom', instr) }} />
      <HistoryModal     open={historyOpen}   onClose={() => setHistoryOpen(false)}  history={history} onRevert={onRevertHistory} onClearHistory={() => setHistory([])} />
      <ConfirmModal     open={confirmClear}  onClose={() => setConfirmClear(false)} title="Clear the manuscript?" body="This empties the editor and discards any pending edits. You can undo afterwards." confirmLabel="Clear" danger onConfirm={onClearConfirmed} />
    </div>
  )
}
