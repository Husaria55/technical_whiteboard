/**
 * Asynchronously loaded resources used by the renderer: uploaded images,
 * typeset math (MathJax → SVG images) and the expression parser (math.js).
 * Everything is cached; when something finishes loading, listeners are told
 * to redraw.
 */

type MathJaxModule = typeof import('./mathjax');
type MathJsModule = typeof import('mathjs');

const listeners = new Set<() => void>();
const pending = new Set<Promise<unknown>>();

export function onAssetLoaded(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => listeners.forEach((fn) => fn());

function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  p.finally(() => {
    pending.delete(p);
    notify();
  }).catch(() => {});
  return p;
}

/** Resolves once everything currently loading has finished (used before export). */
export async function assetsSettled() {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

// ---------- Images ----------

const images = new Map<string, HTMLImageElement>();

export function getImage(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    const el = img;
    track(
      new Promise<void>((resolve) => {
        el.onload = () => resolve();
        el.onerror = () => resolve();
      }),
    );
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function imageFailed(src: string): boolean {
  const img = images.get(src);
  return !!img && img.complete && img.naturalWidth === 0;
}

// ---------- Math ----------

let mathjax: MathJaxModule | null = null;
let mathjaxLoading: Promise<MathJaxModule> | null = null;

export function loadMathJax(): Promise<MathJaxModule> {
  if (!mathjaxLoading) {
    mathjaxLoading = track(import('./mathjax').then((m) => (mathjax = m)));
  }
  return mathjaxLoading;
}

export interface MathImage {
  img: HTMLImageElement | null;
  /** Natural size in px for font size 1 (multiply by font size). */
  width: number;
  height: number;
  /** Distance from the bottom to the baseline, for font size 1. */
  depth: number;
  error?: string;
}

const mathCache = new Map<string, MathImage>();

/**
 * Returns typeset math as an image, or null while MathJax loads.
 * `resolution` is the rasterisation scale bucket so math stays crisp when zoomed.
 */
export function getMath(latex: string, color: string, display: boolean, resolution = 1): MathImage | null {
  if (!mathjax) {
    void loadMathJax();
    return null;
  }
  const key = `${display ? 'D' : 'I'}|${color}|${resolution}|${latex}`;
  let entry = mathCache.get(key);
  if (!entry) {
    const result = mathjax.renderSvg(latex, display, color, resolution * 40);
    entry = { img: null, width: result.width / 40, height: result.height / 40, depth: result.depth / 40, error: result.error };
    const img = new Image();
    const e = entry;
    track(
      new Promise<void>((resolve) => {
        img.onload = () => {
          e.img = img;
          resolve();
        };
        img.onerror = () => resolve();
      }),
    );
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
    mathCache.set(key, entry);
  }
  return entry;
}

/** Picks a power-of-two rasterisation scale for the current zoom. */
export const mathResolution = (pixelsPerUnit: number) =>
  Math.min(16, 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, pixelsPerUnit)))));

// ---------- Expressions (graphs) ----------

let mathjs: MathJsModule | null = null;
let mathjsLoading: Promise<MathJsModule> | null = null;

export function loadMathJs(): Promise<MathJsModule> {
  if (!mathjsLoading) mathjsLoading = track(import('mathjs').then((m) => (mathjs = m)));
  return mathjsLoading;
}

export type CompiledFn = ((x: number) => number) | { error: string };
const compiled = new Map<string, CompiledFn>();

/** Normalises user input like "y = x^2" or "f(x) = sin x" to an expression of x. */
export function normalizeExpr(expr: string): string {
  return expr.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, '').trim();
}

export function compileFn(expr: string): CompiledFn | null {
  if (!mathjs) {
    void loadMathJs();
    return null;
  }
  let fn = compiled.get(expr);
  if (!fn) {
    try {
      const code = mathjs.compile(normalizeExpr(expr));
      const scope = { x: 0 };
      fn = (x: number) => {
        scope.x = x;
        const v = code.evaluate(scope);
        return typeof v === 'number' ? v : Number.NaN;
      };
      fn(0.5);
    } catch (err) {
      fn = { error: err instanceof Error ? err.message : String(err) };
    }
    compiled.set(expr, fn);
  }
  return fn;
}
