import type { Editor, Style, UiState } from '../board/editor';
import { HIGHLIGHTER_PALETTE, PALETTE, THEMES } from '../board/theme';
import { INK } from '../board/types';
import { Icon } from './Icon';

const SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse', 'triangle', 'polygon', 'ngon', 'arc']);
const FILL_TOOLS = new Set(['rect', 'ellipse', 'triangle', 'polygon', 'ngon', 'arc']);

function Swatches({ colors, value, onChange, theme }: { colors: string[]; value: string; onChange: (c: string) => void; theme: UiState['theme'] }) {
  const custom = !colors.includes(value);
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c === INK ? 'Ink (black/white)' : c}
          title={c === INK ? 'Ink: black on light boards, white on dark boards' : c}
          className={`swatch${value === c ? ' active' : ''}`}
          style={{ background: c === INK ? THEMES[theme].ink : c }}
          onClick={() => onChange(c)}
        />
      ))}
      <label className={`swatch custom${custom ? ' active' : ''}`} title="Custom colour" style={custom ? { background: value } : undefined}>
        <input type="color" value={value === INK ? '#000000' : value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label className="slider">
      <span>
        {label} <output>{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'active' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function StylePanel({ editor, ui }: { editor: Editor; ui: UiState }) {
  const s = ui.style;
  const set = (patch: Partial<Style>) => editor.setStyle(patch);
  const tool = ui.tool;
  const sel = ui.selectionTypes;
  const hasSel = ui.selection.length > 0;
  const selHas = (t: string) => sel.includes(t as never);

  const showColor = ['pen', 'compass', 'text', 'math'].includes(tool) || SHAPE_TOOLS.has(tool) || !!ui.textEdit || (hasSel && sel.some((t) => t !== 'image' && t !== 'graph'));
  const showHighlighter = tool === 'highlighter';
  const showShape = SHAPE_TOOLS.has(tool) || selHas('shape');
  const showFill = FILL_TOOLS.has(tool) || selHas('shape');
  const showText = tool === 'text' || !!ui.textEdit || selHas('text');

  const sections: React.ReactNode[] = [];
  if (!ui.canEdit) {
    if (tool !== 'measure') return null;
  }
  if (showColor && ui.canEdit) {
    sections.push(<Swatches key="color" colors={PALETTE} value={s.color} onChange={(color) => set({ color })} theme={ui.theme} />);
  }
  if (showHighlighter) {
    sections.push(<Swatches key="hl" colors={HIGHLIGHTER_PALETTE} value={s.highlighterColor} onChange={(highlighterColor) => set({ highlighterColor })} theme={ui.theme} />);
    sections.push(<Slider key="hls" label="Width" value={s.highlighterSize} min={6} max={48} onChange={(highlighterSize) => set({ highlighterSize })} />);
  }
  if (tool === 'pen' || tool === 'compass') {
    sections.push(<Slider key="pen" label="Width" value={s.penSize} min={1} max={24} step={0.5} onChange={(penSize) => set({ penSize })} />);
  }
  if (tool === 'eraser') {
    sections.push(
      <Segmented
        key="em"
        value={s.eraserMode}
        options={[
          ['object', 'Whole objects'],
          ['area', 'Area (strokes)'],
        ]}
        onChange={(eraserMode) => set({ eraserMode })}
      />,
    );
    sections.push(<Slider key="es" label="Size" value={s.eraserSize} min={6} max={120} onChange={(eraserSize) => set({ eraserSize })} />);
  }
  if (showShape && ui.canEdit) {
    sections.push(<Slider key="sw" label="Line width" value={s.width} min={0.5} max={16} step={0.5} onChange={(width) => set({ width })} />);
  }
  if (showFill && ui.canEdit) {
    sections.push(
      <div key="fill" className="fill-row">
        <label className="check">
          <input type="checkbox" checked={s.fillEnabled} onChange={(e) => set({ fillEnabled: e.target.checked })} /> Fill
        </label>
        {s.fillEnabled && (
          <>
            <input type="color" aria-label="Fill colour" value={s.fill} onChange={(e) => set({ fill: e.target.value })} />
            <Slider label="Opacity" value={s.fillOpacity} min={0.05} max={1} step={0.05} onChange={(fillOpacity) => set({ fillOpacity })} />
          </>
        )}
      </div>,
    );
  }
  if (tool === 'arrow') {
    sections.push(
      <Segmented
        key="ab"
        value={s.arrowBoth ? 'both' : 'end'}
        options={[
          ['end', 'One head →'],
          ['both', 'Two heads ↔'],
        ]}
        onChange={(v) => set({ arrowBoth: v === 'both' })}
      />,
    );
  }
  if (tool === 'triangle') {
    sections.push(
      <Segmented
        key="tk"
        value={s.triangleKind}
        options={[
          ['isosceles', 'Isosceles'],
          ['right', 'Right-angled'],
        ]}
        onChange={(triangleKind) => set({ triangleKind })}
      />,
    );
  }
  if (tool === 'ngon') {
    sections.push(<Slider key="sides" label="Sides" value={s.sides} min={3} max={12} onChange={(sides) => set({ sides })} />);
  }
  if (tool === 'arc') {
    sections.push(
      <Segmented
        key="ak"
        value={s.arcKind}
        options={[
          ['arc', 'Arc'],
          ['sector', 'Sector'],
        ]}
        onChange={(arcKind) => set({ arcKind })}
      />,
    );
  }
  if (tool === 'arc' || tool === 'compass') {
    sections.push(
      <p key="arch" className="hint">
        Drag from the centre to set the radius, then drag around to draw. Alt+drag starts a new centre.
      </p>,
    );
  }
  if (tool === 'polygon') {
    sections.push(
      <p key="ph" className="hint">
        Click to add corners. Click the first corner, double-click or press Enter to finish.
      </p>,
    );
  }
  if (showText && ui.canEdit) {
    sections.push(
      <div key="text" className="text-row">
        <Slider label="Size" value={s.fontSize} min={10} max={96} onChange={(fontSize) => set({ fontSize })} />
        <button className={s.bold ? 'active' : ''} aria-pressed={s.bold} title="Bold" onClick={() => set({ bold: !s.bold })}>
          <b>B</b>
        </button>
        <button className={s.italic ? 'active' : ''} aria-pressed={s.italic} title="Italic" onClick={() => set({ italic: !s.italic })}>
          <i>I</i>
        </button>
      </div>,
    );
    if (tool === 'text') sections.push(<p key="th" className="hint">Write math between dollar signs, e.g. $E = mc^2$.</p>);
  }
  if (tool === 'measure') {
    sections.push(
      <Segmented
        key="mm"
        value={s.measureMode}
        options={[
          ['length', 'Length'],
          ['angle', 'Angle'],
        ]}
        onChange={(measureMode) => set({ measureMode })}
      />,
    );
    if (s.measureMode === 'angle') sections.push(<p key="mh" className="hint">Drag from the vertex along the first arm, then click the second arm.</p>);
  }
  if (tool === 'select' && !hasSel) {
    sections.push(
      <Segmented
        key="sm"
        value={s.selectMode}
        options={[
          ['rect', 'Rectangle'],
          ['lasso', 'Lasso'],
        ]}
        onChange={(selectMode) => set({ selectMode })}
      />,
    );
  }
  if (hasSel && ui.canEdit) {
    sections.push(
      <div key="actions" className="actions-row">
        <button title="Duplicate (Ctrl D)" onClick={() => editor.duplicateSelection()}>
          <Icon name="copy" size={16} />
        </button>
        <button title={ui.selectionLocked ? 'Unlock' : 'Lock in place'} onClick={() => editor.setLocked(!ui.selectionLocked)}>
          <Icon name={ui.selectionLocked ? 'unlock' : 'lock'} size={16} />
        </button>
        <button className="danger" title="Delete (Del)" onClick={() => editor.deleteSelection()}>
          <Icon name="trash" size={16} />
        </button>
        {ui.selection.length === 1 && (sel[0] === 'text' || sel[0] === 'math' || sel[0] === 'graph') && (
          <button
            onClick={() => {
              const o = editor.selectedObjects()[0];
              if (o) editor.editObject(o);
            }}
          >
            Edit
          </button>
        )}
      </div>,
    );
  }
  if (sections.length === 0) return null;
  return (
    <div className="style-panel" onPointerDown={(e) => e.stopPropagation()}>
      {sections}
    </div>
  );
}
