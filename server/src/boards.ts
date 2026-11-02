import type { Db } from './db.js';
import type { User } from './auth.js';

export type Role = 'owner' | 'editor' | 'viewer';

export interface BoardRow {
  id: string;
  owner_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  edit_token: string | null;
  view_token: string | null;
}

const BOARD_COLUMNS = 'id, owner_id, title, created_at, updated_at, edit_token, view_token';

export function getBoard(db: Db, id: string): Promise<BoardRow | undefined> {
  return db.get<BoardRow>(`SELECT ${BOARD_COLUMNS} FROM boards WHERE id = ?`, [id]);
}

export function listBoards(db: Db, ownerId: string): Promise<BoardRow[]> {
  return db.all<BoardRow>(`SELECT ${BOARD_COLUMNS} FROM boards WHERE owner_id = ? ORDER BY updated_at DESC`, [ownerId]);
}

/**
 * Resolves the role a visitor has on a board.
 * Owners always get "owner"; everyone else needs a valid share token.
 */
export function resolveRole(board: BoardRow, user: User | null, token: string | undefined): Role | null {
  if (user && user.id === board.owner_id) return 'owner';
  if (token && board.edit_token && token === board.edit_token) return 'editor';
  if (token && board.view_token && token === board.view_token) return 'viewer';
  return null;
}

export function publicBoard(board: BoardRow, role: Role) {
  return {
    id: board.id,
    title: board.title,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
    role,
    ...(role === 'owner' ? { editToken: board.edit_token, viewToken: board.view_token } : {}),
  };
}
