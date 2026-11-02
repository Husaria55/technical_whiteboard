import { useEffect, useRef, useState } from 'react';
import type { Editor, UiState } from '../board/editor';
import { INSTRUMENT_LABELS, type InstrumentKind } from '../board/instruments';
import type { ToolId } from '../board/tools';
import { Icon } from './Icon';

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
}

const MAIN: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'hand', label: 'Pan', key: 'H / Space' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'highlighter', label: 'Highlighter', key: 'I' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
];

const SHAPES: ToolDef[] = [
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse / circle', key: 'O' },
  { id: 'triangle', label: 'Triangle', key: 'Y' },
  { id: 'polygon', label: 'Polygon', key: 'J' },
  { id: 'ngon', label: 'Regular polygon', key: 'N' },
  { id: 'arc', label: 'Arc / sector', key: 'K' },
];

const MATH: ToolDef[] = [
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'math', label: 'Equation (LaTeX)', key: 'M' },
  { id: 'graph', label: 'Function graph', key: 'G' },
];

const GEOMETRY: ToolDef[] = [
  { id: 'compass', label: 'Compass', key: 'C' },
  { id: 'measure', label: 'Measure length / angle', key: 'D' },
];

const INSTRUMENTS: { kind: InstrumentKind; key: string }[] = [
  { kind: 'ruler', key: 'U' },
  { kind: 'protractor', key: 'W' },
  { kind: 'square45', key: 'Q' },
  { kind: 'square60', key: 'Shift Q' },
];

const VIEW_TOOLS = new Set<ToolId>(['hand', 'select', 'measure']);

function ToolButton({ def, ui, editor }: { def: ToolDef; ui: UiState; editor: Editor }) {
  const disabled = !ui.canEdit && !VIEW_TOOLS.has(def.id);
  if (disabled) return null;
  return (
    <button
      className={`tool${ui.tool === def.id ? ' active' : ''}`}
      title={`${def.label} (${def.key})`}
      aria-label={def.label}
      aria-pressed={ui.tool === def.id}
      onClick={() => editor.setTool(def.id)}
    >
      <Icon name={def.id} />
    </button>
  );
}

function Flyout({ icon, label, active, children }: { icon: string; label: string; active: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="flyout" ref={ref}>
      <button className={`tool${active ? ' active' : ''}`} title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} />
        <span className="flyout-mark" />
      </button>
      {open && (
        <div className="flyout-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ editor, ui }: { editor: Editor; ui: UiState }) {
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const shapeActive = SHAPES.some((s) => s.id === ui.tool);
  const currentShape = SHAPES.find((s) => s.id === ui.tool) ?? SHAPES.find((s) => s.id === 'rect')!;

  return (
    <nav className="toolbar" aria-label="Tools">
      <div className="tool-group">
        {MAIN.map((t) => (
          <ToolButton key={t.id} def={t} ui={ui} editor={editor} />
        ))}
      </div>
      {ui.canEdit && (
        <div className="tool-group">
          <Flyout icon={currentShape.id} label="Shapes" active={shapeActive}>
            {SHAPES.map((t) => (
              <button key={t.id} className={`menu-item${ui.tool === t.id ? ' active' : ''}`} onClick={() => editor.setTool(t.id)}>
                <Icon name={t.id} size={18} />
                <span>{t.label}</span>
                <kbd>{t.key}</kbd>
              </button>
            ))}
          </Flyout>
          {MATH.map((t) => (
            <ToolButton key={t.id} def={t} ui={ui} editor={editor} />
          ))}
        </div>
      )}
      <div className="tool-group">
        {GEOMETRY.map((t) => (
          <ToolButton key={t.id} def={t} ui={ui} editor={editor} />
        ))}
        <Flyout icon="ruler" label="Instruments: ruler, protractor, set squares" active={ui.instruments.length > 0}>
          {INSTRUMENTS.map((i) => (
            <button key={i.kind} className={`menu-item${ui.instruments.includes(i.kind) ? ' active' : ''}`} onClick={() => editor.toggleInstrument(i.kind)}>
              <Icon name={i.kind} size={18} />
              <span>{INSTRUMENT_LABELS[i.kind]}</span>
              <kbd>{i.key}</kbd>
            </button>
          ))}
        </Flyout>
      </div>
      {ui.canEdit && (
        <div className="tool-group">
          <button className="tool" title="Insert image (or paste / drop)" aria-label="Insert image" onClick={() => imageInput.current?.click()}>
            <Icon name="image" />
          </button>
          <button className="tool" title="Import PDF as pages" aria-label="Import PDF" onClick={() => pdfInput.current?.click()}>
            <Icon name="pdf" />
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void editor.insertImage(f);
              e.target.value = '';
            }}
          />
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void editor.importPdf(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
      <div className="tool-group toolbar-end">
        <button
          className={`tool${ui.penOnly ? ' active' : ''}`}
          title={ui.penOnly ? 'Pen only: fingers pan and zoom (click to allow finger drawing)' : 'Finger drawing allowed (click for pen only / palm rejection)'}
          aria-label="Pen only mode"
          aria-pressed={ui.penOnly}
          onClick={() => editor.setPenOnly(!ui.penOnly)}
        >
          <Icon name="touch" />
        </button>
      </div>
    </nav>
  );
}
