import { isPathObject, type BoardObject, type ShapeObj, type Vec } from './types';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const rotate = (p: Vec, angle: number): Vec => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
export const rotateAround = (p: Vec, center: Vec, angle: number) => add(rotate(sub(p, center), angle), center);

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Closest point on segment ab to p. */
export function projectOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const boxFromPoints = (pts: Vec[]): Box => {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
};

export const unionBoxes = (boxes: Box[]): Box | null => {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
};

export const boxesIntersect = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boxContains = (outer: Box, inner: Box) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const center = (o: Pick<BoardObject, 'x' | 'y' | 'w' | 'h'>): Vec => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });

/** Local box coordinates ([0,w] × [0,h]) to world coordinates. */
export function localToWorld(o: BoardObject, p: Vec): Vec {
  const c = center(o);
  return add(rotate({ x: p.x - o.w / 2, y: p.y - o.h / 2 }, o.rot), c);
}

export function worldToLocal(o: BoardObject, p: Vec): Vec {
  const r = rotate(sub(p, center(o)), -o.rot);
  return { x: r.x + o.w / 2, y: r.y + o.h / 2 };
}

/** Scale from an object's natural path coordinates to its current box. */
export function pathScale(o: { w: number; h: number; nw?: number; nh?: number }): Vec {
  return {
    x: o.nw && o.nw > 1e-6 ? o.w / o.nw : 1,
    y: o.nh && o.nh > 1e-6 ? o.h / o.nh : 1,
  };
}

/** Path points scaled to the current box, in local coordinates. */
export function localPoints(o: BoardObject & { pts: number[] }): Vec[] {
  const s = pathScale(o);
  const out: Vec[] = [];
  for (let i = 0; i + 1 < o.pts.length; i += 2) out.push({ x: o.pts[i]! * s.x, y: o.pts[i + 1]! * s.y });
  return out;
}

const worldPointsCache = new WeakMap<BoardObject, Vec[]>();

export function worldPoints(o: BoardObject & { pts: number[] }): Vec[] {
  let pts = worldPointsCache.get(o);
  if (!pts) {
    pts = localPoints(o).map((p) => localToWorld(o, p));
    worldPointsCache.set(o, pts);
  }
  return pts;
}

export function corners(o: BoardObject): Vec[] {
  return [vec(0, 0), vec(o.w, 0), vec(o.w, o.h), vec(0, o.h)].map((p) => localToWorld(o, p));
}

/** Extra margin around an object's box for stroke width and arrowheads. */
function strokePad(o: BoardObject): number {
  if (o.type === 'stroke') return o.size;
  if (o.type === 'shape') return o.width / 2 + (o.arrowStart || o.arrowEnd ? o.width * 3 + 6 : 0);
  return 0;
}

const boundsCache = new WeakMap<BoardObject, Box>();

/** Axis-aligned world bounds. */
export function objectBounds(o: BoardObject): Box {
  let b = boundsCache.get(o);
  if (!b) {
    const pts = isPathObject(o) && o.pts.length > 0 ? worldPoints(o) : corners(o);
    b = boxFromPoints(pts.length ? pts : corners(o));
    const pad = strokePad(o);
    b = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    boundsCache.set(o, b);
  }
  return b;
}

/** Polygon points of a shape in local coordinates (for rect, polygon). */
function shapeOutline(o: ShapeObj): Vec[] {
  if (o.shape === 'rect') return [vec(0, 0), vec(o.w, 0), vec(o.w, o.h), vec(0, o.h)];
  return localPoints(o as ShapeObj & { pts: number[] });
}

function polylineDistance(p: Vec, pts: Vec[], closed: boolean): number {
  if (pts.length === 1) return dist(p, pts[0]!);
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i]!, pts[i + 1]!));
  if (closed && pts.length > 2) d = Math.min(d, distToSegment(p, pts[pts.length - 1]!, pts[0]!));
  return d;
}

/** Normalises an angle into [from, from + 2π). */
const normAngle = (a: number, from: number) => {
  const t = (a - from) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) + from;
};

/** Whether angle `a` lies on the sweep from a0 to a1 (either direction). */
export function angleInSweep(a: number, a0: number, a1: number): boolean {
  if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) return true;
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  return normAngle(a, lo) <= hi;
}

/** Hit test in world coordinates with a tolerance in world units. */
export function hitTest(o: BoardObject, p: Vec, tol: number): boolean {
  const b = objectBounds(o);
  if (p.x < b.minX - tol || p.x > b.maxX + tol || p.y < b.minY - tol || p.y > b.maxY + tol) return false;
  const lp = worldToLocal(o, p);
  switch (o.type) {
    case 'stroke':
      return polylineDistance(lp, localPoints(o), false) <= tol + o.size / 2;
    case 'shape': {
      const t = tol + o.width / 2;
      if (o.shape === 'line') return polylineDistance(lp, localPoints(o as ShapeObj & { pts: number[] }), false) <= t;
      if (o.shape === 'ellipse' || o.shape === 'arc' || o.shape === 'sector') {
        const rx = o.w / 2;
        const ry = o.h / 2;
        const d = { x: lp.x - rx, y: lp.y - ry };
        const r = Math.hypot(d.x / Math.max(rx, 1e-6), d.y / Math.max(ry, 1e-6));
        const edge = Math.abs(r - 1) * Math.min(rx, ry) <= t;
        if (o.shape === 'ellipse') return edge || (o.fill !== null && r <= 1);
        const angle = Math.atan2(d.y / Math.max(ry, 1e-6), d.x / Math.max(rx, 1e-6));
        const inSweep = angleInSweep(angle, o.a0 ?? 0, o.a1 ?? Math.PI * 2);
        if (inSweep && edge) return true;
        if (o.shape === 'sector') {
          if (inSweep && o.fill !== null && r <= 1) return true;
          const c = vec(rx, ry);
          const end = (a: number) => vec(rx + Math.cos(a) * rx, ry + Math.sin(a) * ry);
          return distToSegment(lp, c, end(o.a0 ?? 0)) <= t || distToSegment(lp, c, end(o.a1 ?? 0)) <= t;
        }
        return false;
      }
      const outline = shapeOutline(o);
      return polylineDistance(lp, outline, true) <= t || (o.fill !== null && pointInPolygon(lp, outline));
    }
    default:
      return lp.x >= -tol && lp.x <= o.w + tol && lp.y >= -tol && lp.y <= o.h + tol;
  }
}

/** Points used to decide whether a lasso encloses an object. */
export function samplePoints(o: BoardObject): Vec[] {
  if (isPathObject(o) && o.pts.length > 0) return worldPoints(o);
  return corners(o);
}

/** Nice tick step (1, 2, 5 × 10^n) for roughly `target` ticks over a range. */
export function niceStep(range: number, target = 8): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/** Recomputes the box of a path from world points; returns geometry fields. */
export function pathFromWorldPoints(world: Vec[]): { x: number; y: number; w: number; h: number; pts: number[]; nw: number; nh: number } {
  const b = boxFromPoints(world);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const pts: number[] = [];
  for (const p of world) pts.push(round2(p.x - b.minX), round2(p.y - b.minY));
  return { x: b.minX, y: b.minY, w, h, pts, nw: w, nh: h };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export type ShapeGeometry = Pick<ShapeObj, 'x' | 'y' | 'w' | 'h' | 'pts' | 'nw' | 'nh'>;
