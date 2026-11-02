// Lazily loaded: MathJax is large. Converts LaTeX to standalone SVG strings.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const document = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages.filter((p: string) => p !== 'bussproofs') }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

/** MathJax sizes in ex; with em = 1 an ex is about half an em. */
const EX_PER_EM = 0.5;

export interface SvgResult {
  svg: string;
  /** Size in px when the font size is `fontPx`. */
  width: number;
  height: number;
  depth: number;
  error?: string;
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderSvg(latex: string, display: boolean, color: string, fontPx: number): SvgResult {
  const node = document.convert(latex || '\\square', { display, em: 16, ex: 8, containerWidth: 80 * 16 });
  let svg = adaptor.innerHTML(node);
  const error = /data-mjx-error="([^"]*)"/.exec(svg)?.[1];
  const ex = (attr: string) => Number.parseFloat(new RegExp(`${attr}="(-?[\\d.]+)ex"`).exec(svg)?.[1] ?? '0');
  const exWidth = ex('width');
  const exHeight = ex('height');
  const valign = Number.parseFloat(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1] ?? '0');
  const px = fontPx * EX_PER_EM;
  const width = exWidth * px;
  const height = exHeight * px;
  svg = svg
    .replace(/width="[\d.]+ex"/, `width="${width}"`)
    .replace(/height="[\d.]+ex"/, `height="${height}"`)
    .replace(/currentColor/g, escapeXml(color));
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return { svg, width, height, depth: -valign * px, error };
}
