import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Board } from '../api';
import type { Editor } from '../board/editor';
import { Toolbar } from './Toolbar';
import { StylePanel } from './StylePanel';
import { TopBar } from './TopBar';
import { PagesPanel } from './PagesPanel';
import { TextEditor } from './TextEditor';
import { MathDialog } from './MathDialog';
import { GraphDialog } from './GraphDialog';
import { ShareDialog } from './ShareDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Icon } from './Icon';

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'MATH-FIELD'].includes(el.tagName);
};

export function useEditorState(editor: Editor) {
  return useSyncExternalStore(editor.subscribe, editor.getSnapshot);
}

export function Whiteboard({
  editor,
  board,
  signedIn,
  onRename,
}: {
  editor: Editor;
  board: Board;
  signedIn: boolean;
  onRename: (title: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ui = useEditorState(editor);
  const [pagesOpen, setPagesOpen] = useState(() => window.innerWidth > 900);
  const [shareBoard, setShareBoard] = useState(board);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    editor.attach(canvas);
    const opts = { passive: false } as const;
    canvas.addEventListener('wheel', editor.onWheel, opts);
    // Safari pinch gestures would otherwise zoom the whole page.
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', prevent);
    return () => {
      canvas.removeEventListener('wheel', editor.onWheel);
      document.removeEventListener('gesturestart', prevent);
      editor.detach();
    };
  }, [editor]);

  useEffect(() => {
    editor.exportTitle = board.title;
  }, [editor, board.title]);

  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editor.getSnapshot().dialog) return;
      if (editor.onKeyDown(e)) e.preventDefault();
    };
    const keyUp = (e: KeyboardEvent) => editor.onKeyUp(e);
    const copy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || window.getSelection()?.toString()) return;
      if (editor.copySelection(e.clipboardData)) e.preventDefault();
    };
    const cut = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      if (editor.copySelection(e.clipboardData)) {
        e.preventDefault();
        editor.deleteSelection();
      }
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      e.preventDefault();
      void editor.paste(e.clipboardData);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('copy', copy);
    window.addEventListener('cut', cut);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('copy', copy);
      window.removeEventListener('cut', cut);
      window.removeEventListener('paste', paste);
    };
  }, [editor]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!ui.canEdit) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const at = editor.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    for (const file of e.dataTransfer.files) {
      if (file.type === 'application/pdf') void editor.importPdf(file);
      else if (file.type.startsWith('image/')) void editor.insertImage(file, at);
    }
  };

  return (
    <div className={`whiteboard theme-${ui.theme}`}>
      <TopBar
        editor={editor}
        ui={ui}
        board={board}
        signedIn={signedIn}
        onRename={onRename}
        pagesOpen={pagesOpen}
        onTogglePages={() => setPagesOpen((v) => !v)}
      />
      <div className="board-area">
        <Toolbar editor={editor} ui={ui} />
        <div
          className={`canvas-wrap${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            if (!ui.canEdit) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <canvas
            ref={canvasRef}
            className="board-canvas"
            onPointerDown={(e) => editor.onPointerDown(e.nativeEvent)}
            onPointerMove={(e) => editor.onPointerMove(e.nativeEvent)}
            onPointerUp={(e) => editor.onPointerUp(e.nativeEvent)}
            onPointerCancel={(e) => editor.onPointerUp(e.nativeEvent)}
            onPointerLeave={() => editor.onPointerLeave()}
            onContextMenu={(e) => e.preventDefault()}
          />
          {ui.textEdit && <TextEditor editor={editor} ui={ui} />}
          <StylePanel editor={editor} ui={ui} />
          <div className="zoom-controls">
            <button title="Zoom out (Ctrl −)" onClick={() => editor.zoomBy(0.8)}>
              <Icon name="minus" size={16} />
            </button>
            <button className="zoom-value" title="Reset zoom (Ctrl 0)" onClick={() => editor.setZoom(1)}>
              {Math.round(ui.camera.zoom * 100)}%
            </button>
            <button title="Zoom in (Ctrl +)" onClick={() => editor.zoomBy(1.25)}>
              <Icon name="plus" size={16} />
            </button>
            <button title="Zoom to content (Shift 1)" onClick={() => editor.zoomToFit()}>
              <Icon name="fit" size={16} />
            </button>
          </div>
          {ui.toast && <div className="toast">{ui.toast}</div>}
          {ui.busy && <div className="toast busy">{ui.busy}</div>}
        </div>
        {pagesOpen && <PagesPanel editor={editor} ui={ui} onClose={() => setPagesOpen(false)} />}
      </div>
      {ui.dialog?.kind === 'math' && <MathDialog editor={editor} dialog={ui.dialog} />}
      {ui.dialog?.kind === 'graph' && <GraphDialog editor={editor} dialog={ui.dialog} />}
      {ui.dialog?.kind === 'share' && <ShareDialog editor={editor} board={shareBoard} onChange={setShareBoard} />}
      {ui.dialog?.kind === 'shortcuts' && <ShortcutsDialog editor={editor} />}
    </div>
  );
}
