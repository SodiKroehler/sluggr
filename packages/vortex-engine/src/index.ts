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

/** Variation of the Fibonacci spiral on the grid (angle / handedness / length / mirror). */
export type SpiralVariant = {
  maxCells: number;
  /** Rotate which cardinal is “first” in the E,S,W,N cycle (0–3). */
  dirOffset: number;
  /** +1 = turn left after each leg, −1 = turn right (opposite winding). */
  turnSign: 1 | -1;
  mirrorH: boolean;
  mirrorV: boolean;
};

export function defaultSpiralVariant(maxCells: number): SpiralVariant {
  return {
    maxCells,
    dirOffset: 0,
    turnSign: 1,
    mirrorH: false,
    mirrorV: false,
  };
}

/** Random spiral for scroll / R / AI. */
export function randomSpiralVariant(rng: () => number): SpiralVariant {
  return {
    maxCells: 52 + Math.floor(rng() * 95),
    dirOffset: Math.floor(rng() * 4),
    turnSign: rng() > 0.5 ? 1 : -1,
    mirrorH: rng() > 0.5,
    mirrorV: rng() > 0.5,
  };
}

/**
 * Fibonacci-length segments from `start`, winding according to `variant`.
 * Pass a number as 4th arg for legacy fixed maxCells + default winding.
 */
export function buildFibonacciSpiralPath(
  start: Cell,
  cols: number,
  rows: number,
  opts: number | SpiralVariant
): Cell[] {
  const variant: SpiralVariant =
    typeof opts === "number"
      ? defaultSpiralVariant(opts)
      : opts;
  const maxCells = Math.max(1, variant.maxCells);

  const baseDc = [1, 0, -1, 0];
  const baseDr = [0, 1, 0, -1];
  const dc: number[] = [0, 0, 0, 0];
  const dr: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const j = (((i + variant.dirOffset) % 4) + 4) % 4;
    dc[i] = baseDc[j]!;
    dr[i] = baseDr[j]!;
  }
  if (variant.mirrorH) {
    for (let i = 0; i < 4; i++) dc[i] = -dc[i]!;
  }
  if (variant.mirrorV) {
    for (let i = 0; i < 4; i++) dr[i] = -dr[i]!;
  }

  const path: Cell[] = [{ c: start.c, r: start.r }];
  const seen = new Set<string>([cellKey(start)]);
  let c = start.c;
  let r = start.r;
  let dir = 0;
  let seg = 0;
  const turn = variant.turnSign;

  while (path.length < maxCells && seg < 48) {
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
    dir = (dir + turn + 4) % 4;
    seg += 1;
  }
  return path;
}

/** Pixel position moving along the polyline of cell centers; `prog` in [0, path.length-1]. */
export function pathLerpPx(
  layout: VortexLayout,
  path: Cell[],
  prog: number
): { x: number; y: number } {
  if (path.length === 0) {
    return { x: layout.cx, y: layout.cy };
  }
  const maxIdx = path.length - 1;
  if (prog >= maxIdx) {
    return cellCenterPx(layout, path[maxIdx]!);
  }
  if (prog <= 0) {
    return cellCenterPx(layout, path[0]!);
  }
  const i = Math.floor(prog);
  const t = prog - i;
  const a = cellCenterPx(layout, path[i]!);
  const b = cellCenterPx(layout, path[Math.min(i + 1, maxIdx)]!);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Tangential launch speed (px/s) ≈ ωR, amplified. Optional mass scales like heavier rim → more oomph.
 * cells/s = v_px / cellSize.
 */
export function launchPathCellsPerSec(
  layout: VortexLayout,
  omegaRadPerSec: number,
  launchMul: number,
  massKg = 1
): number {
  const R = layout.R;
  const aC = omegaRadPerSec * omegaRadPerSec * R;
  const vTan = omegaRadPerSec * R * launchMul;
  const vPhys = Math.sqrt(vTan * vTan + (aC * R * 0.15 * massKg) / Math.max(0.35, massKg));
  return vPhys / layout.cellSize;
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
  /** Radians per second, clockwise (planning + released + attract). */
  spinRadPerSec: number;
  /** Ms after both exits chosen before release. */
  planningHoldMs: number;
  /** Upper bound when rolling random spirals (actual length is variant). */
  spiralMaxCells: number;
  /** Damage per trap trigger. */
  damageAmount: number;
  /** Match length excluding countdown (ms). */
  matchDurationMs: number;
  /** Multiplier on tangential launch (higher = faster along path). */
  launchVelocityMul: number;
  /** Nominal “rim” mass for launch feel (arbitrary units). */
  launchMassKg: number;
  /** Ms after launch before ATTRACT phase. */
  releasedToAttractMs: number;
  /** Ms to show ATTRACT before next planning round. */
  attractDurationMs: number;
};

export const DEFAULT_VORTEX_TUNING: VortexMapTuning = {
  circleFrac: 0.35,
  spinRadPerSec: 2.35,
  planningHoldMs: 5000,
  spiralMaxCells: 140,
  damageAmount: 1,
  matchDurationMs: 180_000,
  launchVelocityMul: 9,
  launchMassKg: 2.2,
  releasedToAttractMs: 5000,
  attractDurationMs: 1600,
};
