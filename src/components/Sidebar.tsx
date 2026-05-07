import type { ActionId, Stats } from '@/types'

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
}

export function Sidebar({ onAction, busyAction, loading, hasText, hasKey, stats }: SidebarProps) {
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
