import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { Db } from './db.js';
import type { Role } from './boards.js';

// Message types of the y-websocket protocol.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

const SAVE_DEBOUNCE_MS = 1500;
const UNLOAD_DELAY_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

interface Conn {
  role: Role;
  token: string | undefined;
  clientIds: Set<number>;
  alive: boolean;
}

interface Room {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Conn>;
  saveTimer: NodeJS.Timeout | null;
  unloadTimer: NodeJS.Timeout | null;
  dirty: boolean;
}

/**
 * Hosts Yjs documents for boards and relays updates between clients.
 * Implements the y-websocket wire protocol, with server-side enforcement
 * of read-only access for viewers.
 */
export class CollabServer {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room>>();
  private pingTimer: NodeJS.Timeout;

  constructor(private db: Db) {
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  private async loadRoom(id: string): Promise<Room> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    let pending = this.loading.get(id);
    if (!pending) {
      pending = (async () => {
        const doc = new Y.Doc({ gc: true });
        const row = await this.db.get<{ ydoc: Uint8Array | null }>('SELECT ydoc FROM boards WHERE id = ?', [id]);
        if (row?.ydoc && row.ydoc.length > 0) Y.applyUpdate(doc, new Uint8Array(row.ydoc));
        const awareness = new awarenessProtocol.Awareness(doc);
        awareness.setLocalState(null);
        const room: Room = { id, doc, awareness, conns: new Map(), saveTimer: null, unloadTimer: null, dirty: false };

        doc.on('update', (update: Uint8Array) => {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.writeUpdate(encoder, update);
          this.broadcast(room, encoding.toUint8Array(encoder));
          room.dirty = true;
          this.scheduleSave(room);
        });

        awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
          const changed = added.concat(updated, removed);
          const conn = origin ? room.conns.get(origin as WebSocket) : undefined;
          if (conn) {
            for (const id of added) conn.clientIds.add(id);
            for (const id of removed) conn.clientIds.delete(id);
          }
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
          this.broadcast(room, encoding.toUint8Array(encoder));
        });

        this.rooms.set(id, room);
        this.loading.delete(id);
        return room;
      })();
      this.loading.set(id, pending);
    }
    return pending;
  }

  private broadcast(room: Room, message: Uint8Array) {
    for (const ws of room.conns.keys()) this.send(room, ws, message);
  }

  private send(room: Room, ws: WebSocket, message: Uint8Array) {
    if (ws.readyState !== ws.OPEN) {
      this.closeConn(room, ws);
      return;
    }
    ws.send(message, (err) => err && this.closeConn(room, ws));
  }

  private scheduleSave(room: Room) {
    if (room.saveTimer) return;
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      void this.save(room);
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(room: Room) {
    if (!room.dirty) return;
    room.dirty = false;
    const state = Y.encodeStateAsUpdate(room.doc);
    await this.db.run('UPDATE boards SET ydoc = ?, updated_at = ? WHERE id = ?', [state, Date.now(), room.id]);
  }

  async handleConnection(ws: WebSocket, boardId: string, role: Role, token: string | undefined) {
    ws.binaryType = 'arraybuffer';
    // Buffer messages that arrive while the document is loading.
    const queued: ArrayBuffer[] = [];
    const queue = (data: ArrayBuffer) => queued.push(data);
    ws.on('message', queue);

    const room = await this.loadRoom(boardId);
    if (room.unloadTimer) {
      clearTimeout(room.unloadTimer);
      room.unloadTimer = null;
    }
    const conn: Conn = { role, token, clientIds: new Set(), alive: true };
    room.conns.set(ws, conn);

    ws.off('message', queue);
    ws.on('message', (data: ArrayBuffer) => this.handleMessage(room, ws, conn, new Uint8Array(data)));
    ws.on('pong', () => (conn.alive = true));
    ws.on('close', () => this.closeConn(room, ws));

    // Start sync: send our state vector, then current awareness states.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    this.send(room, ws, encoding.toUint8Array(encoder));
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
      this.send(room, ws, encoding.toUint8Array(enc));
    }
    for (const data of queued) this.handleMessage(room, ws, conn, new Uint8Array(data));
  }

  private handleMessage(room: Room, ws: WebSocket, conn: Conn, data: Uint8Array) {
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = decoding.readVarUint(decoder);
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, encoder, room.doc);
        } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
          // Viewers are read-only: their document changes are dropped.
          if (conn.role !== 'viewer') Y.applyUpdate(room.doc, decoding.readVarUint8Array(decoder), ws);
        }
        if (encoding.length(encoder) > 1) this.send(room, ws, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
      } else if (type === MESSAGE_QUERY_AWARENESS) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]),
        );
        this.send(room, ws, encoding.toUint8Array(encoder));
      }
    } catch {
      ws.close(1003, 'bad message');
    }
  }

  private closeConn(room: Room, ws: WebSocket) {
    const conn = room.conns.get(ws);
    if (!conn) return;
    room.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.clientIds], null);
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    if (room.conns.size === 0) {
      room.unloadTimer = setTimeout(() => void this.unload(room), UNLOAD_DELAY_MS);
      room.unloadTimer.unref();
    }
  }

  private async unload(room: Room) {
    if (room.conns.size > 0) return;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = null;
    await this.save(room);
    room.awareness.destroy();
    room.doc.destroy();
    this.rooms.delete(room.id);
  }

  private ping() {
    for (const room of this.rooms.values()) {
      for (const [ws, conn] of room.conns) {
        if (!conn.alive) {
          ws.terminate();
          this.closeConn(room, ws);
          continue;
        }
        conn.alive = false;
        ws.ping();
      }
    }
  }

  /** Current full state of a board (in-memory if loaded), used for duplication. */
  currentState(boardId: string): Uint8Array | null {
    const room = this.rooms.get(boardId);
    return room ? Y.encodeStateAsUpdate(room.doc) : null;
  }

  /** Disconnects everyone except the owner, e.g. after share links change. */
  kickGuests(boardId: string, code = 4403) {
    const room = this.rooms.get(boardId);
    if (!room) return;
    for (const [ws, conn] of room.conns) if (conn.role !== 'owner') ws.close(code, 'access changed');
  }

  /** Closes and forgets a board, e.g. after deletion. */
  async drop(boardId: string) {
    const room = this.rooms.get(boardId);
    if (!room) return;
    room.dirty = false;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    for (const ws of room.conns.keys()) ws.close(4404, 'board deleted');
    room.conns.clear();
    room.awareness.destroy();
    room.doc.destroy();
    this.rooms.delete(boardId);
  }

  async flushAll() {
    clearInterval(this.pingTimer);
    for (const room of this.rooms.values()) {
      if (room.saveTimer) clearTimeout(room.saveTimer);
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      await this.save(room);
      room.awareness.destroy();
    }
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}
