import { useState } from 'react';
import { api, shareUrl, type Board } from '../api';
import type { Editor } from '../board/editor';
import { Modal } from './Modal';

function LinkRow({ label, help, token, onToggle, onRegenerate, busy }: { label: string; help: string; token: string | null | undefined; onToggle: (on: boolean) => void; onRegenerate: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = token ? shareUrl(location.pathname.split('/')[2]!, token) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the field is selectable */
    }
  };
  return (
    <section className="share-row">
      <div className="row space">
        <div>
          <strong>{label}</strong>
          <p className="muted small">{help}</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!token} disabled={busy} onChange={(e) => onToggle(e.target.checked)} /> Enabled
        </label>
      </div>
      {token && (
        <div className="row">
          <input className="grow mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
          <button onClick={onRegenerate} disabled={busy} title="Create a new link; the old one stops working">
            New link
          </button>
        </div>
      )}
    </section>
  );
}

export function ShareDialog({ editor, board, onChange }: { editor: Editor; board: Board; onChange: (b: Board) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (kind: 'edit' | 'view', enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await api.share(board.id, kind, enabled)).board);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Share board" onClose={() => editor.openDialog(null)}>
      <p className="muted">Students open the link and type their name; they don't need an account. Turning a link off or creating a new one disconnects everyone using the old link.</p>
      <LinkRow
        label="Can edit"
        help="For your student: draw, write and add pages."
        token={board.editToken}
        busy={busy}
        onToggle={(on) => void update('edit', on)}
        onRegenerate={() => void update('edit', true)}
      />
      <LinkRow
        label="View only"
        help="Watch the board live without changing it."
        token={board.viewToken}
        busy={busy}
        onToggle={(on) => void update('view', on)}
        onRegenerate={() => void update('view', true)}
      />
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
