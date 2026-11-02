export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Board {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  role: Role;
  editToken?: string | null;
  viewToken?: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

const q = (token?: string | null) => (token ? `?t=${encodeURIComponent(token)}` : '');

export const api = {
  config: () => request<{ allowRegistration: boolean }>('GET', '/api/config'),
  me: () => request<{ user: User | null }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (email: string, name: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { email, name, password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  boards: () => request<{ boards: Board[] }>('GET', '/api/boards'),
  createBoard: (title: string) => request<{ board: Board }>('POST', '/api/boards', { title }),
  board: (id: string, token?: string | null) =>
    request<{ board: Board; user: User | null }>('GET', `/api/boards/${id}${q(token)}`),
  renameBoard: (id: string, title: string) => request<{ board: Board }>('PATCH', `/api/boards/${id}`, { title }),
  duplicateBoard: (id: string) => request<{ board: Board }>('POST', `/api/boards/${id}/duplicate`),
  deleteBoard: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}`),
  share: (id: string, kind: 'edit' | 'view', enabled: boolean) =>
    request<{ board: Board }>('POST', `/api/boards/${id}/share`, { kind, enabled }),

  upload: (boardId: string, token: string | null, file: Blob, name = 'image') => {
    const form = new FormData();
    form.append('file', file, name);
    return request<{ id: string; url: string }>('POST', `/api/boards/${boardId}/files${q(token)}`, form);
  },
};

export function shareUrl(boardId: string, token: string) {
  return `${location.origin}/b/${boardId}?t=${encodeURIComponent(token)}`;
}
