import { useState } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import type { ActionId, Stats } from '@/types'
import type { RichDocument } from '@/types'
import { DocumentLibrary } from './DocumentLibrary'

type SidebarMode = 'documents' | 'marks'

const ACTIONS = [
  { id: 'grammar',    name: 'Grammar',      glyph: '⁋', hint: 'Fix mistakes' },
  { id: 'light',      name: 'Light',        glyph: '·', hint: 'Touch-ups only' },
  { id: 'proofread',  name: 'Proofread',    glyph: '✓', hint: 'Full proofread' },
  { id: 'natural',    name: 'Natural',      glyph: '∼', hint: 'More human' },
  { id: 'streamline', name: 'Streamline',   glyph: '⇉', hint: 'Smooth flow' },
  { id: 'improve',    name: 'Improve',      glyph: '✦', hint: 'Strengthen prose' },
  { id: 'rewrite',    name: 'Rewrite',      glyph: '↻', hint: 'Heavier rework' },
  { id: 'formal',     name: 'Formal',       glyph: '§', hint: 'Elevate tone' },
  { id: 'concise',    name: 'Concise',      glyph: '↤', hint: 'Cut filler' },
  { id: 'custom',     name: 'Custom Prompt', glyph: '+', hint: 'Your instruction' },
] as const

export interface SidebarProps {
  onAction: (id: ActionId) => void
  busyAction: ActionId | null
  loading: boolean
  hasText: boolean
  hasKey: boolean
  stats: Stats
  documents: RichDocument[]
  activeDocumentId: string | null
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onNewDocument: () => void
  onSelectDocument: (id: string) => void
}

export function Sidebar({
  onAction,
  busyAction,
  loading,
  hasText,
  hasKey,
  stats,
  documents,
  activeDocumentId,
  sidebarCollapsed,
  onToggleSidebar,
  onNewDocument,
  onSelectDocument,
}: SidebarProps) {
  const [mode, setMode] = useState<SidebarMode>('documents')

  if (sidebarCollapsed) {
    return (
      <aside className="sidebar collapsed">
        <button type="button" className="sidebar-rail-toggle" onClick={onToggleSidebar} title="Show sidebar">
          <PanelLeftOpen size={18} />
        </button>
        <span className="sidebar-rail-label">Editorial</span>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div>
          <div className="font-display wordmark">Editorial</div>
          <div className="meta">an editor in residence</div>
        </div>
        <button type="button" className="icon-btn sidebar-collapse-btn" onClick={onToggleSidebar} title="Hide sidebar">
          <PanelLeftOpen size={17} />
        </button>
      </div>
      <div className="sidebar-mode-tabs">
        <button type="button" className={mode === 'documents' ? 'active' : ''} onClick={() => setMode('documents')}>Documents</button>
        <button type="button" className={mode === 'marks' ? 'active' : ''} onClick={() => setMode('marks')}>Editor's Marks</button>
      </div>
      {mode === 'documents' ? (
        <DocumentLibrary
          documents={documents}
          activeId={activeDocumentId}
          collapsed={false}
          onToggle={onToggleSidebar}
          toggleTitle="Hide sidebar"
          onNew={onNewDocument}
          onSelect={onSelectDocument}
        />
      ) : null}
      <div className="sidebar-scroll">
        {mode === 'marks' && <div className="section">
          <div className="section-head">
            <span className="title">Editor's Marks</span>
          </div>
          <div className="actions">
            {ACTIONS.map(a => {
              const isActive = busyAction === a.id
              return (
                <button
                  key={a.id}
                  className={'action ' + (isActive ? 'active' : '')}
                  disabled={loading || (!hasText && a.id !== 'custom') || !hasKey}
                  onClick={() => onAction(a.id as ActionId)}
                  title={a.hint}
                  aria-busy={isActive || undefined}
                >
                  <span className="glyph">{a.glyph}</span>
                  <span className="label">
                    <span className="name">{a.name}</span>
                    <span className="hint">{a.hint}</span>
                  </span>
                  {isActive && <span className="spinner" />}
                </button>
              )
            })}
          </div>
          {!hasKey && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-ink-faint)', fontStyle: 'italic', lineHeight: 1.5 }}>
              ※ Open Settings to add your API key. Keys live only in this browser.
            </div>
          )}
        </div>}
      </div>
      <div className="statbar">
        <div className="stat"><span className="num">{stats.words}</span><span className="lbl">words</span></div>
        <div className="sep" />
        <div className="stat"><span className="num">{stats.chars}</span><span className="lbl">chars</span></div>
      </div>
    </aside>
  )
}
