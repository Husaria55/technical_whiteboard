import { useEffect, useRef } from 'react';
import type { Editor, UiState } from '../board/editor';
import { contentBounds, renderPageRegion } from '../board/pageRender';
import { Icon } from './Icon';

const THUMB_W = 160;
const THUMB_H = 110;

function Thumbnail({ editor, page, version, theme }: { editor: Editor; page: string; version: number; theme: UiState['theme'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // Thumbnails are cheap but not free: redraw shortly after changes settle.
    const t = setTimeout(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = THUMB_W * dpr;
      canvas.height = THUMB_H * dpr;
      const ctx = canvas.getContext('2d')!;
      const b = contentBounds(editor.doc, page) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
      const pad = 20;
      renderPageRegion(ctx, editor.doc, page, { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, THUMB_W, THUMB_H, {
        theme,
        dpr,
        background: false,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [editor, page, version, theme]);
  return <canvas ref={ref} style={{ width: THUMB_W, height: THUMB_H }} />;
}

export function PagesPanel({ editor, ui, onClose }: { editor: Editor; ui: UiState; onClose: () => void }) {
  const pages = ui.pages.length ? ui.pages : [ui.page];
  return (
    <aside className="pages-panel" aria-label="Pages">
      <div className="pages-header">
        <strong>Pages</strong>
        <button aria-label="Close pages" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <ol className="pages-list">
        {pages.map((p, i) => (
          <li key={p} className={p === ui.page ? 'active' : ''}>
            <button className={`page-thumb theme-${ui.theme}`} onClick={() => editor.setPage(p)} aria-label={`Page ${i + 1}`} aria-current={p === ui.page}>
              <Thumbnail editor={editor} page={p} version={ui.docVersion} theme={ui.theme} />
              <span className="page-number">{i + 1}</span>
            </button>
            {ui.canEdit && p === ui.page && (
              <div className="page-actions">
                <button title="Move up" aria-label="Move page up" disabled={i === 0} onClick={() => editor.doc.movePage(p, -1)}>
                  <Icon name="up" size={14} />
                </button>
                <button title="Move down" aria-label="Move page down" disabled={i === pages.length - 1} onClick={() => editor.doc.movePage(p, 1)}>
                  <Icon name="down" size={14} />
                </button>
                <button title="Unlock all objects on this page" aria-label="Unlock all" onClick={() => editor.unlockAll()}>
                  <Icon name="unlock" size={14} />
                </button>
                <button
                  className="danger"
                  title={pages.length > 1 ? 'Delete page' : 'Clear page'}
                  aria-label="Delete page"
                  onClick={() => {
                    if (confirm(pages.length > 1 ? `Delete page ${i + 1}?` : 'Clear this page?')) editor.deletePage(p);
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {ui.canEdit && (
        <button className="add-page" onClick={() => editor.addPage()}>
          <Icon name="plus" size={16} /> Add page
        </button>
      )}
    </aside>
  );
}
