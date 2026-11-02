import { compileFn } from './assets';
import { niceStep } from './geometry';
import type { GraphObj } from './types';

const formatTick = (v: number, step: number) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const s = v.toFixed(decimals);
  return s === '-0' ? '0' : s;
};

/**
 * Draws a function graph in local coordinates (origin = top-left of the box).
 * `pixelsPerUnit` controls sampling density so curves stay smooth when zoomed.
 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  o: GraphObj,
  ink: string,
  gridColor: string,
  resolve: (c: string) => string,
  pixelsPerUnit: number,
) {
  const { w, h, xMin, xMax, yMin, yMax } = o;
  if (w <= 0 || h <= 0 || xMax <= xMin || yMax <= yMin) return;
  const toX = (x: number) => ((x - xMin) / (xMax - xMin)) * w;
  const toY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h;
  const fontSize = Math.max(10, Math.min(16, Math.min(w, h) / 22));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  const xStep = niceStep(xMax - xMin, Math.max(4, w / 70));
  const yStep = niceStep(yMax - yMin, Math.max(4, h / 70));

  if (o.grid) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      ctx.moveTo(toX(x), 0);
      ctx.lineTo(toX(x), h);
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      ctx.moveTo(0, toY(y));
      ctx.lineTo(w, toY(y));
    }
    ctx.stroke();
  }

  // Axes sit at 0 when visible, otherwise at the nearest edge.
  const axisX = Math.min(h, Math.max(0, toY(0)));
  const axisY = Math.min(w, Math.max(0, toX(0)));
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, axisX);
  ctx.lineTo(w, axisX);
  ctx.moveTo(axisY, 0);
  ctx.lineTo(axisY, h);
  ctx.stroke();
  // Arrowheads.
  const a = 7;
  ctx.beginPath();
  ctx.moveTo(w, axisX);
  ctx.lineTo(w - a, axisX - a / 2);
  ctx.lineTo(w - a, axisX + a / 2);
  ctx.moveTo(axisY, 0);
  ctx.lineTo(axisY - a / 2, a);
  ctx.lineTo(axisY + a / 2, a);
  ctx.fill();

  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax - xStep / 2; x += xStep) {
    if (Math.abs(x) < xStep / 2) continue;
    const px = toX(x);
    ctx.moveTo(px, axisX - 4);
    ctx.lineTo(px, axisX + 4);
    const below = axisX + 6 + fontSize < h;
    ctx.textBaseline = below ? 'top' : 'bottom';
    ctx.fillText(formatTick(x, xStep), px, below ? axisX + 6 : axisX - 6);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax - yStep / 2; y += yStep) {
    if (Math.abs(y) < yStep / 2) continue;
    const py = toY(y);
    ctx.moveTo(axisY - 4, py);
    ctx.lineTo(axisY + 4, py);
    const left = axisY - 6 - fontSize * 2 > 0;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.fillText(formatTick(y, yStep), left ? axisY - 6 : axisY + 6, py);
  }
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `italic ${fontSize}px serif`;
  ctx.fillText('x', w - fontSize, Math.min(h - fontSize - 2, axisX + fontSize + 6));
  ctx.fillText('y', Math.min(w - fontSize, axisY + 8), 2);

  // Curves: sample at screen resolution and break the path at gaps or jumps
  // (e.g. tan x, 1/x).
  const samples = Math.min(4000, Math.max(200, Math.ceil(w * pixelsPerUnit)));
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const fn of o.fns) {
    const f = compileFn(fn.expr);
    if (!f || typeof f !== 'function') continue;
    ctx.strokeStyle = resolve(fn.color);
    ctx.beginPath();
    let drawing = false;
    let prevY = 0;
    for (let i = 0; i <= samples; i++) {
      const x = xMin + ((xMax - xMin) * i) / samples;
      let y: number;
      try {
        y = f(x);
      } catch {
        y = Number.NaN;
      }
      const py = toY(y);
      if (!Number.isFinite(py) || Math.abs(py) > h * 50) {
        drawing = false;
        continue;
      }
      if (drawing && Math.abs(py - prevY) > h * 2) drawing = false;
      if (drawing) ctx.lineTo(toX(x), py);
      else ctx.moveTo(toX(x), py);
      drawing = true;
      prevY = py;
    }
    ctx.stroke();
  }
  ctx.restore();

  // Frame.
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);
}

/** First compile error among a graph's functions, for showing in the editor. */
export function graphError(o: Pick<GraphObj, 'fns'>): string | null {
  for (const fn of o.fns) {
    const f = compileFn(fn.expr);
    if (f && typeof f !== 'function') return f.error;
  }
  return null;
}
