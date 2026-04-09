/** Grid cell in column-major canvas indexing: c right, r down. */
export type Cell = { c: number; r: number };

export function cellKey(c: Cell): string {
  return `${c.c},${c.r}`;
}

export function parseCellKey(k: string): Cell {
  const [a, b] = k.split(",");
  return { c: Number(a), r: Number(b) };
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
}

function fibStepLength(i: number): number {
  if (i <= 0) return 1;
  if (i === 1) return 1;
  let a = 1;
  let b = 1;
  for (let j = 2; j <= i; j++) {
    const n = a + b;
    a = b;
    b = n;
  }
  return b;
}

/**
 * Fibonacci-length segments: E, S, W, N, … from the exit cell (screen y-down grid).
 */
export function buildFibonacciSpiralPath(
  start: Cell,
  cols: number,
  rows: number,
  maxCells: number
): Cell[] {
  const path: Cell[] = [{ c: start.c, r: start.r }];
  const seen = new Set<string>([cellKey(start)]);
  let c = start.c;
  let r = start.r;
  const dc = [1, 0, -1, 0];
  const dr = [0, 1, 0, -1];
  let dir = 0;
  let seg = 0;
  while (path.length < maxCells && seg < 40) {
    const steps = fibStepLength(seg);
    for (let s = 0; s < steps; s++) {
      c += dc[dir]!;
      r += dr[dir]!;
      if (c < 0 || c >= cols || r < 0 || r >= rows) return path;
      const k = cellKey({ c, r });
      if (seen.has(k)) return path;
      seen.add(k);
      path.push({ c, r });
      if (path.length >= maxCells) return path;
    }
    dir = (dir + 1) % 4;
    seg += 1;
  }
  return path;
}

export type VortexLayout = {
  cols: number;
  rows: number;
  cellSize: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  R: number;
};

export function computeVortexLayout(
  width: number,
  height: number,
  options?: { circleFrac?: number; minCellPx?: number; pad?: number }
): VortexLayout {
  const pad = options?.pad ?? 12;
  const cw = Math.max(1, width - pad * 2);
  const ch = Math.max(1, height - pad * 2);
  const circleFrac = options?.circleFrac ?? 0.35;
  const minCell = options?.minCellPx ?? 14;
  const m = Math.min(cw, ch);
  const cellSize = Math.max(minCell, Math.floor(m / 26));
  const cols = Math.max(1, Math.floor(cw / cellSize));
  const rows = Math.max(1, Math.floor(ch / cellSize));
  const gridW = cols * cellSize;
  const gridH = rows * cellSize;
  const ox = pad + (cw - gridW) / 2;
  const oy = pad + (ch - gridH) / 2;
  const cx = ox + gridW / 2;
  const cy = oy + gridH / 2;
  const R = m * circleFrac;
  return { cols, rows, cellSize, ox, oy, cx, cy, R };
}

/** Cell centers whose distance to (cx,cy) lies in the ring band around R (stroke). */
export function cellsTouchingCircleRing(
  layout: VortexLayout,
  strokePx: number
): Set<string> {
  const { cols, rows, cellSize, ox, oy, cx, cy, R } = layout;
  const halfDiag = (cellSize * Math.SQRT2) / 2;
  const band = strokePx / 2 + halfDiag * 0.35;
  const lo = R - band;
  const hi = R + band;
  const out = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = ox + c * cellSize + cellSize / 2;
      const py = oy + r * cellSize + cellSize / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d >= lo && d <= hi) out.add(cellKey({ c, r }));
    }
  }
  return out;
}

export function cellCenterPx(
  layout: VortexLayout,
  cell: Cell
): { x: number; y: number } {
  const { cellSize, ox, oy } = layout;
  return {
    x: ox + cell.c * cellSize + cellSize / 2,
    y: oy + cell.r * cellSize + cellSize / 2,
  };
}

export function pixelToCell(
  layout: VortexLayout,
  px: number,
  py: number
): Cell | null {
  const { cols, rows, cellSize, ox, oy } = layout;
  const c = Math.floor((px - ox) / cellSize);
  const r = Math.floor((py - oy) / cellSize);
  if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
  return { c, r };
}

/** Player at bottom of ring, AI at top; theta increases = clockwise spin (screen coords). */
export function ringAttachmentPx(
  layout: VortexLayout,
  theta: number,
  which: "player" | "ai"
): { x: number; y: number } {
  const { cx, cy, R } = layout;
  const base = which === "player" ? Math.PI / 2 : -Math.PI / 2;
  const a = base + theta;
  return {
    x: cx + R * Math.cos(a),
    y: cy + R * Math.sin(a),
  };
}

export type VortexMapTuning = {
  /** Fraction of min(canvas) for circle radius. */
  circleFrac: number;
  /** Radians per second, clockwise. */
  spinRadPerSec: number;
  /** Ms after both exits chosen before release. */
  planningHoldMs: number;
  /** Max cells per spiral path. */
  spiralMaxCells: number;
  /** Damage per trap trigger. */
  damageAmount: number;
  /** Match length excluding countdown (ms). */
  matchDurationMs: number;
};

export const DEFAULT_VORTEX_TUNING: VortexMapTuning = {
  circleFrac: 0.35,
  spinRadPerSec: 0.55,
  planningHoldMs: 5000,
  spiralMaxCells: 120,
  damageAmount: 1,
  matchDurationMs: 180_000,
};
