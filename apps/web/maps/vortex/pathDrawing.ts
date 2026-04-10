/**
 * Vortex map — segment-based paths during planning (other maps supply their own module).
 */

import type { VortexLayout } from "@locket/vortex-engine";

export type Vec2 = { x: number; y: number };

/** Length of each straight segment (px). */
export const SEGMENT_UNIT_PX = 100;

/** Proximity for player vs AI attack dots (px). */
export const ATTACK_RADIUS = 32;

/** First-tier W/S curve: rotate tangent by ± this (rad). */
export const FIB_TURN_FIRST_RAD = 0.2;

/** Second-tier W (more curve) / S (down). */
export const FIB_TURN_MORE_RAD = 0.32;

export const PAUSE_AT_ATTACK_MS = 420;

export const SHOCKWAVE_DURATION_MS = 380;

export const SHOCKWAVE_MAX_RADIUS_PX = 52;

export const JADE_STROKE_PX = 5;

export const CANDIDATE_STROKE_PX = 2;

const JADE = "rgba(45, 140, 110, 0.95)";

export type BranchFirst = "w" | "d" | "s";

export type BranchFour = "w" | "a" | "s" | "d";

function len(x: number, y: number): number {
  return Math.hypot(x, y) || 1;
}

function normalize(v: Vec2): Vec2 {
  const l = len(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
}

/** Clockwise tangent on the arena circle at point P (screen coords, y down). */
export function cwTangentOnCircle(p: Vec2, center: Vec2): Vec2 {
  const ux = p.x - center.x;
  const uy = p.y - center.y;
  return normalize({ x: uy, y: -ux });
}

export function rotate2(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Snap pointer onto the ring; null if not near stroke. */
export function projectOntoCircle(
  px: number,
  py: number,
  layout: VortexLayout,
  bandPx: number
): Vec2 | null {
  const { cx, cy, R } = layout;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return null;
  if (Math.abs(d - R) > bandPx) return null;
  return {
    x: cx + (dx / d) * R,
    y: cy + (dy / d) * R,
  };
}

/**
 * Player (bottom): may only start on the **right** semicircle (x > center).
 * AI (top): flipped — **left** semicircle (x < center).
 */
export function isValidCircleStart(
  p: Vec2,
  layout: VortexLayout,
  side: "player" | "ai",
  marginPx = 4
): boolean {
  if (side === "player") return p.x > layout.cx + marginPx;
  return p.x < layout.cx - marginPx;
}

/** Endpoints of the first 3-way from a point on the ring. */
export function firstTierEndpoints(
  start: Vec2,
  tangent: Vec2,
  L: number
): Record<BranchFirst, Vec2> {
  const t = normalize(tangent);
  const up = normalize(rotate2(t, -FIB_TURN_FIRST_RAD));
  const down = normalize(rotate2(t, FIB_TURN_FIRST_RAD));
  return {
    w: add(start, scale(up, L)),
    d: add(start, scale(t, L)),
    s: add(start, scale(down, L)),
  };
}

/**
 * Four candidates from an interior junction.
 * `incoming` = unit vector from previous vertex toward junction.
 */
export function fourTierEndpoints(
  junction: Vec2,
  incoming: Vec2,
  L: number
): Record<BranchFour, Vec2> {
  const inU = normalize(incoming);
  const w = normalize(rotate2(inU, -FIB_TURN_MORE_RAD));
  const s = normalize(rotate2(inU, FIB_TURN_MORE_RAD));
  return {
    w: add(junction, scale(w, L)),
    a: add(junction, { x: -L, y: 0 }),
    s: add(junction, scale(s, L)),
    d: add(junction, { x: L, y: 0 }),
  };
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function polylineCumulativeLengths(points: Vec2[]): {
  cum: number[];
  total: number;
} {
  if (points.length === 0) return { cum: [0], total: 0 };
  const cum: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(
      points[i + 1]!.x - points[i]!.x,
      points[i + 1]!.y - points[i]!.y
    );
    cum.push(cum[i]! + d);
  }
  return { cum, total: cum[cum.length - 1]! };
}

export function positionAtArcLength(
  points: Vec2[],
  cum: number[],
  s: number
): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || s <= 0) return { ...points[0]! };
  const total = cum[cum.length - 1]!;
  if (s >= total) return { ...points[points.length - 1]! };
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1]! < s) i++;
  const s0 = cum[i]!;
  const s1 = cum[i + 1]!;
  const a = points[i]!;
  const b = points[i + 1]!;
  const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Which vertex index we're past (for attack / vertex events). */
export function vertexIndexAtArcLength(cum: number[], s: number): number {
  if (cum.length < 2) return 0;
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1]! <= s) i++;
  return i;
}

/** Straight polyline stroke (exact path). */
export function strokePolylineExact(
  ctx: CanvasRenderingContext2D,
  points: Vec2[],
  options: { strokePx: number; color: string; glow?: boolean }
): void {
  if (points.length < 2) return;
  const { strokePx, color, glow } = options;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (glow) {
    ctx.shadowColor = "rgba(45, 200, 150, 0.55)";
    ctx.shadowBlur = 14;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = strokePx;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.stroke();
  if (glow) {
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

export function strokeCandidateBranches(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  ends: Vec2[],
  color = "rgba(90, 90, 110, 0.45)"
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = CANDIDATE_STROKE_PX;
  ctx.lineCap = "round";
  for (const e of ends) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawAttackDot(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  color: string,
  r = 4
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawShockwave(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  t01: number,
  maxR: number
): void {
  const r = t01 * maxR;
  const alpha = (1 - t01) * 0.45;
  ctx.save();
  ctx.strokeStyle = `rgba(45, 160, 120, ${alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export type SplatterBlob = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  fill: string;
};

/** Irregular paint splatter; call once per hit, draw every frame with drawSplatterBlobs. */
export function createRandomSplatter(cx: number, cy: number): SplatterBlob[] {
  const baseHue = Math.random() * 360;
  const n = 7 + Math.floor(Math.random() * 7);
  const out: SplatterBlob[] = [];
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * 24;
    const dh = (Math.random() - 0.5) * 50;
    const alpha = 0.32 + Math.random() * 0.38;
    out.push({
      x: cx + Math.cos(ang) * dist,
      y: cy + Math.sin(ang) * dist,
      rx: 4 + Math.random() * 18,
      ry: 3 + Math.random() * 14,
      rot: Math.random() * Math.PI,
      fill: `hsla(${(baseHue + dh + 360) % 360}, 70%, 48%, ${alpha})`,
    });
  }
  return out;
}

export function drawSplatterBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: readonly SplatterBlob[]
): void {
  if (blobs.length === 0) return;
  ctx.save();
  for (const b of blobs) {
    ctx.fillStyle = b.fill;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.rx, b.ry, b.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function randomFrozenPathColor(): string {
  const h = Math.floor(Math.random() * 360);
  return `hsla(${h}, 52%, 48%, 0.24)`;
}

export { JADE };
