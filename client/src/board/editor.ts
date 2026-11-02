import type { Awareness } from 'y-protocols/awareness';
import { api, type Role } from '../api';
import { assetsSettled, loadMathJax, onAssetLoaded } from './assets';
import { BoardDoc, newId } from './doc';
import {
  boxesIntersect,
  center,
  dist,
  hitTest,
  localPoints,
  localToWorld,
  objectBounds,
  type Box,
} from './geometry';
import {
  createInstrument,
  drawInstrument,
  findEdge,
  hitInstrument,
  toLocal,
  type Instrument,
  type InstrumentKind,
} from './instruments';
import { contentBounds } from './pageRender';
import { drawBackground, drawDraftStroke, drawObject, mathSize, type Camera } from './render';
import { layoutText } from './text';
import { THEMES, resolveColor } from './theme';
import {
  ArcTool,
  DrawTool,
  EraserTool,
  GraphTool,
  HandTool,
  MathTool,
  MeasureTool,
  PolygonTool,
  SelectTool,
  ShapeTool,
  TextTool,
  type Tool,
  type ToolEvent,
  type ToolId,
} from './tools';
import { INK, type Background, type BoardObject, type GraphObj, type MathObj, type TextObj, type Theme, type Vec } from './types';

export interface Style {
  color: string;
  highlighterColor: string;
  penSize: number;
  highlighterSize: number;
  width: number;
  fillEnabled: boolean;
  fill: string;
  fillOpacity: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  eraserMode: 'object' | 'area';
  eraserSize: number;
  selectMode: 'rect' | 'lasso';
  sides: number;
  triangleKind: 'isosceles' | 'right';
  arcKind: 'arc' | 'sector';
  measureMode: 'length' | 'angle';
  arrowBoth: boolean;
}

const DEFAULT_STYLE: Style = {
  color: INK,
  highlighterColor: '#ffe066',
  penSize: 3,
  highlighterSize: 18,
  width: 2.5,
  fillEnabled: false,
  fill: '#74c0fc',
  fillOpacity: 0.35,
  fontSize: 24,
  bold: false,
  italic: false,
  eraserMode: 'object',
  eraserSize: 24,
  selectMode: 'rect',
  sides: 6,
  triangleKind: 'isosceles',
  arcKind: 'arc',
  measureMode: 'length',
  arrowBoth: false,
};

/** Tools that do not change the document (allowed for viewers). */
const VIEW_TOOLS = new Set<ToolId>(['hand', 'select', 'measure']);

export type DraftWire =
  | { kind: 'stroke'; pts: number[]; pr: number[]; size: number; color: string; highlighter: boolean }
  | { kind: 'object'; obj: BoardObject };

export interface PeerUser {
  name: string;
  color: string;
}

interface PeerState {
  user?: PeerUser;
  page?: string;
  cursor?: { x: number; y: number } | null;
  draft?: DraftWire | null;
  instruments?: Instrument[];
}

