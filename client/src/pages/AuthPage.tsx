import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);

  useEffect(() => {
    api.config().then((c) => setAllowRegistration(c.allowRegistration), () => {});
  }, []);

  useEffect(() => {
    if (user) navigate(safeNext, { replace: true });
  }, [user, navigate, safeNext]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'login' ? await api.login(email, password) : await api.register(email, name, password);
      setUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const other = mode === 'login' ? '/register' : '/login';
  return (
    <div className="center-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Technical Whiteboard</h1>
            <p className="muted">Math &amp; physics tutoring board</p>
          </div>
        </div>
        <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'register' && (
          <label>
            Display name
            <input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        {(mode === 'register' || allowRegistration) && (
          <p className="muted small">
            {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
            <Link to={`${other}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
