import { FileText, Plus, PanelLeftClose, PanelLeftOpen, Trash2 } from 'lucide-react';
import type { RichDocument } from '@/types';

interface DocumentLibraryProps {
  documents: RichDocument[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  toggleTitle?: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function relativeTime(time: number) {
  const diff = time - Date.now();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export function DocumentLibrary({ documents, activeId, collapsed, onToggle, toggleTitle, onNew, onSelect, onDelete }: DocumentLibraryProps) {
  return (
    <div className={'document-library' + (collapsed ? ' collapsed' : '')}>
      <div className="library-head">
        {!collapsed && <span>Documents</span>}
        <button type="button" className="icon-btn" onClick={onToggle} title={toggleTitle ?? (collapsed ? 'Show documents' : 'Hide documents')}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      {!collapsed && (
        <>
          <button type="button" className="new-doc-btn" onClick={onNew}>
            <Plus size={18} />
            <span>New Document</span>
          </button>
          <div className="doc-list">
            {documents.length === 0 ? (
              <div className="doc-empty">
                <strong>No documents yet</strong>
                <span>Create a document or import a file to begin.</span>
              </div>
            ) : documents.map(doc => (
              <div
                key={doc.id}
                className={'doc-row' + (doc.id === activeId ? ' active' : '')}
                onClick={() => onSelect(doc.id)}
                role="button"
                tabIndex={0}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(doc.id);
                }}
              >
                <FileText size={16} />
                <span className="doc-row-copy">
                  <span className="doc-title">{doc.title}</span>
                  <span className="doc-time">{relativeTime(doc.updatedAt)}</span>
                </span>
                <button
                  type="button"
                  className="doc-delete"
                  title={`Delete ${doc.title}`}
                  aria-label={`Delete ${doc.title}`}
                  onClick={event => {
                    event.stopPropagation();
                    onDelete(doc.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
