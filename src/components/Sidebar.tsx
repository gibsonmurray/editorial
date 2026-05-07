import {
  ALargeSmall,
  CheckCheck,
  ListCollapse,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  RefreshCw,
  Scissors,
  Sparkles,
  SpellCheck,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ActionId, Stats } from '@/types'
import type { RichDocument } from '@/types'
import { DocumentLibrary } from './DocumentLibrary'

export type SidebarMode = 'documents' | 'marks'

const ACTIONS = [
  { id: 'grammar',    name: 'Grammar',       Icon: SpellCheck,    hint: 'Fix mistakes' },
  { id: 'light',      name: 'Light',         Icon: Paintbrush,    hint: 'Touch-ups only' },
  { id: 'proofread',  name: 'Proofread',     Icon: CheckCheck,    hint: 'Full proofread' },
  { id: 'natural',    name: 'Natural',       Icon: Sparkles,      hint: 'More human' },
  { id: 'streamline', name: 'Streamline',    Icon: ListCollapse,  hint: 'Smooth flow' },
  { id: 'improve',    name: 'Improve',       Icon: WandSparkles,  hint: 'Strengthen prose' },
  { id: 'rewrite',    name: 'Rewrite',       Icon: RefreshCw,     hint: 'Heavier rework' },
  { id: 'formal',     name: 'Formal',        Icon: ALargeSmall,   hint: 'Elevate tone' },
  { id: 'concise',    name: 'Concise',       Icon: Scissors,      hint: 'Cut filler' },
  { id: 'custom',     name: 'Custom Prompt', Icon: PenLine,       hint: 'Your instruction' },
] satisfies readonly { id: ActionId; name: string; Icon: LucideIcon; hint: string }[]

export interface SidebarProps {
  onAction: (id: ActionId) => void
  busyAction: ActionId | null
  loading: boolean
  hasText: boolean
  hasDocument: boolean
  hasKey: boolean
  stats: Stats
  documents: RichDocument[]
  activeDocumentId: string | null
  mode: SidebarMode
  sidebarCollapsed: boolean
  onModeChange: (mode: SidebarMode) => void
  onToggleSidebar: () => void
  onNewDocument: () => void
  onSelectDocument: (id: string) => void
  onDeleteDocument: (id: string) => void
}

export function Sidebar({
  onAction,
  busyAction,
  loading,
  hasText,
  hasDocument,
  hasKey,
  stats,
  documents,
  activeDocumentId,
  mode,
  sidebarCollapsed,
  onModeChange,
  onToggleSidebar,
  onNewDocument,
  onSelectDocument,
  onDeleteDocument,
}: SidebarProps) {
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
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="sidebar-mode-tabs">
        <button type="button" className={mode === 'documents' ? 'active' : ''} onClick={() => onModeChange('documents')}>Documents</button>
        <button type="button" className={mode === 'marks' ? 'active' : ''} onClick={() => onModeChange('marks')}>Editor's Marks</button>
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
          onDelete={onDeleteDocument}
        />
      ) : (
        <div className="sidebar-scroll">
          <div className="section">
          <div className="section-head">
            <span className="title">Editor's Marks</span>
          </div>
          <div className="actions">
            {ACTIONS.map(a => {
              const isActive = busyAction === a.id
              const Icon = a.Icon
              return (
                <button
                  key={a.id}
                  className={'action ' + (isActive ? 'active' : '')}
                  disabled={loading || !hasDocument || (!hasText && a.id !== 'custom') || !hasKey}
                  onClick={() => onAction(a.id as ActionId)}
                  title={a.hint}
                  aria-busy={isActive || undefined}
                >
                  <span className="glyph"><Icon size={17} strokeWidth={1.9} /></span>
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
      )}
      <div className="statbar">
        <div className="stat"><span className="num">{stats.words}</span><span className="lbl">words</span></div>
        <div className="sep" />
        <div className="stat"><span className="num">{stats.chars}</span><span className="lbl">chars</span></div>
      </div>
    </aside>
  )
}
