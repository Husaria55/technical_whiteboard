import { getMath, mathResolution } from './assets';
import type { TextObj } from './types';

export const TEXT_FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
export const LINE_HEIGHT = 1.35;

export interface Segment {
  kind: 'text' | 'math';
  value: string;
}

/** Splits a line into plain text and `$...$` math segments. `\$` is a literal dollar. */
export function parseSegments(line: string): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  let math = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '\\' && line[i + 1] === '$') {
      buf += math ? '\\$' : '$';
      i++;
    } else if (c === '$') {
      if (buf) out.push({ kind: math ? 'math' : 'text', value: buf });
      buf = '';
      math = !math;
    } else {
      buf += c;
    }
  }
  // An unclosed `$` is shown literally.
  if (buf || math) out.push({ kind: 'text', value: math ? `$${buf}` : buf });
  return out.reduce<Segment[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.kind === 'text' && s.kind === 'text') last.value += s.value;
    else acc.push({ ...s });
    return acc;
  }, []);
}

export const fontFor = (o: Pick<TextObj, 'fontSize' | 'bold' | 'italic'>) =>
  `${o.italic ? 'italic ' : ''}${o.bold ? '700' : '400'} ${o.fontSize}px ${TEXT_FONT}`;

interface LaidOutSegment extends Segment {
  x: number;
  width: number;
}

interface LaidOutLine {
  segments: LaidOutSegment[];
  /** Baseline y relative to the line top. */
  baseline: number;
  height: number;
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  width: number;
  height: number;
  /** False while some math is still loading (sizes are estimates). */
  complete: boolean;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const measure = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

/** Lays out a text object (multi-line, with inline math). */
export function layoutText(o: Pick<TextObj, 'text' | 'fontSize' | 'bold' | 'italic' | 'color'>, color: string): TextLayout {
  const ctx = measure();
  ctx.font = fontFor(o);
  const fs = o.fontSize;
  let complete = true;
  const lines: LaidOutLine[] = o.text.split('\n').map((line) => {
    let x = 0;
    let ascent = fs * 0.8;
    let descent = fs * 0.25;
    const segments = parseSegments(line).map((s) => {
      let width: number;
      if (s.kind === 'math') {
        const m = getMath(s.value, color, false);
        if (m) {
          width = m.width * fs;
          ascent = Math.max(ascent, (m.height - m.depth) * fs);
          descent = Math.max(descent, m.depth * fs);
        } else {
          complete = false;
          width = ctx.measureText(s.value).width;
        }
      } else {
        width = ctx.measureText(s.value).width;
      }
      const seg = { ...s, x, width };
      x += width;
      return seg;
    });
    const height = Math.max(fs * LINE_HEIGHT, ascent + descent + fs * 0.1);
    const extra = (height - ascent - descent) / 2;
    return { segments, baseline: extra + ascent, height, width: x };
  });
  return {
    lines,
    width: Math.max(fs * 0.5, ...lines.map((l) => l.width)),
    height: lines.reduce((h, l) => h + l.height, 0),
    complete,
  };
}

/** Draws text in local coordinates (origin = top-left of the box). */
export function drawText(ctx: CanvasRenderingContext2D, o: TextObj, color: string, pixelsPerUnit: number) {
  const layout = layoutText(o, color);
  // Scale the natural layout into the object's box (resizing scales text).
  const sx = layout.width > 0 ? o.w / layout.width : 1;
  const sy = layout.height > 0 ? o.h / layout.height : 1;
  const s = Math.min(sx, sy) || 1;
  ctx.save();
  ctx.scale(s, s);
  ctx.font = fontFor(o);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const res = mathResolution((pixelsPerUnit * s * o.fontSize) / 40);
  let y = 0;
  for (const line of layout.lines) {
    for (const seg of line.segments) {
      if (seg.kind === 'math') {
        const m = getMath(seg.value, color, false, res);
        const img = m?.img ?? getMath(seg.value, color, false)?.img;
        if (m && img) {
          const h = m.height * o.fontSize;
          ctx.drawImage(img, seg.x, y + line.baseline - h + m.depth * o.fontSize, seg.width, h);
        } else {
          ctx.globalAlpha = 0.5;
          ctx.fillText(seg.value, seg.x, y + line.baseline);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillText(seg.value, seg.x, y + line.baseline);
      }
    }
    y += line.height;
  }
  ctx.restore();
}
