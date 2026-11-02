import { useEffect, useRef } from 'react';
import type { Editor, UiState } from '../board/editor';
import { TEXT_FONT, LINE_HEIGHT } from '../board/text';
import { resolveColor } from '../board/theme';

/** A textarea placed over the canvas while a text box is being edited. */
export function TextEditor({ editor, ui }: { editor: Editor; ui: UiState }) {
  const t = ui.textEdit!;
  const ref = useRef<HTMLTextAreaElement>(null);
  const pos = editor.worldToScreen({ x: t.x, y: t.y });
  const fontPx = t.fontSize * ui.camera.zoom;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [t.id]);

  // Grow with content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
    el.style.width = '0px';
    el.style.width = `${Math.max(fontPx * 4, el.scrollWidth + fontPx)}px`;
  }, [t.text, fontPx]);

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={t.text}
      placeholder="Type… ($x^2$ for math)"
      spellCheck={false}
      style={{
        left: pos.x,
        top: pos.y,
        font: `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${fontPx}px ${TEXT_FONT}`,
        lineHeight: LINE_HEIGHT,
        color: resolveColor(t.color, ui.theme),
      }}
      onChange={(e) => editor.updateTextEdit(e.target.value)}
      onBlur={(e) => {
        // Adjusting size/bold/colour in the style panel keeps the editor open.
        if ((e.relatedTarget as HTMLElement | null)?.closest('.style-panel')) return;
        void editor.commitTextEdit();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          void editor.commitTextEdit();
        }
      }}
    />
  );
}
