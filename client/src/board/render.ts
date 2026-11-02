import { getStroke } from 'perfect-freehand';
import { getImage, getMath, imageFailed, mathResolution } from './assets';
import { drawGraph } from './graph';
import { localPoints, center } from './geometry';
import { drawText } from './text';
import { THEMES, resolveColor } from './theme';
import { UNITS_PER_CM, type Background, type BoardObject, type ShapeObj, type StrokeObj, type Theme, type Vec } from './types';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderEnv {
  theme: Theme;
  /** Device pixels per world unit (zoom × devicePixelRatio). */
  pixelsPerUnit: number;
}

export const STROKE_OPTIONS = {
  thinning: 0.55,
  smoothing: 0.55,
  streamline: 0.45,
};

// ---------- Background ----------

/** Draws the page background pattern for the visible world rectangle. */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: Background,
  theme: Theme,
  view: { minX: number; minY: number; maxX: number; maxY: number },
  zoom: number,
) {
  const colors = THEMES[theme];
  ctx.fillStyle = colors.background;
  ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  if (background === 'blank') return;

  const lineWidth = 1 / zoom;
  const drawLines = (step: number, color: string, vertical: boolean, horizontal: boolean) => {
    // Skip patterns too dense to see.
    if (step * zoom < 6) return;
    ctx.beginPath();
    if (vertical) {
      for (let x = Math.floor(view.minX / step) * step; x <= view.maxX; x += step) {
        ctx.moveTo(x, view.minY);
        ctx.lineTo(x, view.maxY);
      }
    }
    if (horizontal) {
      for (let y = Math.floor(view.minY / step) * step; y <= view.maxY; y += step) {
        ctx.moveTo(view.minX, y);
        ctx.lineTo(view.maxX, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  };

  switch (background) {
    case 'grid':
      drawLines(UNITS_PER_CM, colors.gridMinor, true, true);
      if (UNITS_PER_CM * zoom < 6) drawLines(UNITS_PER_CM * 5, colors.gridMinor, true, true);
      break;
    case 'lines':
      drawLines(UNITS_PER_CM, colors.gridMajor, false, true);
      break;
    case 'graph':
      drawLines(UNITS_PER_CM / 10, colors.gridMinor, true, true);
      drawLines(UNITS_PER_CM / 2, colors.gridMinor, true, true);
      drawLines(UNITS_PER_CM, colors.gridMajor, true, true);
      if (UNITS_PER_CM * zoom < 6) drawLines(UNITS_PER_CM * 10, colors.gridMajor, true, true);
      break;
    case 'dots': {
      let step = UNITS_PER_CM;
      while (step * zoom < 10) step *= 5;
      const r = Math.max(1.2 / zoom, step * 0.03);
      ctx.fillStyle = colors.gridMajor;
      ctx.beginPath();
      for (let x = Math.floor(view.minX / step) * step; x <= view.maxX; x += step) {
        for (let y = Math.floor(view.minY / step) * step; y <= view.maxY; y += step) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      break;
    }
  }
}

// ---------- Strokes ----------

const strokePaths = new WeakMap<StrokeObj, Path2D>();

/** Outline polygon of a pen stroke, computed with perfect-freehand. */
export function strokeOutline(points: Vec[], pressures: number[], size: number, last: boolean): Path2D {
  const input = points.map((p, i) => [p.x, p.y, pressures[i] ?? 0.5]);
  const outline = getStroke(input, {
    size,
    ...STROKE_OPTIONS,
    simulatePressure: pressures.length === 0,
    last,
  });
  const path = new Path2D();
  if (outline.length === 0) return path;
  path.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]!;
    const [x1, y1] = outline[i]!;
    // Quadratic curves through midpoints give a smooth outline.
    path.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
  }
  path.closePath();
  return path;
}

function drawStroke(ctx: CanvasRenderingContext2D, o: StrokeObj, color: string) {
  const pts = localPoints(o);
  if (o.highlighter) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.lineWidth = o.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (pts.length === 1) ctx.lineTo(pts[0]!.x + 0.01, pts[0]!.y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  let path = strokePaths.get(o);
  if (!path) {
    path = strokeOutline(pts, o.pr, o.size, true);
    strokePaths.set(o, path);
  }
  ctx.fillStyle = color;
  ctx.fill(path);
}

/** Draws an in-progress highlighter or pen stroke given world points. */
export function drawDraftStroke(
  ctx: CanvasRenderingContext2D,
  points: Vec[],
  pressures: number[],
  size: number,
  color: string,
  highlighter: boolean,
) {
  if (points.length === 0) return;
  if (highlighter) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (points.length === 1) ctx.lineTo(points[0]!.x + 0.01, points[0]!.y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.fill(strokeOutline(points, pressures, size, false));
}

// ---------- Shapes ----------

function arrowHead(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(10, width * 4);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4));
  ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function shapePath(o: ShapeObj): { path: Path2D; closed: boolean; pts: Vec[] } {
  const path = new Path2D();
  const rx = o.w / 2;
  const ry = o.h / 2;
  switch (o.shape) {
    case 'rect':
      path.rect(0, 0, o.w, o.h);
      return { path, closed: true, pts: [] };
    case 'ellipse':
      path.ellipse(rx, ry, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2);
      return { path, closed: true, pts: [] };
    case 'arc':
    case 'sector': {
      const a0 = o.a0 ?? 0;
      const a1 = o.a1 ?? Math.PI * 2;
      if (o.shape === 'sector') path.moveTo(rx, ry);
      path.ellipse(rx, ry, Math.max(rx, 0), Math.max(ry, 0), 0, a0, a1, a1 < a0);
      if (o.shape === 'sector') path.closePath();
      return { path, closed: o.shape === 'sector', pts: [] };
    }
    default: {
      const pts = localPoints(o as ShapeObj & { pts: number[] });
      pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
      const closed = o.shape === 'polygon';
      if (closed) path.closePath();
      return { path, closed, pts };
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj, theme: Theme) {
  const { path, pts } = shapePath(o);
  const color = resolveColor(o.color, theme);
  if (o.fill !== null && o.shape !== 'line' && o.shape !== 'arc') {
    ctx.save();
    ctx.globalAlpha = o.fillOpacity;
    ctx.fillStyle = resolveColor(o.fill, theme);
    ctx.fill(path);
    ctx.restore();
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = o.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (o.width > 0) ctx.stroke(path);
  if (o.shape === 'line' && pts.length >= 2) {
    if (o.arrowEnd) arrowHead(ctx, pts[pts.length - 2]!, pts[pts.length - 1]!, o.width);
    if (o.arrowStart) arrowHead(ctx, pts[1]!, pts[0]!, o.width);
  }
}

// ---------- Objects ----------

export function drawObject(ctx: CanvasRenderingContext2D, o: BoardObject, env: RenderEnv) {
  const c = center(o);
  ctx.save();
  ctx.translate(c.x, c.y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.translate(-o.w / 2, -o.h / 2);
  const color = 'color' in o ? resolveColor(o.color, env.theme) : THEMES[env.theme].ink;
  switch (o.type) {
    case 'stroke':
      drawStroke(ctx, o, color);
      break;
    case 'shape':
      drawShape(ctx, o, env.theme);
      break;
    case 'text':
      drawText(ctx, o, color, env.pixelsPerUnit);
      break;
    case 'math': {
      const base = getMath(o.latex, color, true);
      const res = base ? mathResolution((env.pixelsPerUnit * o.h) / Math.max(base.height * 40, 1)) : 1;
      // Fall back to the low-resolution image while a sharper one loads.
      const m = res > 1 ? getMath(o.latex, color, true, res) : base;
      const img = m?.img ?? base?.img;
      if (img) {
        ctx.drawImage(img, 0, 0, o.w, o.h);
      } else {
        placeholder(ctx, o.w, o.h, color, base?.error ? 'LaTeX error' : '…');
      }
      break;
    }
    case 'graph':
      drawGraph(ctx, o, THEMES[env.theme].ink, THEMES[env.theme].gridMajor, (col) => resolveColor(col, env.theme), env.pixelsPerUnit);
      break;
    case 'image': {
      const img = getImage(o.src);
      if (img) ctx.drawImage(img, 0, 0, o.w, o.h);
      else placeholder(ctx, o.w, o.h, color, imageFailed(o.src) ? 'Image unavailable' : 'Loading…');
      break;
    }
  }
  ctx.restore();
}

function placeholder(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, label: string) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = `${Math.max(10, Math.min(18, h / 3))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  ctx.restore();
}

/** Math objects store a box sized from the rendered formula at this font size. */
export const MATH_FONT_SIZE = 32;

/** Natural size of a math object, or null while MathJax loads. */
export function mathSize(latex: string, scale = 1): { w: number; h: number; error?: string } | null {
  const m = getMath(latex, '#000', true);
  if (!m) return null;
  return { w: m.width * MATH_FONT_SIZE * scale, h: m.height * MATH_FONT_SIZE * scale, error: m.error };
}
