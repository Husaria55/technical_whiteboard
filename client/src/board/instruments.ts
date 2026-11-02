import { add, dist, distToSegment, pointInPolygon, projectOnSegment, rotate, sub, vec } from './geometry';
import { UNITS_PER_CM, type Vec } from './types';

export type InstrumentKind = 'ruler' | 'protractor' | 'square45' | 'square60';

/**
 * A geometry instrument lying on the board. Instruments are per-user tools:
 * they are not part of the document but are shared live with other users
 * through awareness, so a student sees the teacher's ruler.
 */
export interface Instrument {
  kind: InstrumentKind;
  /** World position of the instrument's pivot (ruler: zero mark, protractor: centre, squares: right angle). */
  x: number;
  y: number;
  /** Rotation in radians. */
  angle: number;
  /** Protractor measuring needle, in degrees (0–180). */
  needle?: number;
}

export const INSTRUMENT_LABELS: Record<InstrumentKind, string> = {
  ruler: 'Ruler',
  protractor: 'Protractor',
  square45: 'Set square 45°',
  square60: 'Set square 30°/60°',
};

const RULER_CM = 20;
const RULER_MARGIN = 12;
const RULER_LENGTH = RULER_CM * UNITS_PER_CM + RULER_MARGIN * 2;
const RULER_WIDTH = 72;
const PROTRACTOR_R = 6 * UNITS_PER_CM;
const SQUARE_LEG = 12 * UNITS_PER_CM;

/** Body polygon in local coordinates (pivot at origin, y down). */
function localPolygon(kind: InstrumentKind): Vec[] {
  switch (kind) {
    case 'ruler':
      return [vec(-RULER_MARGIN, 0), vec(RULER_LENGTH - RULER_MARGIN, 0), vec(RULER_LENGTH - RULER_MARGIN, RULER_WIDTH), vec(-RULER_MARGIN, RULER_WIDTH)];
    case 'protractor': {
      const pts: Vec[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (Math.PI * i) / 64;
        pts.push(vec(Math.cos(a) * PROTRACTOR_R, -Math.sin(a) * PROTRACTOR_R));
      }
      return pts;
    }
    case 'square45':
      return [vec(0, 0), vec(SQUARE_LEG, 0), vec(0, -SQUARE_LEG)];
    case 'square60':
      return [vec(0, 0), vec(SQUARE_LEG, 0), vec(0, -SQUARE_LEG / Math.sqrt(3))];
  }
}

/** Straight edges that drawing can snap to, in local coordinates. */
function localEdges(kind: InstrumentKind): [Vec, Vec][] {
  const poly = localPolygon(kind);
  switch (kind) {
    case 'ruler':
      return [
        [poly[0]!, poly[1]!],
        [poly[3]!, poly[2]!],
      ];
    case 'protractor':
      return [[vec(-PROTRACTOR_R, 0), vec(PROTRACTOR_R, 0)]];
    default:
      return [
        [poly[0]!, poly[1]!],
        [poly[1]!, poly[2]!],
        [poly[2]!, poly[0]!],
      ];
  }
}

export const toWorld = (inst: Instrument, p: Vec) => add(rotate(p, inst.angle), vec(inst.x, inst.y));
export const toLocal = (inst: Instrument, p: Vec) => rotate(sub(p, vec(inst.x, inst.y)), -inst.angle);

export const instrumentPolygon = (inst: Instrument) => localPolygon(inst.kind).map((p) => toWorld(inst, p));
export const instrumentEdges = (inst: Instrument) =>
  localEdges(inst.kind).map(([a, b]) => [toWorld(inst, a), toWorld(inst, b)] as [Vec, Vec]);

/** Local position of the rotate handle; `zoom` keeps it a fixed distance on screen. */
function rotateHandle(kind: InstrumentKind, zoom: number): Vec {
  const off = 28 / zoom;
  switch (kind) {
    case 'ruler':
      return vec(RULER_LENGTH - RULER_MARGIN + off, RULER_WIDTH / 2);
    case 'protractor':
      return vec(PROTRACTOR_R + off, -off * 0.4);
    default:
      return vec(SQUARE_LEG + off, 0);
  }
}

function needleHandle(inst: Instrument): Vec {
  const a = ((inst.needle ?? 60) * Math.PI) / 180;
  return vec(Math.cos(a) * PROTRACTOR_R * 0.8, -Math.sin(a) * PROTRACTOR_R * 0.8);
}

export type InstrumentHit = 'rotate' | 'needle' | 'body';

export function hitInstrument(inst: Instrument, p: Vec, zoom: number): InstrumentHit | null {
  const local = toLocal(inst, p);
  const r = 14 / zoom;
  if (dist(local, rotateHandle(inst.kind, zoom)) <= r) return 'rotate';
  if (inst.kind === 'protractor' && dist(local, needleHandle(inst)) <= r) return 'needle';
  if (pointInPolygon(local, localPolygon(inst.kind))) return 'body';
  return null;
}

export interface EdgeSnap {
  a: Vec;
  b: Vec;
}

/** Finds an instrument edge within `tol` of p (for drawing along a ruler). */
export function findEdge(instruments: Instrument[], p: Vec, tol: number): EdgeSnap | null {
  let best: EdgeSnap | null = null;
  let bestD = tol;
  for (const inst of instruments) {
    for (const [a, b] of instrumentEdges(inst)) {
      const d = distToSegment(p, a, b);
      if (d <= bestD) {
        bestD = d;
        best = { a, b };
      }
    }
  }
  return best;
}

