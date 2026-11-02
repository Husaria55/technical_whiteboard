import {
  add,
  boxContains,
  boxFromPoints,
  center,
  dist,
  distToSegment,
  hitTest,
  objectBounds,
  pathFromWorldPoints,
  pointInPolygon,
  rotate,
  rotateAround,
  samplePoints,
  sub,
  vec,
  worldPoints,
} from './geometry';
import { newId } from './doc';
import type { Editor } from './editor';
import { snapToEdge, type EdgeSnap } from './instruments';
import { drawDraftStroke } from './render';
import { resolveColor, THEMES } from './theme';
import { UNITS_PER_CM, type BoardObject, type ShapeObj, type StrokeObj, type Vec } from './types';

export type ToolId =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'ngon'
  | 'arc'
  | 'compass'
  | 'text'
  | 'math'
  | 'graph'
  | 'measure';

export interface ToolEvent {
  world: Vec;
  screen: Vec;
  pressure: number;
  /** Whether the input device reports real pressure (pen). */
  hasPressure: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** Coalesced high-frequency points since the last move (world coords). */
  coalesced: { world: Vec; pressure: number }[];
  detail: number;
}

export interface Tool {
  readonly id: ToolId;
  readonly cursor: string;
  down(e: ToolEvent): void;
  move(e: ToolEvent): void;
  up(e: ToolEvent): void;
  /** Pointer movement without a button pressed. */
  hover?(e: ToolEvent): void;
  cancel(): void;
  /** Overlay drawn in world coordinates on top of the board. */
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  keyDown?(e: KeyboardEvent): boolean;
  /** Whether a gesture is in progress (used to block page switches etc.). */
  readonly active?: boolean;
}

const fmtCm = (units: number) => `${(units / UNITS_PER_CM).toFixed(2)} cm`;
const deg = (rad: number) => (rad * 180) / Math.PI;
const snapAngle = (a: number, stepDeg = 15) => {
  const s = (stepDeg * Math.PI) / 180;
  return Math.round(a / s) * s;
};

