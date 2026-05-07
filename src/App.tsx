import React, {
  useState, useEffect, useRef, useMemo, useCallback,
} from 'react'
import { EditOps } from './diff-engine'
import { callAI, parseEditsResponse, ACTION_INSTRUCTIONS, SYSTEM_TEMPLATE } from './ai-client'
import type {
  Segment, ActionId, ProviderId, Action, Settings, HistoryEntry, Stats, Snapshot,
} from './types'
import { Toolbar } from '@/components/Toolbar'
import { DocView } from '@/components/DocView'
import { Sidebar } from '@/components/Sidebar'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SettingsModal } from '@/components/modals/SettingsModal'
import { CustomPromptModal } from '@/components/modals/CustomPromptModal'
import { HistoryModal } from '@/components/modals/HistoryModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'

// ─── Constants ───────────────────────────────────────────

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

const SAMPLE_TEXT = `The proposal, in its present form, has a number of issues that we will need to address before circulating it more widely. Firstly, the executive summary is overly verbose and could probably be cut down significantly without losing any of it's substance. Secondly, there are several places where the tone shifts abruptly from formal to casual, which is jarring to the reader.

We should also reconsider the section on market positioning — it leans heavily on jargon and assumes the reader is already familiar with our internal terminology, which most of the board members are not. Lastly, the conclusion ends rather abruptly, without a clear call to action or summary of next steps.

I'd suggest we set aside an hour tomorrow morning to go through it together and address these points one by one.`

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
      if      (k === 'z' && !e.shiftKey)               { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
      else if  (k === 'k' && e.shiftKey)               { e.preventDefault(); acceptAll() }
      else if  (k === 'k')                              { e.preventDefault(); acceptFocused() }
      else if  (k === 'l' && e.shiftKey)               { e.preventDefault(); rejectAll() }
      else if  (k === 'l')                              { e.preventDefault(); rejectFocused() }
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
