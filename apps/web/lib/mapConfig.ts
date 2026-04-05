/** Additive map descriptor; optional static shields + player-placed cubes. */
export type ShieldPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

/** Axis-aligned hazard in world space; damage rules handled in game layer. */
export type DamageZone = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
};

export type MapConfig = {
  id: string;
  halfWidth: number;
  halfHeight: number;
  floorColor: string;
  squareSize: number;
  shields: ShieldPlacement[];
  damageZone: DamageZone | null;
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
  damageZone: { x: 0, y: 0, halfWidth: 22, halfHeight: 18 },
  placeCubeSize: 30,
};