export const snapToEdge = (edge: EdgeSnap, p: Vec) => projectOnSegment(p, edge.a, edge.b);

export function createInstrument(kind: InstrumentKind, at: Vec): Instrument {
  const offset: Record<InstrumentKind, Vec> = {
    ruler: vec(-RULER_LENGTH / 2, -RULER_WIDTH / 2),
    protractor: vec(0, PROTRACTOR_R / 2),
    square45: vec(-SQUARE_LEG / 3, SQUARE_LEG / 3),
    square60: vec(-SQUARE_LEG / 3, SQUARE_LEG / 6),
  };
  return { kind, x: at.x + offset[kind].x, y: at.y + offset[kind].y, angle: 0, needle: kind === 'protractor' ? 60 : undefined };
}

/** Angle of the instrument in degrees, normalised to (-180, 180]. */
export const angleDegrees = (inst: Instrument) => {
  let d = (-inst.angle * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

// ---------- Drawing ----------

interface DrawStyle {
  ink: string;
  accent: string;
  zoom: number;
  remote?: boolean;
  label?: string;
}

export function drawInstrument(ctx: CanvasRenderingContext2D, inst: Instrument, style: DrawStyle) {
  const { ink, zoom } = style;
  const px = 1 / zoom;
  ctx.save();
  ctx.translate(inst.x, inst.y);
  ctx.rotate(inst.angle);
  if (style.remote) ctx.globalAlpha = 0.55;

  const poly = localPolygon(inst.kind);
  ctx.beginPath();
  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(160, 200, 255, 0.22)';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5 * px;
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = px;
  const fontSize = Math.max(9 * px, Math.min(14, 11 * px));
  ctx.font = `${fontSize}px system-ui, sans-serif`;

  switch (inst.kind) {
    case 'ruler': {
      ctx.beginPath();
      const step = UNITS_PER_CM / 10;
      for (let i = 0; i <= RULER_CM * 10; i++) {
        const x = i * step;
        const h = i % 10 === 0 ? 18 : i % 5 === 0 ? 12 : 7;
        if (i % 10 !== 0 && step * zoom < 2.5) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.moveTo(x, RULER_WIDTH);
        ctx.lineTo(x, RULER_WIDTH - h * 0.6);
      }
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let cm = 0; cm <= RULER_CM; cm++) ctx.fillText(String(cm), cm * UNITS_PER_CM, 21);
      ctx.textAlign = 'left';
      ctx.fillText('cm', 4, RULER_WIDTH - 28);
      break;
    }
    case 'protractor': {
      const R = PROTRACTOR_R;
      ctx.beginPath();
      for (let d = 0; d <= 180; d++) {
        const a = (d * Math.PI) / 180;
        const len = d % 10 === 0 ? 16 : d % 5 === 0 ? 11 : 6;
        const c = Math.cos(a);
        const s = -Math.sin(a);
        ctx.moveTo(c * R, s * R);
        ctx.lineTo(c * (R - len), s * (R - len));
      }
      // Centre cross.
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -8);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d <= 180; d += 10) {
        const a = (d * Math.PI) / 180;
        ctx.fillText(String(d), Math.cos(a) * (R - 26), -Math.sin(a) * (R - 26));
        ctx.save();
        ctx.globalAlpha *= 0.6;
        ctx.fillText(String(180 - d), Math.cos(a) * (R - 42), -Math.sin(a) * (R - 42));
        ctx.restore();
      }
      // Measuring needle.
      const needle = inst.needle ?? 60;
      const na = (needle * Math.PI) / 180;
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(na) * R, -Math.sin(na) * R);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.25, 0, -na, true);
      ctx.stroke();
      const h = needleHandle(inst);
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 7 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${fontSize * 1.3}px system-ui, sans-serif`;
      ctx.fillText(`${needle.toFixed(0)}°`, Math.cos(na / 2) * R * 0.38, -Math.sin(na / 2) * R * 0.38);
      break;
    }
    case 'square45':
    case 'square60': {
      // Centimetre scale along the bottom leg.
      ctx.beginPath();
      for (let i = 0; i <= (SQUARE_LEG / UNITS_PER_CM) * 10; i++) {
        if (i % 10 !== 0 && UNITS_PER_CM * zoom < 25) continue;
        const x = (i * UNITS_PER_CM) / 10;
        const h = i % 10 === 0 ? 14 : i % 5 === 0 ? 9 : 5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, -h);
      }
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let cm = 1; cm < SQUARE_LEG / UNITS_PER_CM; cm++) ctx.fillText(String(cm), cm * UNITS_PER_CM, -16);
      const [, b, c] = poly as [Vec, Vec, Vec];
      ctx.font = `bold ${fontSize * 1.2}px system-ui, sans-serif`;
      const top = inst.kind === 'square45' ? '45°' : '60°';
      const right = inst.kind === 'square45' ? '45°' : '30°';
      ctx.fillText(right, b.x - 56, -8);
      ctx.textAlign = 'left';
      ctx.fillText(top, 10, c.y + 46);
      ctx.fillText('90°', 10, -30);
      break;
    }
  }

  if (!style.remote) {
    const h = rotateHandle(inst.kind, zoom);
    ctx.fillStyle = style.accent;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 9 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 4.5 * px, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.stroke();
  }
  ctx.restore();

  if (style.label) {
    ctx.save();
    ctx.fillStyle = style.accent;
    ctx.font = `${12 * px}px system-ui, sans-serif`;
    ctx.fillText(style.label, inst.x + 6 * px, inst.y - 8 * px);
    ctx.restore();
  }
}
