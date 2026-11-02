import * as Y from 'yjs';
import type { Background, BoardObject, PageInfo, Theme } from './types';

export const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
};

const FIRST_PAGE = 'p1';

/**
 * Typed wrapper around the shared Yjs document of a board.
 *
 * Layout:
 *  - `objects`: Y.Map<id, BoardObject>   all objects of all pages
 *  - `pages`:   Y.Array<pageId>          page order
 *  - `pageInfo`: Y.Map<pageId, PageInfo> per-page settings
 *  - `meta`:    Y.Map                    board settings (theme)
 */
export class BoardDoc {
  readonly objects: Y.Map<BoardObject>;
  readonly pages: Y.Array<string>;
  readonly pageInfo: Y.Map<PageInfo>;
  readonly meta: Y.Map<unknown>;
  readonly undo: Y.UndoManager;
  /** Origin used for all local transactions so the undo manager only tracks our own changes. */
  readonly origin = { local: true };

  constructor(readonly doc: Y.Doc) {
    this.objects = doc.getMap('objects');
    this.pages = doc.getArray('pages');
    this.pageInfo = doc.getMap('pageInfo');
    this.meta = doc.getMap('meta');
    this.undo = new Y.UndoManager([this.objects, this.pages, this.pageInfo, this.meta], {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: 400,
    });
  }

  transact(fn: () => void) {
    this.doc.transact(fn, this.origin);
  }

  /** Ensures the board has at least one page. Uses a fixed id so concurrent inits merge. */
  ensurePage() {
    if (this.pageIds().length > 0) return;
    this.doc.transact(() => {
      this.pages.push([FIRST_PAGE]);
      if (!this.pageInfo.has(FIRST_PAGE)) this.pageInfo.set(FIRST_PAGE, { background: 'grid' });
    });
  }

  /** Page ids in order, de-duplicated (concurrent inserts can duplicate ids). */
  pageIds(): string[] {
    return [...new Set(this.pages.toArray())];
  }

  page(id: string): PageInfo {
    return this.pageInfo.get(id) ?? { background: 'grid' };
  }

  addPage(after?: string, background?: Background): string {
    const id = newId();
    const ids = this.pages.toArray();
    const index = after ? ids.indexOf(after) + 1 : ids.length;
    this.transact(() => {
      this.pages.insert(index > 0 ? index : ids.length, [id]);
      this.pageInfo.set(id, { background: background ?? (after ? this.page(after).background : 'grid') });
    });
    return id;
  }

  deletePage(id: string) {
    this.transact(() => {
      const ids = this.pages.toArray();
      for (let i = ids.length - 1; i >= 0; i--) if (ids[i] === id) this.pages.delete(i, 1);
      for (const [oid, o] of this.objects) if (o.page === id) this.objects.delete(oid);
      this.pageInfo.delete(id);
    });
  }

  movePage(id: string, delta: number) {
    const ids = this.pageIds();
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    this.transact(() => {
      const raw = this.pages.toArray();
      for (let i = raw.length - 1; i >= 0; i--) if (raw[i] === id) this.pages.delete(i, 1);
      const target = ids[to]!;
      const at = this.pages.toArray().indexOf(target);
      this.pages.insert(delta > 0 ? at + 1 : at, [id]);
    });
  }

  setBackground(page: string, background: Background) {
    this.transact(() => this.pageInfo.set(page, { ...this.page(page), background }));
  }

  get theme(): Theme {
    return (this.meta.get('theme') as Theme | undefined) ?? 'light';
  }

  set theme(theme: Theme) {
    this.transact(() => this.meta.set('theme', theme));
  }

  pageObjects(page: string): BoardObject[] {
    const out: BoardObject[] = [];
    for (const o of this.objects.values()) if (o.page === page) out.push(o);
    return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  }

  nextZ(page: string): number {
    let z = 0;
    for (const o of this.objects.values()) if (o.page === page && o.z > z) z = o.z;
    return z + 1;
  }

  get(id: string) {
    return this.objects.get(id);
  }

  put(objects: BoardObject[]) {
    this.transact(() => {
      for (const o of objects) this.objects.set(o.id, o);
    });
  }

  remove(ids: Iterable<string>) {
    this.transact(() => {
      for (const id of ids) this.objects.delete(id);
    });
  }
}
