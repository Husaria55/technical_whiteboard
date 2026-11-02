import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api';
import { newId } from './doc';
import type { Editor } from './editor';
import { UNITS_PER_CM, type ImageObj } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** PDF points (1/72 inch) to world units, so a page keeps its real size in cm. */
const UNITS_PER_POINT = (UNITS_PER_CM * 2.54) / 72;
/** Rendering resolution: pixels per PDF point. */
const RENDER_SCALE = 2;

/**
 * Renders each PDF page to an image, uploads it and adds it as a new board
 * page with the image locked as background, ready to annotate.
 * Returns the id of the first created page.
 */
export async function importPdf(editor: Editor, file: File, progress: (n: number, total: number) => void): Promise<string | null> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  let after = editor.page;
  let first: string | null = null;
  // Reuse the current page if it is empty.
  const reuseCurrent = editor.doc.pageObjects(editor.page).length === 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render PDF page'))), 'image/png'),
      );
      const { url } = await api.upload(editor.boardId, editor.token, blob, `page-${n}.png`);
      const pageId = n === 1 && reuseCurrent ? editor.page : editor.doc.addPage(after, 'blank');
      if (n === 1 && reuseCurrent) editor.doc.setBackground(pageId, 'blank');
      after = pageId;
      first ??= pageId;
      const w = (viewport.width / RENDER_SCALE) * UNITS_PER_POINT;
      const h = (viewport.height / RENDER_SCALE) * UNITS_PER_POINT;
      const img: ImageObj = { id: newId(), type: 'image', page: pageId, x: 0, y: 0, w, h, rot: 0, z: 0, src: url, locked: true };
      editor.doc.put([img]);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  if (first) editor.showToast('PDF pages are locked backgrounds. Use “Unlock all” in the page menu to move them.', 6000);
  return first;
}
