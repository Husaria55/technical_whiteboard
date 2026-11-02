import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { BoardDoc } from './doc';
import type { ConnectionStatus } from './editor';

export interface BoardConnection {
  doc: BoardDoc;
  provider: WebsocketProvider;
  /** Resolves when the document is ready to show (server sync, or local cache when offline). */
  ready: Promise<void>;
  onStatus(fn: (s: ConnectionStatus) => void): void;
  onDenied(fn: (reason: string) => void): void;
  destroy(): void;
}

const OFFLINE_READY_MS = 4000;

/**
 * Connects a board's Yjs document to the server, with an IndexedDB cache so
 * the board keeps working offline; changes sync when the connection returns.
 */
export function connectBoard(boardId: string, token: string | null, canEdit: boolean): BoardConnection {
  const ydoc = new Y.Doc();
  const doc = new BoardDoc(ydoc);
  const local = new IndexeddbPersistence(`tw-board-${boardId}`, ydoc);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${proto}://${location.host}/api/boards/${boardId}`, 'ws', ydoc, {
    params: token ? { t: token } : {},
    maxBackoffTime: 5000,
  });

  let statusFn: (s: ConnectionStatus) => void = () => {};
  let deniedFn: (reason: string) => void = () => {};

  provider.on('status', ({ status }: { status: string }) => {
    statusFn(status === 'connected' ? 'connected' : provider.wsconnected ? 'connected' : status === 'connecting' ? 'connecting' : 'offline');
  });
  provider.on('connection-close', (event: CloseEvent | null) => {
    statusFn('offline');
    if (event && (event.code === 4403 || event.code === 4404)) {
      provider.disconnect();
      deniedFn(event.code === 4404 ? 'This board was deleted.' : 'Your access to this board has changed. Reload the page.');
    }
  });

  const ready = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (canEdit) doc.ensurePage();
      resolve();
    };
    provider.once('sync', finish);
    // Offline: fall back to the local copy after a short wait.
    void local.whenSynced.then(() => setTimeout(() => (doc.pageIds().length > 0 || !navigator.onLine ? finish() : undefined), 300));
    setTimeout(finish, OFFLINE_READY_MS);
  });

  return {
    doc,
    provider,
    ready,
    onStatus: (fn) => (statusFn = fn),
    onDenied: (fn) => (deniedFn = fn),
    destroy() {
      provider.awareness.setLocalState(null);
      provider.destroy();
      void local.destroy();
      ydoc.destroy();
    },
  };
}