export interface TextEditState {
  id: string | null;
  x: number;
  y: number;
  rot: number;
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export type Dialog =
  | { kind: 'math'; id: string | null; at: Vec; latex: string }
  | { kind: 'graph'; id: string | null; box: { x: number; y: number; w: number; h: number } | null; initial: Pick<GraphObj, 'fns' | 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'grid'> }
  | { kind: 'help' }
  | { kind: 'share' }
  | { kind: 'shortcuts' };

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export interface UiState {
  tool: ToolId;
  style: Style;
  selection: string[];
  selectionTypes: BoardObject['type'][];
  selectionLocked: boolean;
  page: string;
  pages: string[];
  theme: Theme;
  background: Background;
  camera: Camera;
  canEdit: boolean;
  role: Role;
  penOnly: boolean;
  instruments: InstrumentKind[];
  canUndo: boolean;
  canRedo: boolean;
  dialog: Dialog | null;
  textEdit: TextEditState | null;
  status: ConnectionStatus;
  toast: string | null;
  busy: string | null;
  docVersion: number;
}

export interface EditorOptions {
  boardId: string;
  token: string | null;
  role: Role;
  user: PeerUser;
  awareness: Awareness;
}

const CLIPBOARD_PREFIX = 'technical-whiteboard/objects:';
const STYLE_KEY = 'tw-style';

function loadStyle(): Style {
  try {
    return { ...DEFAULT_STYLE, ...(JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') as Partial<Style>) };
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

/**
 * The whiteboard editor: owns camera, tools, selection and input handling,
 * renders the board onto a canvas and exposes UI state to React.
 */
export class Editor {
  readonly doc: BoardDoc;
  readonly role: Role;
  readonly canEdit: boolean;
  readonly boardId: string;
  readonly token: string | null;
  readonly awareness: Awareness;

  style: Style = loadStyle();
  page: string;
  selection: string[] = [];
  private cameras = new Map<string, Camera>();
  private tools: Record<ToolId, Tool>;
  private tool: Tool;
  private preview: Map<string, BoardObject> | null = null;
  private instruments = new Map<InstrumentKind, Instrument>();
  private instrumentDrag: { kind: InstrumentKind; mode: 'move' | 'rotate' | 'needle'; offset: Vec; startAngle: number; angle0: number } | null =
    null;
  private penOnly = false;
  private penOnlyChosen = false;
  private dialog: Dialog | null = null;
  private textEdit: TextEditState | null = null;
  private status: ConnectionStatus = 'connecting';
  private toast: string | null = null;
  private toastTimer = 0;
  private busy: string | null = null;
  private docVersion = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;

  private pointers = new Map<number, { screen: Vec; type: string }>();
  private gesture: { kind: 'pan'; last: Vec } | { kind: 'pinch'; d0: number; z0: number; world: Vec } | null = null;
  private toolPointer: number | null = null;
  private spaceDown = false;
  private lastPointer: Vec | null = null;
  private cursorTimer = 0;
  private draftTimer = 0;
  private pendingDraft: DraftWire | null | undefined;

  private listeners = new Set<() => void>();
  private snapshot: UiState;
  private emitQueued = false;
  private disposers: (() => void)[] = [];

  constructor(doc: BoardDoc, options: EditorOptions) {
    this.doc = doc;
    this.role = options.role;
    this.canEdit = options.role !== 'viewer';
    this.boardId = options.boardId;
    this.token = options.token;
    this.awareness = options.awareness;
    this.page = doc.pageIds()[0] ?? 'p1';

    const t: Record<ToolId, Tool> = {
      select: new SelectTool(this),
      hand: new HandTool(this),
      pen: new DrawTool(this, 'pen'),
      highlighter: new DrawTool(this, 'highlighter'),
      eraser: new EraserTool(this),
      line: new ShapeTool(this, 'line'),
      arrow: new ShapeTool(this, 'arrow'),
      rect: new ShapeTool(this, 'rect'),
      ellipse: new ShapeTool(this, 'ellipse'),
      triangle: new ShapeTool(this, 'triangle'),
      ngon: new ShapeTool(this, 'ngon'),
      polygon: new PolygonTool(this),
      arc: new ArcTool(this, 'arc'),
      compass: new ArcTool(this, 'compass'),
      text: new TextTool(this),
      math: new MathTool(this),
      graph: new GraphTool(this),
      measure: new MeasureTool(this),
    };
    this.tools = t;
    this.tool = this.canEdit ? t.pen : t.hand;

    try {
      this.penOnly = localStorage.getItem('tw-pen-only') === '1';
      this.penOnlyChosen = localStorage.getItem('tw-pen-only') !== null;
    } catch {
      /* storage unavailable */
    }

    this.awareness.setLocalState({ user: options.user, page: this.page, cursor: null, draft: null, instruments: [] });

    const onObjects = () => {
      this.docVersion++;
      const before = this.selection.length;
      this.selection = this.selection.filter((id) => this.doc.objects.has(id));
      if (this.selection.length !== before) this.preview = null;
      this.requestRender();
      this.emit();
    };
    const onPages = () => {
      this.docVersion++;
      const ids = this.doc.pageIds();
      if (ids.length && !ids.includes(this.page)) this.setPage(ids[0]!);
      this.emit();
      this.requestRender();
    };
    const onMeta = () => {
      this.emit();
      this.requestRender();
    };
    const onUndo = () => this.emit();
    const onAwareness = () => this.requestRender();
    doc.objects.observe(onObjects);
    doc.pages.observe(onPages);
    doc.pageInfo.observe(onMeta);
    doc.meta.observe(onMeta);
    doc.undo.on('stack-item-added', onUndo);
    doc.undo.on('stack-item-popped', onUndo);
    doc.undo.on('stack-cleared', onUndo);
    this.awareness.on('change', onAwareness);
    const offAssets = onAssetLoaded(() => this.requestRender());
    this.disposers.push(
      () => doc.objects.unobserve(onObjects),
      () => doc.pages.unobserve(onPages),
      () => doc.pageInfo.unobserve(onMeta),
      () => doc.meta.unobserve(onMeta),
      () => doc.undo.off('stack-item-added', onUndo),
      () => doc.undo.off('stack-item-popped', onUndo),
      () => doc.undo.off('stack-cleared', onUndo),
      () => this.awareness.off('change', onAwareness),
      () => void offAssets(),
    );
    this.snapshot = this.buildSnapshot();
  }

  // ---------- UI store ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.snapshot = this.buildSnapshot();
      this.listeners.forEach((fn) => fn());
    });
  }

  private buildSnapshot(): UiState {
    const sel = this.selectedObjects();
    return {
      tool: this.tool.id,
      style: this.style,
      selection: this.selection,
      selectionTypes: [...new Set(sel.map((o) => o.type))],
      selectionLocked: sel.some((o) => o.locked),
      page: this.page,
      pages: this.doc.pageIds(),
      theme: this.theme,
      background: this.doc.page(this.page).background,
      camera: { ...this.camera },
      canEdit: this.canEdit,
      role: this.role,
      penOnly: this.penOnly,
      instruments: [...this.instruments.keys()],
      canUndo: this.doc.undo.undoStack.length > 0,
      canRedo: this.doc.undo.redoStack.length > 0,
      dialog: this.dialog,
      textEdit: this.textEdit,
      status: this.status,
      toast: this.toast,
      busy: this.busy,
      docVersion: this.docVersion,
    };
  }

  get theme(): Theme {
    return this.doc.theme;
  }

  get camera(): Camera {
    let c = this.cameras.get(this.page);
    if (!c) {
      c = { x: -60, y: -60, zoom: 1 };
      this.cameras.set(this.page, c);
    }
    return c;
  }

  setStatus(status: ConnectionStatus) {
    this.status = status;
    this.emit();
  }

  showToast(message: string, ms = 3500) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.emit();
    }, ms);
    this.emit();
  }

  private async withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.busy = label;
    this.emit();
    try {
      return await fn();
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), 6000);
      return undefined;
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  // ---------- Canvas & rendering ----------

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.width = rect.width;
      this.height = rect.height;
      canvas.width = Math.round(rect.width * this.dpr);
      canvas.height = Math.round(rect.height * this.dpr);
      this.renderNow();
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(canvas);
    resize();
    canvas.style.cursor = this.cursorFor(null);
  }

  detach() {
    this.resizeObserver?.disconnect();
    this.canvas = null;
    this.ctx = null;
    cancelAnimationFrame(this.frame);
  }

  dispose() {
    this.detach();
    this.disposers.forEach((d) => d());
    clearTimeout(this.toastTimer);
    clearTimeout(this.cursorTimer);
    clearTimeout(this.draftTimer);
  }

  requestRender() {
    if (this.frame || !this.ctx) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private viewBox(): Box {
    const c = this.camera;
    return { minX: c.x, minY: c.y, maxX: c.x + this.width / c.zoom, maxY: c.y + this.height / c.zoom };
  }

  private renderNow() {
    const ctx = this.ctx;
    if (!ctx || this.width === 0) return;
    const cam = this.camera;
    const theme = this.theme;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const view = this.viewBox();
    drawBackground(ctx, this.doc.page(this.page).background, theme, view, cam.zoom);

    const env = { theme, pixelsPerUnit: cam.zoom * this.dpr };
    const editingId = this.textEdit?.id;
    for (const stored of this.doc.pageObjects(this.page)) {
      const o = this.preview?.get(stored.id) ?? stored;
      if (o.id === editingId) continue;
      if (!boxesIntersect(objectBounds(o), view)) continue;
      drawObject(ctx, o, env);
    }

    // Other users' in-progress drawings and instruments.
    const peers = this.peers();
    for (const p of peers) {
      if (p.state.page !== this.page || !p.state.draft) continue;
      this.drawDraft(ctx, p.state.draft);
    }
    this.tool.drawOverlay?.(ctx);
    const ink = THEMES[theme].ink;
    for (const p of peers) {
      if (p.state.page !== this.page) continue;
      for (const inst of p.state.instruments ?? []) {
        drawInstrument(ctx, inst, { ink, accent: p.state.user?.color ?? '#888', zoom: cam.zoom, remote: true });
      }
    }
    for (const inst of this.instruments.values()) {
      drawInstrument(ctx, inst, { ink, accent: THEMES[theme].selection, zoom: cam.zoom });
    }
    // Remote cursors.
    for (const p of peers) {
      const c = p.state.cursor;
      if (p.state.page !== this.page || !c) continue;
      this.drawCursor(ctx, c, p.state.user ?? { name: 'Guest', color: '#888' });
    }
    ctx.restore();
  }

  private drawDraft(ctx: CanvasRenderingContext2D, d: DraftWire) {
    if (d.kind === 'stroke') {
      const pts: Vec[] = [];
      for (let i = 0; i + 1 < d.pts.length; i += 2) pts.push({ x: d.pts[i]!, y: d.pts[i + 1]! });
      drawDraftStroke(ctx, pts, d.pr, d.size, resolveColor(d.color, this.theme), d.highlighter);
    } else {
      this.drawObjectPreview(ctx, d.obj);
    }
  }

  drawObjectPreview(ctx: CanvasRenderingContext2D, o: BoardObject) {
    drawObject(ctx, o, { theme: this.theme, pixelsPerUnit: this.camera.zoom * this.dpr });
  }

  private drawCursor(ctx: CanvasRenderingContext2D, at: Vec, user: PeerUser) {
    const z = this.camera.zoom;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(1 / z, 1 / z);
    ctx.fillStyle = user.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.5, 12.5);
    ctx.lineTo(11, 12.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(user.name).width + 10;
    ctx.beginPath();
    ctx.roundRect(10, 16, w, 19, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(user.name, 15, 26);
    ctx.restore();
  }

  private peers(): { id: number; state: PeerState }[] {
    const out: { id: number; state: PeerState }[] = [];
    this.awareness.getStates().forEach((state, id) => {
      if (id !== this.awareness.clientID) out.push({ id, state: state as PeerState });
    });
    return out;
  }

  // ---------- Camera ----------

  screenToWorld(p: Vec): Vec {
    const c = this.camera;
    return { x: c.x + p.x / c.zoom, y: c.y + p.y / c.zoom };
  }

  worldToScreen(p: Vec): Vec {
    const c = this.camera;
    return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
  }

  private cameraChanged() {
    this.requestRender();
    this.emit();
  }

  panBy(dx: number, dy: number) {
    const c = this.camera;
    c.x -= dx / c.zoom;
    c.y -= dy / c.zoom;
    this.cameraChanged();
  }

  zoomAt(screen: Vec, factor: number) {
    const c = this.camera;
    const world = this.screenToWorld(screen);
    c.zoom = Math.min(20, Math.max(0.05, c.zoom * factor));
    c.x = world.x - screen.x / c.zoom;
    c.y = world.y - screen.y / c.zoom;
    this.cameraChanged();
  }

  zoomBy(factor: number) {
    this.zoomAt({ x: this.width / 2, y: this.height / 2 }, factor);
  }

  setZoom(zoom: number) {
    this.zoomBy(zoom / this.camera.zoom);
  }

  zoomToFit() {
    const b = contentBounds(this.doc, this.page);
    const c = this.camera;
    if (!b) {
      Object.assign(c, { x: -60, y: -60, zoom: 1 });
    } else {
      const pad = 40;
      const zoom = Math.min(4, Math.max(0.05, Math.min((this.width - pad * 2) / (b.maxX - b.minX || 1), (this.height - pad * 2) / (b.maxY - b.minY || 1))));
      c.zoom = zoom;
      c.x = (b.minX + b.maxX) / 2 - this.width / 2 / zoom;
      c.y = (b.minY + b.maxY) / 2 - this.height / 2 / zoom;
    }
    this.cameraChanged();
  }

  viewportCenter(): Vec {
    return this.screenToWorld({ x: this.width / 2, y: this.height / 2 });
  }

  // ---------- Tools & style ----------

  setTool(id: ToolId) {
    if (!this.canEdit && !VIEW_TOOLS.has(id)) return;
    if (this.textEdit) void this.commitTextEdit();
    this.tool.cancel();
    this.tool = this.tools[id];
    if (id !== 'select') this.select([]);
    if (this.canvas) this.canvas.style.cursor = this.cursorFor(null);
    this.requestRender();
    this.emit();
  }

  setStyle(patch: Partial<Style>) {
    this.style = { ...this.style, ...patch };
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(this.style));
    } catch {
      /* storage unavailable */
    }
    if (this.textEdit) {
      const t = this.textEdit;
      this.textEdit = {
        ...t,
        color: patch.color ?? t.color,
        fontSize: patch.fontSize !== undefined ? patch.fontSize / this.camera.zoom : t.fontSize,
        bold: patch.bold ?? t.bold,
        italic: patch.italic ?? t.italic,
      };
    }
    this.applyStyleToSelection(patch);
    this.requestRender();
    this.emit();
  }

  private applyStyleToSelection(patch: Partial<Style>) {
    if (!this.canEdit || this.selection.length === 0) return;
    const z = this.camera.zoom;
    const updated: BoardObject[] = [];
    for (const o of this.selectedObjects()) {
      let n: BoardObject = o;
      if (patch.color !== undefined && (o.type === 'shape' || o.type === 'text' || o.type === 'math' || (o.type === 'stroke' && !o.highlighter))) {
        n = { ...n, color: patch.color } as BoardObject;
      }
      if (patch.highlighterColor !== undefined && o.type === 'stroke' && o.highlighter) n = { ...n, color: patch.highlighterColor } as BoardObject;
      if (n.type === 'shape') {
        if (patch.width !== undefined) n = { ...n, width: patch.width / z };
        if (patch.fillEnabled !== undefined || patch.fill !== undefined) {
          const enabled = patch.fillEnabled ?? n.fill !== null;
          n = { ...n, fill: enabled && n.shape !== 'line' && n.shape !== 'arc' ? (patch.fill ?? this.style.fill) : null };
        }
        if (patch.fillOpacity !== undefined) n = { ...n, fillOpacity: patch.fillOpacity };
      }
      if (n.type === 'text' && (patch.fontSize !== undefined || patch.bold !== undefined || patch.italic !== undefined || patch.color !== undefined)) {
        const t: TextObj = {
          ...n,
          fontSize: patch.fontSize !== undefined ? patch.fontSize / z : n.fontSize,
          bold: patch.bold ?? n.bold,
          italic: patch.italic ?? n.italic,
        };
        const layout = layoutText(t, '#000');
        n = { ...t, w: layout.width, h: layout.height };
      }
      if (n !== o) updated.push(n);
    }
    if (updated.length) this.doc.put(updated);
  }

  setPenOnly(on: boolean) {
    this.penOnly = on;
    this.penOnlyChosen = true;
    try {
      localStorage.setItem('tw-pen-only', on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.emit();
  }

  // ---------- Pages ----------

  setPage(id: string) {
    if (id === this.page) return;
    if (this.textEdit) void this.commitTextEdit();
    this.tool.cancel();
    this.page = id;
    this.selection = [];
    this.preview = null;
    this.awareness.setLocalStateField('page', id);
    this.requestRender();
    this.emit();
  }

  addPage() {
    if (!this.canEdit) return;
    this.setPage(this.doc.addPage(this.page));
  }

  deletePage(id: string) {
    if (!this.canEdit) return;
    const ids = this.doc.pageIds();
    if (ids.length <= 1) {
      // Keep one page: clear it instead.
      this.doc.remove(this.doc.pageObjects(id).map((o) => o.id));
      return;
    }
    const i = ids.indexOf(id);
    if (id === this.page) this.setPage(ids[i + 1] ?? ids[i - 1]!);
    this.doc.deletePage(id);
  }

  setBackground(bg: Background) {
    if (this.canEdit) this.doc.setBackground(this.page, bg);
  }

  setTheme(theme: Theme) {
    if (this.canEdit) this.doc.theme = theme;
  }

  // ---------- Selection & objects ----------

  select(ids: string[]) {
    this.selection = ids;
    this.requestRender();
    this.emit();
  }

  selectedObjects(): BoardObject[] {
    const out: BoardObject[] = [];
    for (const id of this.selection) {
      const o = this.preview?.get(id) ?? this.doc.get(id);
      if (o) out.push(o);
    }
    return out;
  }

  setPreview(objs: BoardObject[] | null) {
    this.preview = objs ? new Map(objs.map((o) => [o.id, o])) : null;
    this.requestRender();
  }

  commitPreview() {
    if (this.preview && this.preview.size) this.doc.put([...this.preview.values()]);
    this.preview = null;
    this.requestRender();
    this.emit();
  }

  hitObject(p: Vec, filter?: (o: BoardObject) => boolean): BoardObject | null {
    const tol = 6 / this.camera.zoom;
    const objs = this.doc.pageObjects(this.page);
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i]!;
      if (o.locked || (filter && !filter(o))) continue;
      if (hitTest(o, p, tol)) return o;
    }
    return null;
  }

  /** Snaps to nearby shape vertices and centres (used by the measure tool). */
  snapToObjects(p: Vec): Vec {
    const tol = 9 / this.camera.zoom;
    let best: Vec | null = null;
    let bestD = tol;
    const consider = (q: Vec) => {
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    };
    for (const o of this.doc.pageObjects(this.page)) {
      if (o.type !== 'shape') continue;
      const b = objectBounds(o);
      if (p.x < b.minX - tol || p.x > b.maxX + tol || p.y < b.minY - tol || p.y > b.maxY + tol) continue;
      if (o.pts) for (const q of localPoints(o as typeof o & { pts: number[] })) consider(localToWorld(o, q));
      if (o.shape === 'rect') for (const q of [{ x: 0, y: 0 }, { x: o.w, y: 0 }, { x: o.w, y: o.h }, { x: 0, y: o.h }]) consider(localToWorld(o, q));
      if (o.shape === 'ellipse' || o.shape === 'arc' || o.shape === 'sector') consider(center(o));
    }
    return best ?? p;
  }

  deleteSelection() {
    if (!this.canEdit || this.selection.length === 0) return;
    this.doc.remove(this.selection);
    this.select([]);
  }

  selectAll() {
    this.setTool('select');
    this.select(this.doc.pageObjects(this.page).filter((o) => !o.locked).map((o) => o.id));
  }

  setLocked(locked: boolean) {
    if (!this.canEdit) return;
    this.doc.put(this.selectedObjects().map((o) => ({ ...o, locked: locked || undefined })));
    if (locked) this.select([]);
  }

  unlockAll() {
    if (!this.canEdit) return;
    const locked = this.doc.pageObjects(this.page).filter((o) => o.locked);
    this.doc.put(locked.map((o) => ({ ...o, locked: undefined })));
    this.setTool('select');
    this.select(locked.map((o) => o.id));
  }

  /** Inserts copies of objects (new ids, current page, on top), offset or centred at `at`. */
  private insertCopies(objs: BoardObject[], offset: Vec | null, at?: Vec) {
    if (!this.canEdit || objs.length === 0) return;
    let d = offset ?? { x: 0, y: 0 };
    if (at) {
      const b = objs.map(objectBounds).reduce((a, x) => ({
        minX: Math.min(a.minX, x.minX),
        minY: Math.min(a.minY, x.minY),
        maxX: Math.max(a.maxX, x.maxX),
        maxY: Math.max(a.maxY, x.maxY),
      }));
      d = { x: at.x - (b.minX + b.maxX) / 2, y: at.y - (b.minY + b.maxY) / 2 };
    }
    let z = this.doc.nextZ(this.page);
    const copies = objs
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((o) => ({ ...o, id: newId(), page: this.page, x: o.x + d.x, y: o.y + d.y, z: z++, locked: undefined }) as BoardObject);
    this.doc.put(copies);
    this.setTool('select');
    this.select(copies.map((o) => o.id));
  }

  duplicateSelection() {
    const off = 20 / this.camera.zoom;
    this.insertCopies(this.selectedObjects(), { x: off, y: off });
  }

  copySelection(data: DataTransfer | null): boolean {
    const objs = this.selectedObjects();
    if (objs.length === 0) return false;
    const text = CLIPBOARD_PREFIX + JSON.stringify(objs);
    if (data) data.setData('text/plain', text);
    else void navigator.clipboard?.writeText(text).catch(() => {});
    return true;
  }

  async paste(data: DataTransfer) {
    if (!this.canEdit) return;
    const at = this.lastPointer ?? this.viewportCenter();
    const file = [...data.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      await this.insertImage(file, at);
      return;
    }
    const text = data.getData('text/plain');
    if (!text) return;
    if (text.startsWith(CLIPBOARD_PREFIX)) {
      try {
        const objs = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as BoardObject[];
        this.insertCopies(objs, null, at);
      } catch {
        this.showToast('Could not paste these objects');
      }
      return;
    }
    // Plain text becomes a text box.
    const fontSize = this.style.fontSize / this.camera.zoom;
    const t = { text: text.slice(0, 5000), fontSize, bold: this.style.bold, italic: this.style.italic, color: this.style.color };
    if (t.text.includes('$')) await loadMathJax();
    const layout = layoutText(t, '#000');
    this.doc.put([
      { id: newId(), type: 'text', page: this.page, x: at.x, y: at.y, w: layout.width, h: layout.height, rot: 0, z: this.doc.nextZ(this.page), ...t },
    ]);
  }

  undo() {
    if (!this.canEdit) return;
    this.tool.cancel();
    this.doc.undo.undo();
  }

  redo() {
    if (!this.canEdit) return;
    this.tool.cancel();
    this.doc.undo.redo();
  }

  /** Groups all changes until endGesture() into one undo step. */
  beginGesture() {
    this.doc.undo.stopCapturing();
    this.doc.undo.captureTimeout = 1e9;
  }

  endGesture() {
    this.doc.undo.captureTimeout = 400;
    this.doc.undo.stopCapturing();
  }

  editObject(o: BoardObject) {
    if (o.type === 'text') this.startTextEdit(o, { x: o.x, y: o.y });
    else if (o.type === 'math') this.openMathDialog(o, center(o));
    else if (o.type === 'graph') this.openGraphDialog(o, null);
  }

  // ---------- Text editing ----------

  startTextEdit(existing: TextObj | null, at: Vec) {
    if (!this.canEdit) return;
    if (this.textEdit) void this.commitTextEdit();
    const z = this.camera.zoom;
    this.textEdit = existing
      ? { id: existing.id, x: existing.x, y: existing.y, rot: existing.rot, text: existing.text, fontSize: existing.fontSize, color: existing.color, bold: !!existing.bold, italic: !!existing.italic }
      : {
          id: null,
          x: at.x,
          y: at.y - (this.style.fontSize * 0.7) / z,
          rot: 0,
          text: '',
          fontSize: this.style.fontSize / z,
          color: this.style.color,
          bold: this.style.bold,
          italic: this.style.italic,
        };
    this.requestRender();
    this.emit();
  }

  updateTextEdit(text: string) {
    if (!this.textEdit) return;
    this.textEdit = { ...this.textEdit, text };
    this.emit();
  }

  cancelTextEdit() {
    this.textEdit = null;
    this.requestRender();
    this.emit();
  }

  async commitTextEdit() {
    const t = this.textEdit;
    if (!t) return;
    this.textEdit = null;
    this.emit();
    const existing = t.id ? (this.doc.get(t.id) as TextObj | undefined) : undefined;
    if (!t.text.trim()) {
      if (existing) this.doc.remove([existing.id]);
      this.requestRender();
      return;
    }
    if (t.text.includes('$')) await loadMathJax();
    const layout = layoutText(t, '#000');
    const obj: TextObj = {
      id: existing?.id ?? newId(),
      type: 'text',
      page: existing?.page ?? this.page,
      x: t.x,
      y: t.y,
      w: layout.width,
      h: layout.height,
      rot: t.rot,
      z: existing?.z ?? this.doc.nextZ(this.page),
      text: t.text,
      fontSize: t.fontSize,
      color: t.color,
      ...(t.bold ? { bold: true } : {}),
      ...(t.italic ? { italic: true } : {}),
    };
    this.doc.put([obj]);
    this.requestRender();
  }

  // ---------- Dialogs ----------

  openDialog(dialog: Dialog | null) {
    this.dialog = dialog;
    this.emit();
  }

  openMathDialog(existing: MathObj | null, at: Vec) {
    if (!this.canEdit) return;
    void loadMathJax();
    this.openDialog({ kind: 'math', id: existing?.id ?? null, at, latex: existing?.latex ?? '' });
  }

  async saveMath(latex: string) {
    const d = this.dialog;
    if (d?.kind !== 'math') return;
    this.openDialog(null);
    if (!latex.trim()) return;
    await loadMathJax();
    const existing = d.id ? (this.doc.get(d.id) as MathObj | undefined) : undefined;
    const size = mathSize(latex);
    if (!size) return;
    if (existing) {
      const old = mathSize(existing.latex);
      const s = old && old.h > 0 ? existing.h / old.h : 1;
      this.doc.put([{ ...existing, latex, w: size.w * s, h: size.h * s }]);
      return;
    }
    const s = 1 / this.camera.zoom;
    const w = size.w * s;
    const h = size.h * s;
    const obj: MathObj = {
      id: newId(),
      type: 'math',
      page: this.page,
      x: d.at.x - w / 2,
      y: d.at.y - h / 2,
      w,
      h,
      rot: 0,
      z: this.doc.nextZ(this.page),
      latex,
      color: this.style.color,
    };
    this.doc.put([obj]);
    if (size.error) this.showToast(`LaTeX: ${size.error}`);
  }

  openGraphDialog(existing: GraphObj | null, box: { x: number; y: number; w: number; h: number } | null) {
    if (!this.canEdit) return;
    const initial = existing
      ? { fns: existing.fns, xMin: existing.xMin, xMax: existing.xMax, yMin: existing.yMin, yMax: existing.yMax, grid: existing.grid }
      : (() => {
          const aspect = box ? box.h / box.w : 0.75;
          return { fns: [{ expr: 'sin(x)', color: '#1971c2' }], xMin: -8, xMax: 8, yMin: -8 * aspect, yMax: 8 * aspect, grid: true };
        })();
    this.openDialog({ kind: 'graph', id: existing?.id ?? null, box, initial });
  }

  saveGraph(values: Pick<GraphObj, 'fns' | 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'grid'>) {
    const d = this.dialog;
    if (d?.kind !== 'graph') return;
    this.openDialog(null);
    const existing = d.id ? (this.doc.get(d.id) as GraphObj | undefined) : undefined;
    if (existing) {
      this.doc.put([{ ...existing, ...values }]);
      return;
    }
    const box = d.box ?? { ...this.viewportCenter(), w: 480 / this.camera.zoom, h: 360 / this.camera.zoom };
    this.doc.put([
      { id: newId(), type: 'graph', page: this.page, ...box, rot: 0, z: this.doc.nextZ(this.page), ...values },
    ]);
  }

  // ---------- Images, PDF & export ----------

  async insertImage(file: Blob, at?: Vec) {
    if (!this.canEdit) return;
    await this.withBusy('Uploading image…', async () => {
      const { url } = await api.upload(this.boardId, this.token, file, (file as File).name ?? 'image');
      const img = new Image();
      img.src = url;
      await img.decode();
      const z = this.camera.zoom;
      const maxW = (this.width * 0.6) / z;
      const maxH = (this.height * 0.6) / z;
      const s = Math.min(1 / z, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const c = at ?? this.viewportCenter();
      const obj: BoardObject = { id: newId(), type: 'image', page: this.page, x: c.x - w / 2, y: c.y - h / 2, w, h, rot: 0, z: this.doc.nextZ(this.page), src: url };
      this.doc.put([obj]);
      this.setTool('select');
      this.select([obj.id]);
    });
  }

  async importPdf(file: File) {
    if (!this.canEdit) return;
    await this.withBusy('Importing PDF…', async () => {
      const { importPdf } = await import('./pdfImport');
      const first = await importPdf(this, file, (n, total) => {
        this.busy = `Importing PDF page ${n} of ${total}…`;
        this.emit();
      });
      if (first) {
        this.setPage(first);
        this.zoomToFit();
      }
    });
  }

  async exportPng() {
    await this.withBusy('Exporting PNG…', async () => {
      await assetsSettled();
      const { exportPagePng } = await import('./exporter');
      await exportPagePng(this.doc, this.page, this.theme, this.exportName());
    });
  }

  async exportPdf() {
    await this.withBusy('Exporting PDF…', async () => {
      const { exportBoardPdf } = await import('./exporter');
      await exportBoardPdf(this.doc, this.theme, this.exportName());
    });
  }

  exportTitle = 'board';

  private exportName() {
    return this.exportTitle.replace(/[^\w\- ]+/g, '').trim() || 'board';
  }

  // ---------- Instruments ----------

  toggleInstrument(kind: InstrumentKind) {
    if (this.instruments.has(kind)) this.instruments.delete(kind);
    else this.instruments.set(kind, createInstrument(kind, this.viewportCenter()));
    this.broadcastInstruments();
    this.requestRender();
    this.emit();
  }

  private broadcastInstruments() {
    this.awareness.setLocalStateField('instruments', [...this.instruments.values()]);
  }

  findSnapEdge(p: Vec) {
    if (this.instruments.size === 0) return null;
    return findEdge([...this.instruments.values()], p, 14 / this.camera.zoom);
  }

  private instrumentAt(p: Vec) {
    const list = [...this.instruments.values()].reverse();
    for (const inst of list) {
      const hit = hitInstrument(inst, p, this.camera.zoom);
      if (hit) return { inst, hit };
    }
    return null;
  }

  // ---------- Awareness ----------

  setDraft(draft: DraftWire | null) {
    // Throttle draft broadcasts; always send the final null promptly.
    this.pendingDraft = draft;
    if (draft === null) {
      clearTimeout(this.draftTimer);
      this.draftTimer = 0;
      this.awareness.setLocalStateField('draft', null);
      return;
    }
    if (this.draftTimer) return;
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = 0;
      if (this.pendingDraft !== undefined) this.awareness.setLocalStateField('draft', this.pendingDraft);
    }, 60);
  }

  private broadcastCursor(p: Vec | null) {
    if (this.cursorTimer) return;
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = 0;
      const c = this.lastPointer;
      this.awareness.setLocalStateField('cursor', c ? { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 } : null);
    }, 40);
    if (p === null) this.lastPointer = null;
  }

  // ---------- Input ----------

  private cursorFor(world: Vec | null): string {
    if (this.spaceDown || this.gesture?.kind === 'pan') return 'grabbing';
    if (world) {
      const inst = this.instrumentAt(world);
      if (inst) {
        const drawing = ['pen', 'highlighter', 'line', 'arrow'].includes(this.tool.id) && this.findSnapEdge(world);
        if (!drawing) return inst.hit === 'body' ? 'move' : 'grab';
      }
      if (this.tool instanceof SelectTool) return this.tool.cursorAt(world);
    }
    return this.tool.cursor;
  }

  private toolEvent(e: PointerEvent, coalesced = false): ToolEvent {
    const rect = this.canvas!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hasPressure = e.pointerType === 'pen';
    const events = coalesced && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    return {
      world: this.screenToWorld(screen),
      screen,
      pressure: hasPressure ? e.pressure || 0.5 : 0.5,
      hasPressure,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      coalesced: events.slice(0, -1).map((c) => ({
        world: this.screenToWorld({ x: c.clientX - rect.left, y: c.clientY - rect.top }),
        pressure: hasPressure ? c.pressure || 0.5 : 0.5,
      })),
      detail: e.detail,
    };
  }

  onPointerDown = (e: PointerEvent) => {
    if (!this.canvas) return;
    if (this.textEdit) {
      void this.commitTextEdit();
      if (this.tool.id === 'text') return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.pointers.set(e.pointerId, { screen, type: e.pointerType });

    if (e.pointerType === 'pen' && !this.penOnlyChosen && !this.penOnly) {
      this.penOnly = true;
      this.showToast('Pen detected: fingers now pan and zoom. Change this under “Pen only”.');
    }

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length >= 2) {
      // Second finger: switch to pinch zoom and abandon any tool action.
      if (this.toolPointer !== null) {
        this.tool.cancel();
        this.setPreview(null);
        this.toolPointer = null;
      }
      this.instrumentDrag = null;
      const a = touches[0]!;
      const b = touches[1]!;
      const mid = { x: (a.screen.x + b.screen.x) / 2, y: (a.screen.y + b.screen.y) / 2 };
      this.gesture = { kind: 'pinch', d0: dist(a.screen, b.screen), z0: this.camera.zoom, world: this.screenToWorld(mid) };
      return;
    }
    if (this.pointers.size > 1 && this.toolPointer !== null) return;

    const panning =
      e.button === 1 ||
      e.button === 2 ||
      this.spaceDown ||
      (e.pointerType === 'touch' && this.penOnly);
    if (panning) {
      this.gesture = { kind: 'pan', last: screen };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const ev = this.toolEvent(e);
    const inst = this.instrumentAt(ev.world);
    const drawsAlongEdges = ['pen', 'highlighter', 'line', 'arrow'].includes(this.tool.id);
    if (inst && !(drawsAlongEdges && this.findSnapEdge(ev.world))) {
      this.instrumentDrag = {
        kind: inst.inst.kind,
        mode: inst.hit === 'body' ? 'move' : inst.hit,
        offset: { x: inst.inst.x - ev.world.x, y: inst.inst.y - ev.world.y },
        startAngle: Math.atan2(ev.world.y - inst.inst.y, ev.world.x - inst.inst.x),
        angle0: inst.inst.angle,
      };
      return;
    }

    this.toolPointer = e.pointerId;
    this.tool.down(ev);
    this.requestRender();
  };

  onPointerMove = (e: PointerEvent) => {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const p = this.pointers.get(e.pointerId);
    if (p) p.screen = screen;
    const world = this.screenToWorld(screen);
    this.lastPointer = world;
    this.broadcastCursor(world);

    const g = this.gesture;
    if (g?.kind === 'pinch') {
      const touches = [...this.pointers.values()].filter((t) => t.type === 'touch');
      if (touches.length >= 2) {
        const a = touches[0]!;
        const b = touches[1]!;
        const mid = { x: (a.screen.x + b.screen.x) / 2, y: (a.screen.y + b.screen.y) / 2 };
        const c = this.camera;
        c.zoom = Math.min(20, Math.max(0.05, (g.z0 * dist(a.screen, b.screen)) / Math.max(g.d0, 1)));
        c.x = g.world.x - mid.x / c.zoom;
        c.y = g.world.y - mid.y / c.zoom;
        this.cameraChanged();
      }
      return;
    }
    if (g?.kind === 'pan') {
      this.panBy(screen.x - g.last.x, screen.y - g.last.y);
      g.last = screen;
      return;
    }
    if (this.instrumentDrag) {
      const d = this.instrumentDrag;
      const inst = this.instruments.get(d.kind);
      if (inst) {
        if (d.mode === 'move') {
          inst.x = world.x + d.offset.x;
          inst.y = world.y + d.offset.y;
        } else if (d.mode === 'rotate') {
          let a = d.angle0 + Math.atan2(world.y - inst.y, world.x - inst.x) - d.startAngle;
          const snap = e.shiftKey ? Math.PI / 12 : Math.PI / 180;
          a = Math.round(a / snap) * snap;
          inst.angle = a;
        } else {
          const l = toLocal(inst, world);
          let deg = (Math.atan2(-l.y, l.x) * 180) / Math.PI;
          if (deg < -90) deg = 180;
          inst.needle = Math.round(Math.max(0, Math.min(180, deg)));
        }
        this.broadcastInstruments();
        this.requestRender();
      }
      return;
    }
    if (this.toolPointer === e.pointerId) {
      this.tool.move(this.toolEvent(e, true));
    } else if (this.pointers.size === 0) {
      this.tool.hover?.(this.toolEvent(e));
      this.canvas.style.cursor = this.cursorFor(world);
    }
  };

  onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.gesture) {
      if (this.gesture.kind === 'pinch') {
        const touches = [...this.pointers.values()].filter((t) => t.type === 'touch');
        if (touches.length < 2) this.gesture = null;
      } else if (this.pointers.size === 0) {
        this.gesture = null;
      }
      if (this.canvas && !this.gesture) this.canvas.style.cursor = this.cursorFor(null);
      return;
    }
    if (this.instrumentDrag) {
      this.instrumentDrag = null;
      return;
    }
    if (this.toolPointer === e.pointerId) {
      this.toolPointer = null;
      if (e.type === 'pointercancel') this.tool.cancel();
      else this.tool.up(this.toolEvent(e));
      this.requestRender();
    }
  };

  onPointerLeave = () => {
    if (this.pointers.size === 0) {
      this.broadcastCursor(null);
    }
  };

  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const scaleDelta = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const dx = e.deltaX * scaleDelta;
    const dy = e.deltaY * scaleDelta;
    // Pinch on trackpads arrives as ctrl+wheel. A classic mouse wheel sends
    // large vertical steps without horizontal movement: zoom. Trackpad
    // two-finger scrolling pans.
    const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy));
    if (e.ctrlKey || e.metaKey || (mouseWheel && !e.shiftKey)) {
      this.zoomAt(screen, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    } else if (e.shiftKey && dx === 0) {
      this.panBy(-dy, 0);
    } else {
      this.panBy(-dx, -dy);
    }
  };

  /** Handles a keyboard shortcut; returns true when consumed. */
  onKeyDown = (e: KeyboardEvent): boolean => {
    if (this.tool.keyDown?.(e)) return true;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === ' ' && !this.spaceDown) {
      this.spaceDown = true;
      if (this.canvas) this.canvas.style.cursor = 'grab';
      return true;
    }
    if (mod) {
      switch (key) {
        case 'z':
          if (e.shiftKey) this.redo();
          else this.undo();
          return true;
        case 'y':
          this.redo();
          return true;
        case 'a':
          this.selectAll();
          return true;
        case 'd':
          this.duplicateSelection();
          return true;
        case '0':
          this.setZoom(1);
          return true;
        case '=':
        case '+':
          this.zoomBy(1.25);
          return true;
        case '-':
          this.zoomBy(0.8);
          return true;
      }
      return false;
    }
    if (e.altKey) return false;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        this.deleteSelection();
        return true;
      case 'Escape':
        this.tool.cancel();
        this.select([]);
        this.openDialog(null);
        return true;
      case 'PageDown':
      case 'PageUp': {
        const ids = this.doc.pageIds();
        const i = ids.indexOf(this.page) + (e.key === 'PageDown' ? 1 : -1);
        if (ids[i]) this.setPage(ids[i]!);
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!this.selection.length || !this.canEdit) return false;
        const step = (e.shiftKey ? 10 : 1) / this.camera.zoom;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.doc.put(this.selectedObjects().map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })));
        return true;
      }
      case '?':
        this.openDialog({ kind: 'shortcuts' });
        return true;
      case '!':
        this.zoomToFit();
        return true;
    }
    const tool = e.shiftKey ? undefined : TOOL_KEYS[key];
    if (tool) {
      this.setTool(tool);
      return true;
    }
    const inst = e.shiftKey ? SHIFT_INSTRUMENT_KEYS[key] : INSTRUMENT_KEYS[key];
    if (inst) {
      this.toggleInstrument(inst);
      return true;
    }
    return false;
  };

  onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      this.spaceDown = false;
      if (this.canvas) this.canvas.style.cursor = this.cursorFor(this.lastPointer);
    }
  };
}

export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  i: 'highlighter',
  e: 'eraser',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  y: 'triangle',
  j: 'polygon',
  n: 'ngon',
  k: 'arc',
  c: 'compass',
  t: 'text',
  m: 'math',
  g: 'graph',
  d: 'measure',
};

export const INSTRUMENT_KEYS: Record<string, InstrumentKind> = { u: 'ruler', w: 'protractor', q: 'square45' };
const SHIFT_INSTRUMENT_KEYS: Record<string, InstrumentKind> = { q: 'square60' };
