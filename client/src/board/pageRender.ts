import type { BoardDoc } from './doc';
import { objectBounds, unionBoxes, type Box } from './geometry';
import { drawBackground, drawObject } from './render';
import type { Theme } from './types';

export function contentBounds(doc: BoardDoc, page: string): Box | null {
  return unionBoxes(doc.pageObjects(page).map(objectBounds));
}

/**
 * Renders a whole page region into a 2D context of size width × height (CSS px),
 * fitting `box` (world coordinates) with the given device pixel ratio.
 */
export function renderPageRegion(
  ctx: CanvasRenderingContext2D,
  doc: BoardDoc,
  page: string,
  box: Box,
  width: number,
  height: number,
  options: { theme: Theme; dpr: number; background?: boolean },
) {
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const zoom = Math.min(width / bw, height / bh);
  const offX = (width - bw * zoom) / 2;
  const offY = (height - bh * zoom) / 2;
  ctx.save();
  ctx.setTransform(options.dpr, 0, 0, options.dpr, 0, 0);
  ctx.translate(offX, offY);
  ctx.scale(zoom, zoom);
  ctx.translate(-box.minX, -box.minY);
  const view = {
    minX: box.minX - offX / zoom,
    minY: box.minY - offY / zoom,
    maxX: box.minX + (width - offX) / zoom,
    maxY: box.minY + (height - offY) / zoom,
  };
  drawBackground(ctx, options.background === false ? 'blank' : doc.page(page).background, options.theme, view, zoom);
  const env = { theme: options.theme, pixelsPerUnit: zoom * options.dpr };
  for (const o of doc.pageObjects(page)) drawObject(ctx, o, env);
  ctx.restore();
}
