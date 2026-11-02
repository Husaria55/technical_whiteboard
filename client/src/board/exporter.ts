import { jsPDF } from 'jspdf';
import { assetsSettled } from './assets';
import type { BoardDoc } from './doc';
import { contentBounds, renderPageRegion } from './pageRender';
import type { Box } from './geometry';
import type { Theme } from './types';

const PADDING = 40;
/** Export resolution multiplier (pixels per world unit). */
const SCALE = 2;
const MAX_SIDE = 8000;

function exportBox(doc: BoardDoc, page: string): Box {
  const b = contentBounds(doc, page) ?? { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  return { minX: b.minX - PADDING, minY: b.minY - PADDING, maxX: b.maxX + PADDING, maxY: b.maxY + PADDING };
}

async function renderPage(doc: BoardDoc, page: string, theme: Theme): Promise<HTMLCanvasElement> {
  const box = exportBox(doc, page);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const scale = Math.min(SCALE, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  // Render once to trigger loading of images and math, wait, then render for real.
  renderPageRegion(ctx, doc, page, box, w, h, { theme, dpr: scale });
  await assetsSettled();
  renderPageRegion(ctx, doc, page, box, w, h, { theme, dpr: scale });
  return canvas;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export async function exportPagePng(doc: BoardDoc, page: string, theme: Theme, name: string) {
  const canvas = await renderPage(doc, page, theme);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Export failed');
  const n = doc.pageIds().indexOf(page) + 1;
  download(blob, `${name}-page-${n}.png`);
}

export async function exportBoardPdf(doc: BoardDoc, theme: Theme, name: string) {
  let pdf: jsPDF | null = null;
  for (const page of doc.pageIds()) {
    const canvas = await renderPage(doc, page, theme);
    // Size PDF pages in points from world units (40 units = 1 cm).
    const w = (canvas.width / SCALE) * (72 / 2.54 / 40);
    const h = (canvas.height / SCALE) * (72 / 2.54 / 40);
    const orientation = w > h ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation });
    else pdf.addPage([w, h], orientation);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h, undefined, 'FAST');
  }
  if (pdf) pdf.save(`${name}.pdf`);
}
