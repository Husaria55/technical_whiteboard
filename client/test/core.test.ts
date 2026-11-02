import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardDoc } from '../src/board/doc';
import { angleInSweep, hitTest, niceStep, pathFromWorldPoints, worldPoints } from '../src/board/geometry';
import { parseSegments } from '../src/board/text';
import { eraseFromStroke } from '../src/board/tools';
import { normalizeExpr } from '../src/board/assets';
import type { ShapeObj, StrokeObj } from '../src/board/types';

const base = { page: 'p1', rot: 0, z: 1 };

describe('geometry', () => {
  it('hit-tests rotated rectangles in local space', () => {
    const rect: ShapeObj = { ...base, id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 20, color: 'ink', width: 2, fill: '#f00', fillOpacity: 1, rot: Math.PI / 2 };
    // Rotated 90° around its centre (50, 10): now spans x 40..60, y -40..60.
    expect(hitTest(rect, { x: 50, y: 50 }, 1)).toBe(true);
    expect(hitTest(rect, { x: 90, y: 10 }, 1)).toBe(false);
  });

  it('hits only the outline of unfilled ellipses', () => {
    const e: ShapeObj = { ...base, id: 'e', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 100, h: 100, color: 'ink', width: 2, fill: null, fillOpacity: 1 };
    expect(hitTest(e, { x: 50, y: 1 }, 2)).toBe(true);
    expect(hitTest(e, { x: 50, y: 50 }, 2)).toBe(false);
  });

  it('recognises angles inside an arc sweep in both directions', () => {
    expect(angleInSweep(Math.PI / 4, 0, Math.PI / 2)).toBe(true);
    expect(angleInSweep(-Math.PI / 4, 0, Math.PI / 2)).toBe(false);
    expect(angleInSweep(-Math.PI / 4, 0, -Math.PI / 2)).toBe(true);
  });

  it('round-trips path points through local coordinates and scaling', () => {
    const geom = pathFromWorldPoints([{ x: 10, y: 10 }, { x: 30, y: 50 }]);
    const line = { ...base, id: 'l', type: 'shape', shape: 'line', color: 'ink', width: 2, fill: null, fillOpacity: 1, ...geom } as ShapeObj & { pts: number[] };
    expect(worldPoints(line)).toEqual([{ x: 10, y: 10 }, { x: 30, y: 50 }]);
    const scaled = { ...line, w: line.w * 2 };
    expect(worldPoints(scaled)[1]).toEqual({ x: 50, y: 50 });
  });

  it('picks 1-2-5 tick steps', () => {
    expect(niceStep(10, 10)).toBe(1);
    expect(niceStep(20, 8)).toBe(2);
    expect(niceStep(0.4, 8)).toBe(0.05);
  });
});

describe('area eraser', () => {
  it('splits a stroke where the eraser crosses it', () => {
    const geom = pathFromWorldPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const stroke: StrokeObj = { ...base, id: 's', type: 'stroke', ...geom, pr: [], color: 'ink', size: 2 };
    let n = 0;
    const pieces = eraseFromStroke(stroke, { x: 50, y: -20 }, { x: 50, y: 20 }, 5, () => `n${n++}`)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.x).toBe(0);
    expect(pieces[0]!.x + pieces[0]!.w).toBeLessThan(46);
    expect(pieces[1]!.x).toBeGreaterThan(54);
    expect(eraseFromStroke(stroke, { x: 50, y: 30 }, { x: 60, y: 30 }, 5, () => 'x')).toBeNull();
  });
});

describe('text', () => {
  it('splits inline math', () => {
    expect(parseSegments('F = $ma$ N')).toEqual([
      { kind: 'text', value: 'F = ' },
      { kind: 'math', value: 'ma' },
      { kind: 'text', value: ' N' },
    ]);
    expect(parseSegments('costs \\$5')).toEqual([{ kind: 'text', value: 'costs $5' }]);
    expect(parseSegments('open $x')).toEqual([{ kind: 'text', value: 'open $x' }]);
  });

  it('normalises graph expressions', () => {
    expect(normalizeExpr('y = x^2')).toBe('x^2');
    expect(normalizeExpr('f(x)= sin(x)')).toBe('sin(x)');
  });
});

describe('board document', () => {
  it('manages pages and per-user undo', () => {
    const doc = new BoardDoc(new Y.Doc());
    doc.ensurePage();
    doc.ensurePage();
    expect(doc.pageIds()).toEqual(['p1']);
    const p2 = doc.addPage('p1');
    expect(doc.pageIds()).toEqual(['p1', p2]);
    doc.movePage(p2, -1);
    expect(doc.pageIds()).toEqual([p2, 'p1']);
    doc.undo.stopCapturing();
    doc.put([{ ...base, id: 'a', type: 'text', x: 0, y: 0, w: 1, h: 1, text: 'hi', color: 'ink', fontSize: 20 }]);
    expect(doc.pageObjects('p1')).toHaveLength(1);
    doc.undo.undo();
    expect(doc.pageObjects('p1')).toHaveLength(0);
    doc.deletePage(p2);
    expect(doc.pageIds()).toEqual(['p1']);
  });
});
