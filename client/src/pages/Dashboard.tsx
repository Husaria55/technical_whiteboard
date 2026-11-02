import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Board } from '../api';
import { useAuth } from '../App';
import { Icon } from '../ui/Icon';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function Dashboard() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    try {
      setBoards((await api.boards()).boards);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { board } = await api.createBoard(title.trim() || 'Untitled board');
      navigate(`/b/${board.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <h1>My boards</h1>
        </div>
        <div className="row">
          <span className="muted">{user?.name}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <form className="new-board" onSubmit={create}>
        <input placeholder="New board title, e.g. “Quadratic equations – Anna”" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <button className="primary">
          <Icon name="plus" size={18} /> New board
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {boards === null ? (
        <p className="muted">Loading…</p>
      ) : boards.length === 0 ? (
        <p className="muted empty">No boards yet. Create your first one above.</p>
      ) : (
        <ul className="board-list">
          {boards.map((b) => (
            <li key={b.id} className="board-item">
              {renaming === b.id ? (
                <form
                  className="row grow"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setRenaming(null);
                    if (renameValue.trim()) void run(() => api.renameBoard(b.id, renameValue.trim()));
                  }}
                >
                  <input autoFocus value={renameValue} maxLength={200} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
                  <button className="primary">Save</button>
                </form>
              ) : (
                <Link to={`/b/${b.id}`} className="grow board-link">
                  <strong>{b.title}</strong>
                  <span className="muted small">Edited {fmtDate(b.updatedAt)}</span>
                </Link>
              )}
              <div className="row">
                <button
                  title="Rename"
                  onClick={() => {
                    setRenaming(b.id);
                    setRenameValue(b.title);
                  }}
                >
                  Rename
                </button>
                <button title="Duplicate" onClick={() => void run(() => api.duplicateBoard(b.id))}>
                  <Icon name="copy" size={16} /> Duplicate
                </button>
                <button
                  className="danger"
                  title="Delete"
                  onClick={() => {
                    if (confirm(`Delete “${b.title}”? This cannot be undone.`)) void run(() => api.deleteBoard(b.id));
                  }}
                >
                  <Icon name="trash" size={16} /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
