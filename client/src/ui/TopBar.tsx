import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Board } from '../api';
import type { Editor, UiState } from '../board/editor';
import type { Background, Theme } from '../board/types';
import { Icon } from './Icon';

const STATUS_LABEL: Record<UiState['status'], string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline – changes will sync',
};

const BACKGROUNDS: [Background, string][] = [
  ['blank', 'Blank'],
  ['grid', 'Squares (1 cm)'],
  ['dots', 'Dots'],
  ['lines', 'Lined'],
  ['graph', 'Graph paper (mm)'],
];

const THEMES: [Theme, string][] = [
  ['light', 'Whiteboard'],
  ['dark', 'Dark'],
  ['chalk', 'Chalkboard'],
];

function Menu({ label, icon, children }: { label: string; icon: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} size={18} />
        <span className="label">{label}</span>
      </button>
      {open && <div className="menu-popover">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function TopBar({
  editor,
  ui,
  board,
  signedIn,
  onRename,
  pagesOpen,
  onTogglePages,
}: {
  editor: Editor;
  ui: UiState;
  board: Board;
  signedIn: boolean;
  onRename: (title: string) => void;
  pagesOpen: boolean;
  onTogglePages: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(board.title);
  const owner = ui.role === 'owner';
  const pageIndex = ui.pages.indexOf(ui.page) + 1;

  const saveTitle = async () => {
    setEditing(false);
    const t = title.trim();
    if (!t || t === board.title) return;
    try {
      await api.renameBoard(board.id, t);
      onRename(t);
    } catch (err) {
      editor.showToast(err instanceof Error ? err.message : String(err));
      setTitle(board.title);
    }
  };

  return (
    <header className="topbar">
      <div className="row">
        {signedIn && (
          <Link to="/" className="icon-link" title="My boards" aria-label="My boards">
            <Icon name="back" size={18} />
          </Link>
        )}
        {editing ? (
          <input
            className="title-input"
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveTitle();
              if (e.key === 'Escape') {
                setTitle(board.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h1 className="board-title" title={owner ? 'Click to rename' : undefined} onClick={() => owner && setEditing(true)}>
            {board.title}
          </h1>
        )}
        <span className={`status status-${ui.status}`} title={STATUS_LABEL[ui.status]}>
          <span className="dot" />
          <span className="label">{STATUS_LABEL[ui.status]}</span>
        </span>
        {ui.role === 'viewer' && <span className="badge">View only</span>}
      </div>
      <div className="row">
        {ui.canEdit && (
          <>
            <button title="Undo (Ctrl Z)" aria-label="Undo" disabled={!ui.canUndo} onClick={() => editor.undo()}>
              <Icon name="undo" size={18} />
            </button>
            <button title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!ui.canRedo} onClick={() => editor.redo()}>
              <Icon name="redo" size={18} />
            </button>
            <Menu label="Board" icon="theme">
              {(close) => (
                <>
                  <div className="menu-heading">Board style</div>
                  {THEMES.map(([t, label]) => (
                    <button
                      key={t}
                      className={`menu-item${ui.theme === t ? ' active' : ''}`}
                      onClick={() => {
                        editor.setTheme(t);
                        close();
                      }}
                    >
                      <span className={`theme-chip theme-chip-${t}`} />
                      {label}
                    </button>
                  ))}
                  <div className="menu-heading">Background of this page</div>
                  {BACKGROUNDS.map(([b, label]) => (
                    <button
                      key={b}
                      className={`menu-item${ui.background === b ? ' active' : ''}`}
                      onClick={() => {
                        editor.setBackground(b);
                        close();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </Menu>
          </>
        )}
        <Menu label="Export" icon="download">
          {(close) => (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  void editor.exportPng();
                }}
              >
                This page as PNG
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  void editor.exportPdf();
                }}
              >
                All pages as PDF
              </button>
            </>
          )}
        </Menu>
        {owner && (
          <button className="primary" onClick={() => editor.openDialog({ kind: 'share' })}>
            <Icon name="share" size={18} />
            <span className="label">Share</span>
          </button>
        )}
        <button title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => editor.openDialog({ kind: 'shortcuts' })}>
          <Icon name="help" size={18} />
        </button>
        <button className={pagesOpen ? 'active' : ''} title="Pages" aria-label="Pages" onClick={onTogglePages}>
          <Icon name="pages" size={18} />
          <span className="page-count">
            {pageIndex}/{ui.pages.length || 1}
          </span>
        </button>
      </div>
    </header>
  );
}
