import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Board, type User } from '../api';
import { useAuth } from '../App';
import { connectBoard } from '../board/connection';
import { Editor } from '../board/editor';
import { Whiteboard } from '../ui/Whiteboard';

const CURSOR_COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#d6336c', '#5c940d'];

function storedGuestName(): string {
  try {
    return localStorage.getItem('tw-guest-name') ?? '';
  } catch {
    return '';
  }
}

function cursorColor(): string {
  try {
    let c = localStorage.getItem('tw-cursor-color');
    if (!c) {
      c = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]!;
      localStorage.setItem('tw-cursor-color', c);
    }
    return c;
  } catch {
    return CURSOR_COLORS[0]!;
  }
}

export function BoardPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t');
  const { loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    api.board(id, token).then(
      (res) => {
        if (cancelled) return;
        setBoard(res.board);
        setUser(res.user);
        if (!res.user) setGuestName(storedGuestName() || null);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401 && !token) {
          navigate(`/login?next=${encodeURIComponent(`/b/${id}`)}`, { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, token, authLoading, navigate]);

  if (error) {
    return (
      <div className="center-page">
        <div className="card">
          <h2>Cannot open this board</h2>
          <p className="error">{error}</p>
          <Link to="/">Go to my boards</Link>
        </div>
      </div>
    );
  }
  if (!board) return <div className="center-page muted">Loading board…</div>;
  if (!user && !guestName) return <GuestNamePrompt onDone={setGuestName} />;
  return <BoardSession key={board.id} board={board} token={token} name={user?.name ?? guestName!} signedIn={!!user} />;
}

function GuestNamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState(storedGuestName());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().slice(0, 40);
    if (!n) return;
    try {
      localStorage.setItem('tw-guest-name', n);
    } catch {
      /* storage unavailable */
    }
    onDone(n);
  };
  return (
    <div className="center-page">
      <form className="card auth-card" onSubmit={submit}>
        <h2>Join the board</h2>
        <p className="muted">Your name is only shown to others on this board next to your cursor. It is not stored on the server.</p>
        <label>
          Your name
          <input autoFocus required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="primary">Join</button>
      </form>
    </div>
  );
}

function BoardSession({ board, token, name, signedIn }: { board: Board; token: string | null; name: string; signedIn: boolean }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [title, setTitle] = useState(board.title);

  useEffect(() => {
    const canEdit = board.role !== 'viewer';
    const conn = connectBoard(board.id, token, canEdit);
    const ed = new Editor(conn.doc, {
      boardId: board.id,
      token,
      role: board.role,
      user: { name, color: cursorColor() },
      awareness: conn.provider.awareness,
    });
    ed.exportTitle = board.title;
    conn.onStatus((s) => ed.setStatus(s));
    conn.onDenied(setDenied);
    let cancelled = false;
    void conn.ready.then(() => {
      if (!cancelled) setEditor(ed);
    });
    return () => {
      cancelled = true;
      ed.dispose();
      conn.destroy();
    };
  }, [board.id, board.role, token, name, board.title]);

  if (denied) {
    return (
      <div className="center-page">
        <div className="card">
          <h2>Disconnected</h2>
          <p>{denied}</p>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
  if (!editor) return <div className="center-page muted">Connecting…</div>;
  return <Whiteboard editor={editor} board={{ ...board, title }} signedIn={signedIn} onRename={setTitle} />;
}
