export interface Vec {
  x: number;
  y: number;
}

/** World units per centimetre. 1 mm = 4 units; used by rulers, graph paper and measurements. */
export const UNITS_PER_CM = 40;

/** Special colour that resolves to the board's foreground colour (black on white, white on dark). */
export const INK = 'ink';

export type Theme = 'light' | 'dark' | 'chalk';
export type Background = 'blank' | 'grid' | 'dots' | 'lines' | 'graph';

export interface PageInfo {
  background: Background;
}

interface Base {
  id: string;
  page: string;
  /** Top-left of the unrotated bounding box, in world units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation in radians around the box centre. */
  rot: number;
  /** Stacking order; higher draws on top. */
  z: number;
  locked?: boolean;
}

/** Objects whose geometry is a list of points in local coordinates. */
interface PathGeometry {
  /** Flat [x, y, ...] list in local coordinates of the natural box [0, nw] × [0, nh]. */
  pts: number[];
  nw: number;
  nh: number;
}

export interface StrokeObj extends Base, PathGeometry {
  type: 'stroke';
  /** Pressure per point, 0..1 (same length as pts / 2). */
  pr: number[];
  color: string;
  size: number;
  highlighter?: boolean;
}

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'line' | 'arc' | 'sector';

export interface ShapeObj extends Base, Partial<PathGeometry> {
  type: 'shape';
  shape: ShapeKind;
  color: string;
  width: number;
  /** Fill colour, or null for no fill. */
  fill: string | null;
  fillOpacity: number;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Arc/sector angles (radians) on the ellipse inscribed in the box. */
  a0?: number;
  a1?: number;
}

export interface TextObj extends Base {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

export interface MathObj extends Base {
  type: 'math';
  latex: string;
  color: string;
}

export interface GraphFn {
  expr: string;
  color: string;
}

export interface GraphObj extends Base {
  type: 'graph';
  fns: GraphFn[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  grid: boolean;
}

export interface ImageObj extends Base {
  type: 'image';
  src: string;
}

export type BoardObject = StrokeObj | ShapeObj | TextObj | MathObj | GraphObj | ImageObj;
export type ObjectType = BoardObject['type'];

export const isPathObject = (o: BoardObject): o is BoardObject & PathGeometry =>
  Array.isArray((o as Partial<PathGeometry>).pts);
