import { useEffect, useRef, useState } from 'react';
import { loadMathJs } from '../board/assets';
import type { Dialog, Editor } from '../board/editor';
import { drawGraph, graphError } from '../board/graph';
import { THEMES } from '../board/theme';
import type { GraphObj } from '../board/types';
import { Modal } from './Modal';

const COLORS = ['#1971c2', '#e03131', '#2f9e44', '#f08c00', '#9c36b5'];
const PREVIEW_W = 360;
const PREVIEW_H = 240;

export function GraphDialog({ editor, dialog }: { editor: Editor; dialog: Extract<Dialog, { kind: 'graph' }> }) {
  const init = dialog.initial;
  const fn = init.fns[0] ?? { expr: 'sin(x)', color: COLORS[0]! };
  const [expr, setExpr] = useState(fn.expr);
  const [color, setColor] = useState(fn.color);
  const [range, setRange] = useState({ xMin: String(init.xMin), xMax: String(init.xMax), yMin: String(init.yMin), yMax: String(init.yMax) });
  const [grid, setGrid] = useState(init.grid);
  const [loaded, setLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void loadMathJs().then(() => setLoaded(true));
  }, []);

  const nums = { xMin: Number(range.xMin), xMax: Number(range.xMax), yMin: Number(range.yMin), yMax: Number(range.yMax) };
  const rangeValid = Object.values(nums).every(Number.isFinite) && nums.xMax > nums.xMin && nums.yMax > nums.yMin;
  const values: Pick<GraphObj, 'fns' | 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'grid'> = { fns: [{ expr, color }], ...nums, grid };
  const error = loaded ? graphError(values) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rangeValid) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PREVIEW_W * dpr;
    canvas.height = PREVIEW_H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = THEMES.light;
    ctx.fillStyle = t.background;
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const o: GraphObj = { id: 'preview', type: 'graph', page: '', x: 0, y: 0, w: PREVIEW_W, h: PREVIEW_H, rot: 0, z: 0, ...values };
    drawGraph(ctx, o, t.ink, t.gridMajor, (c) => c, dpr);
  });

  const setR = (k: keyof typeof range) => (e: React.ChangeEvent<HTMLInputElement>) => setRange({ ...range, [k]: e.target.value });

  const square = () => {
    // Equal scale on both axes for the graph's aspect ratio, keeping the x range.
    const box = dialog.box ?? (dialog.id ? editor.doc.get(dialog.id) : null);
    const aspect = box ? box.h / box.w : PREVIEW_H / PREVIEW_W;
    const half = ((nums.xMax - nums.xMin) * aspect) / 2;
    const mid = (nums.yMax + nums.yMin) / 2;
    setRange({ ...range, yMin: String(+(mid - half).toFixed(3)), yMax: String(+(mid + half).toFixed(3)) });
  };

  return (
    <Modal title={dialog.id ? 'Edit graph' : 'Plot a function'} onClose={() => editor.openDialog(null)} wide>
      <form
        className="graph-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error && rangeValid) editor.saveGraph(values);
        }}
      >
        <div className="graph-fields">
          <label>
            y = f(x)
            <input autoFocus className="mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="x^2 - 2x + 1" spellCheck={false} />
          </label>
          <p className="hint">Examples: 2x+1, x^2, sin(x), sqrt(x), abs(x), exp(-x^2), log(x), 1/x, pi</p>
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} aria-label={c} className={`swatch${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
          <div className="range-grid">
            <label>
              x min
              <input inputMode="decimal" value={range.xMin} onChange={setR('xMin')} />
            </label>
            <label>
              x max
              <input inputMode="decimal" value={range.xMax} onChange={setR('xMax')} />
            </label>
            <label>
              y min
              <input inputMode="decimal" value={range.yMin} onChange={setR('yMin')} />
            </label>
            <label>
              y max
              <input inputMode="decimal" value={range.yMax} onChange={setR('yMax')} />
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid
            </label>
            <button type="button" onClick={square}>
              Equal axis scale
            </button>
          </div>
          {!rangeValid && <p className="error">Ranges must be numbers with min &lt; max.</p>}
          {error && <p className="error">{error}</p>}
        </div>
        <canvas ref={canvasRef} className="graph-preview" style={{ width: PREVIEW_W, height: PREVIEW_H }} />
        <div className="modal-actions">
          <button type="button" onClick={() => editor.openDialog(null)}>
            Cancel
          </button>
          <button className="primary" disabled={!!error || !rangeValid || !expr.trim()}>
            {dialog.id ? 'Save' : 'Insert'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