/** Draws a measurement label in screen-constant size at a world position. */
export function drawLabel(ctx: CanvasRenderingContext2D, editor: Editor, at: Vec, text: string) {
  const z = editor.camera.zoom;
  ctx.save();
  ctx.font = `600 ${13 / z}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const pad = 5 / z;
  const x = at.x + 12 / z;
  const y = at.y - 26 / z;
  ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y, w + pad * 2, 20 / z, 4 / z);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y + 10 / z);
  ctx.restore();
}

// ---------- Hand ----------

export class HandTool implements Tool {
  readonly id = 'hand';
  readonly cursor = 'grab';
  private last: Vec | null = null;
  constructor(private editor: Editor) {}
  down(e: ToolEvent) {
    this.last = e.screen;
  }
  move(e: ToolEvent) {
    if (!this.last) return;
    this.editor.panBy(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = e.screen;
  }
  up() {
    this.last = null;
  }
  cancel() {
    this.last = null;
  }
}

// ---------- Pen & highlighter ----------

export class DrawTool implements Tool {
  readonly cursor = 'crosshair';
  private points: Vec[] = [];
  private pressures: number[] = [];
  private usePressure = false;
  private edge: EdgeSnap | null = null;
  constructor(
    private editor: Editor,
    readonly id: 'pen' | 'highlighter',
  ) {}

  get active() {
    return this.points.length > 0;
  }

  private get highlighter() {
    return this.id === 'highlighter';
  }

  private size() {
    const s = this.editor.style;
    return (this.highlighter ? s.highlighterSize : s.penSize) / this.editor.camera.zoom;
  }

  private color() {
    return this.highlighter ? this.editor.style.highlighterColor : this.editor.style.color;
  }

  down(e: ToolEvent) {
    this.edge = this.editor.findSnapEdge(e.world);
    this.usePressure = e.hasPressure;
    this.points = [];
    this.pressures = [];
    this.add(e.world, e.pressure);
  }

  private add(p: Vec, pressure: number) {
    const pt = this.edge ? snapToEdge(this.edge, p) : p;
    const last = this.points[this.points.length - 1];
    if (last && dist(last, pt) < 0.4 / this.editor.camera.zoom) return;
    this.points.push(pt);
    this.pressures.push(pressure);
  }

  move(e: ToolEvent) {
    if (!this.active) return;
    for (const c of e.coalesced) this.add(c.world, c.pressure);
    this.add(e.world, e.pressure);
    this.editor.setDraft(this.wireDraft());
    this.editor.requestRender();
  }

  private wireDraft() {
    const pts: number[] = [];
    for (const p of this.points) pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
    return {
      kind: 'stroke' as const,
      pts,
      pr: this.usePressure ? this.pressures.map((p) => Math.round(p * 100) / 100) : [],
      size: this.size(),
      color: this.color(),
      highlighter: this.highlighter,
    };
  }

  up() {
    if (!this.active) return;
    const geom = pathFromWorldPoints(this.points);
    const stroke: StrokeObj = {
      id: newId(),
      type: 'stroke',
      page: this.editor.page,
      rot: 0,
      z: this.editor.doc.nextZ(this.editor.page),
      ...geom,
      pr: this.usePressure ? this.pressures.map((p) => Math.round(p * 100) / 100) : [],
      color: this.color(),
      size: Math.round(this.size() * 100) / 100,
      ...(this.highlighter ? { highlighter: true } : {}),
    };
    this.editor.doc.put([stroke]);
    this.points = [];
    this.pressures = [];
    this.edge = null;
    this.editor.setDraft(null);
  }

  cancel() {
    this.points = [];
    this.pressures = [];
    this.editor.setDraft(null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.active) return;
    drawDraftStroke(
      ctx,
      this.points,
      this.usePressure ? this.pressures : [],
      this.size(),
      resolveColor(this.color(), this.editor.theme),
      this.highlighter,
    );
    if (this.edge && this.points.length > 1) {
      drawLabel(ctx, this.editor, this.points[this.points.length - 1]!, fmtCm(dist(this.points[0]!, this.points[this.points.length - 1]!)));
    }
  }
}

// ---------- Eraser ----------

/** Inserts points so consecutive points are at most `step` apart. */
function densify(pts: Vec[], step: number): { pts: Vec[]; src: number[] } {
  const out: Vec[] = [];
  const src: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const prev = pts[i - 1]!;
      const n = Math.floor(dist(prev, p) / step);
      for (let k = 1; k < n; k++) {
        out.push(add(prev, { x: ((p.x - prev.x) * k) / n, y: ((p.y - prev.y) * k) / n }));
        src.push(i);
      }
    }
    out.push(p);
    src.push(i);
  }
  return { pts: out, src };
}

/** Splits a stroke where it is touched by the eraser segment a→b with radius r. */
export function eraseFromStroke(o: StrokeObj, a: Vec, b: Vec, r: number, makeId: () => string): StrokeObj[] | null {
  const dense = densify(worldPoints(o), Math.max(r / 2, 0.5));
  const keep = dense.pts.map((p) => distToSegment(p, a, b) > r + o.size / 4);
  if (keep.every(Boolean)) return null;
  const pieces: StrokeObj[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const geom = pathFromWorldPoints(run.map((i) => dense.pts[i]!));
      pieces.push({
        ...o,
        id: makeId(),
        rot: 0,
        ...geom,
        pr: o.pr.length ? run.map((i) => o.pr[dense.src[i]!] ?? 0.5) : [],
      });
    }
    run = [];
  };
  keep.forEach((k, i) => (k ? run.push(i) : flush()));
  flush();
  return pieces;
}

export class EraserTool implements Tool {
  readonly id = 'eraser';
  readonly cursor = 'none';
  private last: Vec | null = null;
  private hoverPos: Vec | null = null;
  constructor(private editor: Editor) {}

  get active() {
    return this.last !== null;
  }

  private radius() {
    return this.editor.style.eraserSize / 2 / this.editor.camera.zoom;
  }

  down(e: ToolEvent) {
    this.editor.beginGesture();
    this.last = e.world;
    this.erase(e.world, e.world);
  }

  move(e: ToolEvent) {
    this.hoverPos = e.world;
    if (this.last) {
      this.erase(this.last, e.world);
      this.last = e.world;
    }
    this.editor.requestRender();
  }

  hover(e: ToolEvent) {
    this.hoverPos = e.world;
    this.editor.requestRender();
  }

  private erase(a: Vec, b: Vec) {
    const r = this.radius();
    const doc = this.editor.doc;
    const objs = doc.pageObjects(this.editor.page).filter((o) => !o.locked);
    if (this.editor.style.eraserMode === 'object') {
      const ids = objs
        .filter((o) => {
          const steps = Math.max(1, Math.ceil(dist(a, b) / Math.max(r, 1)));
          for (let i = 0; i <= steps; i++) {
            const p = add(a, { x: ((b.x - a.x) * i) / steps, y: ((b.y - a.y) * i) / steps });
            if (hitTest(o, p, r)) return true;
          }
          return false;
        })
        .map((o) => o.id);
      if (ids.length) doc.remove(ids);
      return;
    }
    const removed: string[] = [];
    const added: StrokeObj[] = [];
    for (const o of objs) {
      if (o.type !== 'stroke') continue;
      const bounds = objectBounds(o);
      const seg = boxFromPoints([a, b]);
      if (bounds.maxX < seg.minX - r || bounds.minX > seg.maxX + r || bounds.maxY < seg.minY - r || bounds.minY > seg.maxY + r) continue;
      const pieces = eraseFromStroke(o, a, b, r, newId);
      if (pieces) {
        removed.push(o.id);
        added.push(...pieces);
      }
    }
    if (removed.length) {
      doc.transact(() => {
        doc.remove(removed);
        doc.put(added);
      });
    }
  }

  up() {
    this.last = null;
    this.editor.endGesture();
  }

  cancel() {
    if (this.last) this.editor.endGesture();
    this.last = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.hoverPos) return;
    ctx.save();
    ctx.lineWidth = 1.5 / this.editor.camera.zoom;
    ctx.strokeStyle = THEMES[this.editor.theme].ink;
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.beginPath();
    ctx.arc(this.hoverPos.x, this.hoverPos.y, this.radius(), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Shapes ----------

type ShapeToolId = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle' | 'ngon';

export class ShapeTool implements Tool {
  readonly cursor = 'crosshair';
  private start: Vec | null = null;
  private current: Vec | null = null;
  private shift = false;
  private edge: EdgeSnap | null = null;
  constructor(
    private editor: Editor,
    readonly id: ShapeToolId,
  ) {}

  get active() {
    return this.start !== null;
  }

  down(e: ToolEvent) {
    this.edge = this.id === 'line' || this.id === 'arrow' ? this.editor.findSnapEdge(e.world) : null;
    this.start = this.edge ? snapToEdge(this.edge, e.world) : e.world;
    this.current = this.start;
  }

  move(e: ToolEvent) {
    if (!this.start) return;
    this.current = this.edge ? snapToEdge(this.edge, e.world) : e.world;
    this.shift = e.shift;
    const obj = this.build();
    this.editor.setDraft(obj ? { kind: 'object', obj } : null);
    this.editor.requestRender();
  }

  /** Builds the shape for the current drag, or null if it is too small. */
  build(): ShapeObj | null {
    const s = this.start;
    let c = this.current;
    if (!s || !c) return null;
    const ed = this.editor;
    const style = ed.style;
    const zoom = ed.camera.zoom;
    if (dist(s, c) < 3 / zoom) return null;
    const base = {
      id: newId(),
      type: 'shape' as const,
      page: ed.page,
      rot: 0,
      z: ed.doc.nextZ(ed.page),
      color: style.color,
      width: Math.round((style.width / zoom) * 100) / 100,
      fill: style.fillEnabled ? style.fill : null,
      fillOpacity: style.fillOpacity,
    };
    if (this.shift && !this.edge) {
      if (this.id === 'line' || this.id === 'arrow') {
        const a = snapAngle(Math.atan2(c.y - s.y, c.x - s.x));
        const l = dist(s, c);
        c = { x: s.x + Math.cos(a) * l, y: s.y + Math.sin(a) * l };
      } else if (this.id !== 'ngon') {
        const d = Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));
        c = { x: s.x + Math.sign(c.x - s.x || 1) * d, y: s.y + Math.sign(c.y - s.y || 1) * d };
      }
    }
    const box = { x: Math.min(s.x, c.x), y: Math.min(s.y, c.y), w: Math.abs(c.x - s.x), h: Math.abs(c.y - s.y) };
    switch (this.id) {
      case 'line':
      case 'arrow':
        return {
          ...base,
          fill: null,
          shape: 'line',
          ...pathFromWorldPoints([s, c]),
          ...(this.id === 'arrow' ? { arrowEnd: true, arrowStart: style.arrowBoth } : {}),
        };
      case 'rect':
        return { ...base, shape: 'rect', ...box };
      case 'ellipse':
        return { ...base, shape: 'ellipse', ...box };
      case 'triangle': {
        const pts =
          style.triangleKind === 'right' ? [s, vec(s.x, c.y), c] : [vec((s.x + c.x) / 2, s.y), c, vec(s.x, c.y)];
        return { ...base, shape: 'polygon', ...pathFromWorldPoints(pts) };
      }
      case 'ngon': {
        const n = Math.max(3, Math.min(24, Math.round(style.sides)));
        const r = dist(s, c);
        let a0 = Math.atan2(c.y - s.y, c.x - s.x);
        if (this.shift) a0 = snapAngle(a0, 180 / n) + (n % 2 === 0 ? Math.PI / n : 0);
        const pts = Array.from({ length: n }, (_, i) => {
          const a = a0 + (Math.PI * 2 * i) / n;
          return vec(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
        });
        return { ...base, shape: 'polygon', ...pathFromWorldPoints(pts) };
      }
    }
  }

  up() {
    const obj = this.build();
    if (obj) {
      this.editor.doc.put([obj]);
    }
    this.cancel();
  }

  cancel() {
    this.start = null;
    this.current = null;
    this.edge = null;
    this.editor.setDraft(null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    const obj = this.build();
    if (!obj) return;
    this.editor.drawObjectPreview(ctx, obj);
    if (this.start && this.current) {
      if (this.id === 'line' || this.id === 'arrow') {
        const pts = worldPoints(obj as ShapeObj & { pts: number[] });
        const a = pts[0]!;
        const b = pts[pts.length - 1]!;
        let angle = -deg(Math.atan2(b.y - a.y, b.x - a.x));
        if (angle < 0) angle += 360;
        drawLabel(ctx, this.editor, b, `${fmtCm(dist(a, b))}  ${angle.toFixed(1)}°`);
      } else if (this.id === 'ngon') {
        drawLabel(ctx, this.editor, this.current, `r = ${fmtCm(dist(this.start, this.current))}`);
      } else {
        drawLabel(ctx, this.editor, this.current, `${fmtCm(obj.w)} × ${fmtCm(obj.h)}`);
      }
    }
  }
}

// ---------- Free polygon ----------

export class PolygonTool implements Tool {
  readonly id = 'polygon';
  readonly cursor = 'crosshair';
  private pts: Vec[] = [];
  private cursorPos: Vec | null = null;
  constructor(private editor: Editor) {}

  get active() {
    return this.pts.length > 0;
  }

  down(e: ToolEvent) {
    const first = this.pts[0];
    const closeTol = 10 / this.editor.camera.zoom;
    if (first && this.pts.length >= 3 && dist(first, e.world) < closeTol) {
      this.finish();
      return;
    }
    if (e.detail >= 2 && this.pts.length >= 3) {
      this.finish();
      return;
    }
    let p = e.world;
    const last = this.pts[this.pts.length - 1];
    if (last && e.shift) {
      const a = snapAngle(Math.atan2(p.y - last.y, p.x - last.x));
      const l = dist(last, p);
      p = vec(last.x + Math.cos(a) * l, last.y + Math.sin(a) * l);
    }
    if (!last || dist(last, p) > 2 / this.editor.camera.zoom) this.pts.push(p);
    this.editor.requestRender();
  }

  move(e: ToolEvent) {
    this.hover(e);
  }

  hover(e: ToolEvent) {
    this.cursorPos = e.world;
    if (this.active) this.editor.requestRender();
  }

  up() {}

  keyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.pts.length >= 3) {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' && this.pts.length > 0) {
      this.pts.pop();
      this.editor.requestRender();
      return true;
    }
    return false;
  }

  private finish() {
    const ed = this.editor;
    const s = ed.style;
    const obj: ShapeObj = {
      id: newId(),
      type: 'shape',
      shape: 'polygon',
      page: ed.page,
      rot: 0,
      z: ed.doc.nextZ(ed.page),
      color: s.color,
      width: Math.round((s.width / ed.camera.zoom) * 100) / 100,
      fill: s.fillEnabled ? s.fill : null,
      fillOpacity: s.fillOpacity,
      ...pathFromWorldPoints(this.pts),
    };
    ed.doc.put([obj]);
    this.cancel();
  }

  cancel() {
    this.pts = [];
    this.editor.requestRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.active) return;
    const z = this.editor.camera.zoom;
    ctx.save();
    ctx.strokeStyle = resolveColor(this.editor.style.color, this.editor.theme);
    ctx.lineWidth = this.editor.style.width / z;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (this.cursorPos) ctx.lineTo(this.cursorPos.x, this.cursorPos.y);
    ctx.stroke();
    ctx.fillStyle = THEMES[this.editor.theme].selection;
    const first = this.pts[0]!;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 5 / z, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (this.cursorPos) {
      const last = this.pts[this.pts.length - 1]!;
      drawLabel(ctx, this.editor, this.cursorPos, fmtCm(dist(last, this.cursorPos)));
    }
  }
}

// ---------- Arc, sector & compass ----------

export class ArcTool implements Tool {
  readonly cursor = 'crosshair';
  private center: Vec | null = null;
  private radius = 0;
  private a0 = 0;
  /** 'radius': dragging the radius; 'ready': radius set, waiting to sweep; 'sweep': drawing. */
  private phase: 'idle' | 'radius' | 'ready' | 'sweep' = 'idle';
  private sweep = 0;
  private lastAngle = 0;
  private pointer: Vec | null = null;
  private shift = false;
  constructor(
    private editor: Editor,
    readonly id: 'arc' | 'compass',
  ) {}

  get active() {
    return this.phase !== 'idle';
  }

  private angleOf(p: Vec) {
    return Math.atan2(p.y - this.center!.y, p.x - this.center!.x);
  }

  down(e: ToolEvent) {
    this.pointer = e.world;
    if (this.phase === 'idle' || (this.phase === 'ready' && e.alt)) {
      this.center = e.world;
      this.radius = 0;
      this.phase = 'radius';
    } else if (this.phase === 'ready') {
      this.phase = 'sweep';
      this.sweep = 0;
      const a = this.angleOf(e.world);
      // Start sweeping from the pencil leg position, following the pointer.
      let d = a - this.a0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.sweep = d;
      this.lastAngle = a;
    }
    this.editor.requestRender();
  }

  move(e: ToolEvent) {
    this.pointer = e.world;
    this.shift = e.shift;
    if (this.phase === 'radius' && this.center) {
      this.radius = dist(this.center, e.world);
      this.a0 = this.angleOf(e.world);
      if (e.shift) this.a0 = snapAngle(this.a0);
    } else if (this.phase === 'sweep' && this.center) {
      const a = this.angleOf(e.world);
      let d = a - this.lastAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.sweep = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, this.sweep + d));
      this.lastAngle = a;
    }
    this.editor.setDraft(this.build() ? { kind: 'object', obj: this.build()! } : null);
    this.editor.requestRender();
  }

  hover(e: ToolEvent) {
    this.pointer = e.world;
    if (this.active) this.editor.requestRender();
  }

  private effectiveSweep() {
    return this.shift ? snapAngle(this.sweep) : this.sweep;
  }

  private build(): ShapeObj | null {
    if (this.phase !== 'sweep' || !this.center || Math.abs(this.sweep) < 0.01) return null;
    const ed = this.editor;
    const s = ed.style;
    const sector = this.id === 'arc' && s.arcKind === 'sector';
    const r = this.radius;
    return {
      id: newId(),
      type: 'shape',
      shape: sector ? 'sector' : 'arc',
      page: ed.page,
      rot: 0,
      z: ed.doc.nextZ(ed.page),
      x: this.center.x - r,
      y: this.center.y - r,
      w: r * 2,
      h: r * 2,
      a0: this.a0,
      a1: this.a0 + this.effectiveSweep(),
      color: s.color,
      width: Math.round(((this.id === 'compass' ? s.penSize * 0.6 : s.width) / ed.camera.zoom) * 100) / 100,
      fill: sector && s.fillEnabled ? s.fill : null,
      fillOpacity: s.fillOpacity,
    };
  }

  up() {
    if (this.phase === 'radius') {
      this.phase = this.radius > 3 / this.editor.camera.zoom ? 'ready' : 'idle';
    } else if (this.phase === 'sweep') {
      const obj = this.build();
      if (obj) this.editor.doc.put([obj]);
      this.editor.setDraft(null);
      // Keep the radius so several arcs can be drawn from the same centre.
      this.phase = 'ready';
      this.a0 = this.a0 + this.effectiveSweep();
    }
    this.editor.requestRender();
  }

  keyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.active) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel() {
    this.phase = 'idle';
    this.center = null;
    this.editor.setDraft(null);
    this.editor.requestRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.center || this.phase === 'idle') return;
    const ed = this.editor;
    const z = ed.camera.zoom;
    const c = this.center;
    const ink = THEMES[ed.theme].ink;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 5 / z]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const obj = this.build();
    if (obj) ed.drawObjectPreview(ctx, obj);

    // Pencil leg position.
    const legAngle = this.phase === 'sweep' ? this.a0 + this.effectiveSweep() : this.a0;
    const tip = vec(c.x + Math.cos(legAngle) * this.radius, c.y + Math.sin(legAngle) * this.radius);
    if (this.id === 'compass') {
      // Two legs meeting at a hinge above the midpoint.
      const mid = vec((c.x + tip.x) / 2, (c.y + tip.y) / 2);
      const n = rotate(sub(tip, c), -Math.PI / 2);
      const l = Math.hypot(n.x, n.y) || 1;
      const hinge = add(mid, { x: (n.x / l) * this.radius * 0.6, y: (n.y / l) * this.radius * 0.6 });
      ctx.save();
      ctx.strokeStyle = '#7a8597';
      ctx.lineWidth = 5 / z;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(hinge.x, hinge.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.fillStyle = '#4a5468';
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, 7 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = THEMES[ed.theme].selection;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4 / z, 0, Math.PI * 2);
    ctx.arc(tip.x, tip.y, 4 / z, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const label =
      this.phase === 'sweep'
        ? `r = ${fmtCm(this.radius)}  ${Math.abs(deg(this.effectiveSweep())).toFixed(0)}°`
        : `r = ${fmtCm(this.radius)}`;
    drawLabel(ctx, ed, this.phase === 'ready' ? (this.pointer ?? tip) : tip, label);
  }
}

// ---------- Measure ----------

export class MeasureTool implements Tool {
  readonly id = 'measure';
  readonly cursor = 'crosshair';
  private pts: Vec[] = [];
  private dragging = false;
  private pointer: Vec | null = null;
  constructor(private editor: Editor) {}

  get active() {
    return this.dragging;
  }

  down(e: ToolEvent) {
    const p = this.editor.snapToObjects(e.world);
    const mode = this.editor.style.measureMode;
    if (mode === 'angle' && this.pts.length === 2) {
      this.pts.push(p);
      this.pts = [...this.pts.slice(0, 3)];
      this.dragging = false;
      this.editor.requestRender();
      return;
    }
    this.pts = [p, p];
    this.dragging = true;
  }

  move(e: ToolEvent) {
    const p = this.editor.snapToObjects(e.world);
    this.pointer = p;
    if (this.dragging) this.pts[1] = p;
    this.editor.requestRender();
  }

  hover(e: ToolEvent) {
    this.pointer = this.editor.snapToObjects(e.world);
    if (this.editor.style.measureMode === 'angle' && this.pts.length === 2) this.editor.requestRender();
  }

  up() {
    this.dragging = false;
    if (this.editor.style.measureMode === 'length' || this.pts.length !== 2) return;
    // Angle mode: the first drag sets vertex → first arm; then a click sets the second arm.
    if (dist(this.pts[0]!, this.pts[1]!) < 3 / this.editor.camera.zoom) this.pts = [];
  }

  cancel() {
    this.pts = [];
    this.dragging = false;
    this.editor.requestRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    const ed = this.editor;
    const z = ed.camera.zoom;
    const color = THEMES[ed.theme].selection;
    if (this.pts.length < 2) return;
    const [a, b] = this.pts as [Vec, Vec];
    const c = this.pts[2] ?? (ed.style.measureMode === 'angle' && !this.dragging ? this.pointer : null);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(a.x, a.y);
    if (c) ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b, ...(c ? [c] : [])]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 / z, 0, Math.PI * 2);
      ctx.fill();
    }
    if (c && ed.style.measureMode === 'angle') {
      const a1 = Math.atan2(b.y - a.y, b.x - a.x);
      const a2 = Math.atan2(c.y - a.y, c.x - a.x);
      let d = a2 - a1;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const r = Math.min(40 / z, dist(a, b) / 2, dist(a, c) / 2);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, a1, a1 + d, d < 0);
      ctx.stroke();
      ctx.restore();
      drawLabel(ctx, ed, a, `${Math.abs(deg(d)).toFixed(1)}°`);
      return;
    }
    ctx.restore();
    let angle = -deg(Math.atan2(b.y - a.y, b.x - a.x));
    if (angle < 0) angle += 360;
    drawLabel(ctx, ed, b, `${fmtCm(dist(a, b))}  ${angle.toFixed(1)}°`);
  }
}

// ---------- Text, math & graph placement ----------

export class TextTool implements Tool {
  readonly id = 'text';
  readonly cursor = 'text';
  constructor(private editor: Editor) {}
  down(e: ToolEvent) {
    const hit = this.editor.hitObject(e.world, (o) => o.type === 'text');
    this.editor.startTextEdit(hit && hit.type === 'text' ? hit : null, e.world);
  }
  move() {}
  up() {}
  cancel() {}
}

export class MathTool implements Tool {
  readonly id = 'math';
  readonly cursor = 'copy';
  constructor(private editor: Editor) {}
  down(e: ToolEvent) {
    const hit = this.editor.hitObject(e.world, (o) => o.type === 'math');
    this.editor.openMathDialog(hit && hit.type === 'math' ? hit : null, e.world);
  }
  move() {}
  up() {}
  cancel() {}
}

export class GraphTool implements Tool {
  readonly id = 'graph';
  readonly cursor = 'crosshair';
  private start: Vec | null = null;
  private current: Vec | null = null;
  constructor(private editor: Editor) {}
  get active() {
    return this.start !== null;
  }
  down(e: ToolEvent) {
    const hit = this.editor.hitObject(e.world, (o) => o.type === 'graph');
    if (hit && hit.type === 'graph') {
      this.editor.openGraphDialog(hit, null);
      return;
    }
    this.start = e.world;
    this.current = e.world;
  }
  move(e: ToolEvent) {
    if (!this.start) return;
    this.current = e.world;
    this.editor.requestRender();
  }
  up() {
    if (!this.start || !this.current) return;
    const z = this.editor.camera.zoom;
    let box = {
      x: Math.min(this.start.x, this.current.x),
      y: Math.min(this.start.y, this.current.y),
      w: Math.abs(this.current.x - this.start.x),
      h: Math.abs(this.current.y - this.start.y),
    };
    if (box.w < 40 / z || box.h < 40 / z) box = { x: this.start.x, y: this.start.y, w: 480 / z, h: 360 / z };
    this.start = null;
    this.current = null;
    this.editor.openGraphDialog(null, box);
    this.editor.requestRender();
  }
  cancel() {
    this.start = null;
    this.current = null;
  }
  drawOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.start || !this.current) return;
    const z = this.editor.camera.zoom;
    ctx.save();
    ctx.strokeStyle = THEMES[this.editor.theme].selection;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(this.start.x, this.start.y, this.current.x - this.start.x, this.current.y - this.start.y);
    ctx.restore();
  }
}

// ---------- Select ----------

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export interface Frame {
  c: Vec;
  w: number;
  h: number;
  rot: number;
}

const HANDLE_POS: Record<Exclude<Handle, 'rotate'>, Vec> = {
  nw: vec(-0.5, -0.5),
  n: vec(0, -0.5),
  ne: vec(0.5, -0.5),
  e: vec(0.5, 0),
  se: vec(0.5, 0.5),
  s: vec(0, 0.5),
  sw: vec(-0.5, 0.5),
  w: vec(-0.5, 0),
};

const KEEP_ASPECT = new Set(['text', 'math', 'image']);

export class SelectTool implements Tool {
  readonly id = 'select';
  readonly cursor = 'default';
  private mode: 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'lasso' = 'none';
  private start: Vec = vec(0, 0);
  private handle: Handle | null = null;
  private frame: Frame | null = null;
  private originals: BoardObject[] = [];
  private lasso: Vec[] = [];
  private current: Vec = vec(0, 0);
  private additive = false;
  constructor(private editor: Editor) {}

  get active() {
    return this.mode !== 'none';
  }

  /** Bounding frame of the selection: oriented for one object, axis-aligned for many. */
  frameOf(objs: BoardObject[]): Frame | null {
    if (objs.length === 0) return null;
    if (objs.length === 1) {
      const o = objs[0]!;
      return { c: center(o), w: o.w, h: o.h, rot: o.rot };
    }
    const b = objs.map(objectBounds).reduce((a, x) => ({
      minX: Math.min(a.minX, x.minX),
      minY: Math.min(a.minY, x.minY),
      maxX: Math.max(a.maxX, x.maxX),
      maxY: Math.max(a.maxY, x.maxY),
    }));
    return { c: vec((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), w: b.maxX - b.minX, h: b.maxY - b.minY, rot: 0 };
  }

  private handlePoint(f: Frame, h: Handle): Vec {
    const z = this.editor.camera.zoom;
    const local = h === 'rotate' ? vec(0, -f.h / 2 - 28 / z) : vec(HANDLE_POS[h].x * f.w, HANDLE_POS[h].y * f.h);
    return add(rotate(local, f.rot), f.c);
  }

  private hitHandle(f: Frame, p: Vec): Handle | null {
    const tol = 9 / this.editor.camera.zoom;
    const handles: Handle[] = ['rotate', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
    for (const h of handles) if (dist(this.handlePoint(f, h), p) <= tol) return h;
    return null;
  }

  down(e: ToolEvent) {
    const ed = this.editor;
    this.start = e.world;
    this.current = e.world;
    const selected = ed.selectedObjects();
    const frame = this.frameOf(selected);
    if (frame && ed.canEdit) {
      const h = this.hitHandle(frame, e.world);
      if (h) {
        this.mode = h === 'rotate' ? 'rotate' : 'resize';
        this.handle = h;
        this.frame = frame;
        this.originals = selected;
        return;
      }
    }
    const hit = ed.hitObject(e.world);
    if (hit) {
      if (e.detail >= 2 && ed.canEdit) {
        ed.editObject(hit);
        return;
      }
      if (e.shift) {
        const sel = new Set(ed.selection);
        if (sel.has(hit.id)) sel.delete(hit.id);
        else sel.add(hit.id);
        ed.select([...sel]);
      } else if (!ed.selection.includes(hit.id)) {
        ed.select([hit.id]);
      }
      if (ed.canEdit) {
        this.mode = 'move';
        this.originals = ed.selectedObjects();
      }
      return;
    }
    // Inside the frame of a multi-selection also moves.
    if (frame && ed.canEdit && selected.length > 1) {
      const local = rotate(sub(e.world, frame.c), -frame.rot);
      if (Math.abs(local.x) <= frame.w / 2 && Math.abs(local.y) <= frame.h / 2) {
        this.mode = 'move';
        this.originals = selected;
        return;
      }
    }
    this.additive = e.shift;
    if (!e.shift) ed.select([]);
    this.mode = ed.style.selectMode === 'lasso' || e.alt ? 'lasso' : 'marquee';
    this.lasso = [e.world];
  }

  move(e: ToolEvent) {
    const ed = this.editor;
    this.current = e.world;
    switch (this.mode) {
      case 'move': {
        let d = sub(e.world, this.start);
        if (e.shift) d = Math.abs(d.x) > Math.abs(d.y) ? vec(d.x, 0) : vec(0, d.y);
        ed.setPreview(this.originals.map((o) => ({ ...o, x: o.x + d.x, y: o.y + d.y })));
        break;
      }
      case 'rotate': {
        const f = this.frame!;
        let a = Math.atan2(e.world.y - f.c.y, e.world.x - f.c.x) - Math.atan2(this.start.y - f.c.y, this.start.x - f.c.x);
        if (e.shift) a = snapAngle(f.rot + a) - f.rot;
        ed.setPreview(
          this.originals.map((o) => {
            const c = rotateAround(center(o), f.c, a);
            return { ...o, x: c.x - o.w / 2, y: c.y - o.h / 2, rot: o.rot + a };
          }),
        );
        break;
      }
      case 'resize':
        ed.setPreview(this.resized(e));
        break;
      case 'marquee':
      case 'lasso':
        this.lasso.push(e.world);
        ed.requestRender();
        break;
    }
  }

  private resized(e: ToolEvent): BoardObject[] {
    const f = this.frame!;
    const h = this.handle as Exclude<Handle, 'rotate'>;
    const hp = HANDLE_POS[h];
    const anchor = vec(-hp.x * f.w, -hp.y * f.h);
    const p = rotate(sub(e.world, f.c), -f.rot);
    let sx = hp.x === 0 ? 1 : (p.x - anchor.x) / (2 * hp.x * f.w || 1e-9);
    let sy = hp.y === 0 ? 1 : (p.y - anchor.y) / (2 * hp.y * f.h || 1e-9);
    const keepAspect =
      e.shift !== (this.originals.length === 1 && KEEP_ASPECT.has(this.originals[0]!.type)) && hp.x !== 0 && hp.y !== 0;
    if (keepAspect) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = s * Math.sign(sx || 1);
      sy = s * Math.sign(sy || 1);
    }
    // Disallow flipping through zero; keep a minimum size.
    const minS = 0.02;
    sx = Math.max(minS, sx);
    sy = Math.max(minS, sy);
    const single = this.originals.length === 1;
    return this.originals.map((o) => {
      const lc = rotate(sub(center(o), f.c), -f.rot);
      const nc = vec(anchor.x + (lc.x - anchor.x) * sx, anchor.y + (lc.y - anchor.y) * sy);
      const wc = add(rotate(nc, f.rot), f.c);
      const aligned = single || Math.abs(o.rot - f.rot) < 1e-6;
      const ox = aligned ? sx : Math.sqrt(sx * sy);
      const oy = aligned ? sy : Math.sqrt(sx * sy);
      const w = o.w * ox;
      const hh = o.h * oy;
      const out = { ...o, w, h: hh, x: wc.x - w / 2, y: wc.y - hh / 2 } as BoardObject;
      if (out.type === 'text') out.fontSize = (o as typeof out).fontSize * Math.min(ox, oy);
      return out;
    });
  }

  up() {
    const ed = this.editor;
    switch (this.mode) {
      case 'move':
      case 'rotate':
      case 'resize':
        ed.commitPreview();
        break;
      case 'marquee':
      case 'lasso': {
        const objs = ed.doc.pageObjects(ed.page).filter((o) => !o.locked);
        let picked: BoardObject[];
        if (this.mode === 'marquee') {
          const box = boxFromPoints([this.start, this.current]);
          picked = objs.filter((o) => boxContains(box, objectBounds(o)));
        } else {
          const poly = this.lasso;
          picked =
            poly.length < 3
              ? []
              : objs.filter((o) => {
                  const pts = samplePoints(o);
                  const step = Math.max(1, Math.floor(pts.length / 64));
                  for (let i = 0; i < pts.length; i += step) if (!pointInPolygon(pts[i]!, poly)) return false;
                  return true;
                });
        }
        const ids = new Set(this.additive ? ed.selection : []);
        for (const o of picked) ids.add(o.id);
        ed.select([...ids]);
        break;
      }
    }
    this.mode = 'none';
    this.lasso = [];
    ed.requestRender();
  }

  cancel() {
    this.mode = 'none';
    this.lasso = [];
    this.editor.setPreview(null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    const ed = this.editor;
    const z = ed.camera.zoom;
    const color = THEMES[ed.theme].selection;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / z;
    if (this.mode === 'marquee') {
      ctx.fillStyle = 'rgba(47,111,237,0.08)';
      ctx.setLineDash([5 / z, 4 / z]);
      const b = boxFromPoints([this.start, this.current]);
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    } else if (this.mode === 'lasso') {
      ctx.fillStyle = 'rgba(47,111,237,0.08)';
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.beginPath();
      this.lasso.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    const objs = ed.selectedObjects();
    const f = this.frameOf(objs);
    if (!f) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / z;
    // Individual outlines when several objects are selected.
    if (objs.length > 1) {
      ctx.globalAlpha = 0.5;
      for (const o of objs) {
        const b = objectBounds(o);
        ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      }
      ctx.globalAlpha = 1;
    }
    ctx.translate(f.c.x, f.c.y);
    ctx.rotate(f.rot);
    const pad = 4 / z;
    ctx.strokeRect(-f.w / 2 - pad, -f.h / 2 - pad, f.w + pad * 2, f.h + pad * 2);
    if (ed.canEdit && this.mode === 'none' && !objs.some((o) => o.locked)) {
      ctx.fillStyle = '#fff';
      const s = 8 / z;
      for (const h of Object.keys(HANDLE_POS) as (keyof typeof HANDLE_POS)[]) {
        const p = HANDLE_POS[h];
        ctx.fillRect(p.x * f.w - s / 2, p.y * f.h - s / 2, s, s);
        ctx.strokeRect(p.x * f.w - s / 2, p.y * f.h - s / 2, s, s);
      }
      ctx.beginPath();
      ctx.moveTo(0, -f.h / 2 - pad);
      ctx.lineTo(0, -f.h / 2 - 28 / z);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -f.h / 2 - 28 / z, 5.5 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (this.mode === 'rotate' && objs.length) {
      let d = -deg(objs[0]!.rot) % 360;
      if (d < 0) d += 360;
      drawLabel(ctx, ed, this.current, `${d.toFixed(0)}°`);
    }
  }

  /** Cursor for the current hover position. */
  cursorAt(p: Vec): string {
    const f = this.frameOf(this.editor.selectedObjects());
    if (f && this.editor.canEdit) {
      const h = this.hitHandle(f, p);
      if (h === 'rotate') return 'grab';
      if (h) {
        const a = ((Math.atan2(HANDLE_POS[h].y, HANDLE_POS[h].x) + f.rot) * 180) / Math.PI;
        const n = (((Math.round(a / 45) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
        return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][n]!;
      }
    }
    return this.editor.hitObject(p) ? 'move' : 'default';
  }
}

