/** Additive map descriptor; optional static shields + player-placed cubes. */
export type ShieldPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  /** Procedural stone clusters: draw dark gray. */
  tint?: "stone";
};

/** Axis-aligned hazard in world space; damage rules handled in game layer. */
export type DamageZone = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  /** World units/sec; when set, zone moves and bounces in the arena (runtime). */
  vx?: number;
  vy?: number;
};

/** Single healing overlay (like danger zones). */
export type HealZone = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
};

/**
 * One-way bullet lens (no physics body). Bullets with v·enterNormal > 0 pass
 * through (slowed); otherwise they bounce off the AABB in the game layer.
 */
export type BulletLens = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  /** Unit vector: allowed pass direction (bullet velocity must align). */
  enterNx: number;
  enterNy: number;
  multiplier: 2 | 3 | 4 | 5;
};

export type MapConfig = {
  id: string;
  halfWidth: number;
  halfHeight: number;
  floorColor: string;
  squareSize: number;
  shields: ShieldPlacement[];
  /** Hazard rectangles (can overlap); empty = none. */
  damageZones: DamageZone[];
  /** Optional blue overlay: +1 HP on interval while inside. */
  healZone: HealZone | null;
  /** At most one: damage multiplier when bullet passes through correct face. */
  bulletLens: BulletLens | null;
  /** Grid step and side length for player-placed blocks (snapped to player). */
  placeCubeSize: number;
};

export const DEFAULT_MAP: MapConfig = {
  id: "sluggr-void-v1",
  halfWidth: 520,
  halfHeight: 320,
  floorColor: "#e8eee8",
  squareSize: 34,
  shields: [],
  damageZones: [],
  healZone: null,
  bulletLens: null,
  placeCubeSize: 30,
};
