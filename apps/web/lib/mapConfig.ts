/** Additive map descriptor; v1 uses a single arena with shovable shields. */
export type ShieldPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

export type MapConfig = {
  id: string;
  halfWidth: number;
  halfHeight: number;
  floorColor: string;
  triangleRadius: number;
  shields: ShieldPlacement[];
};

export const DEFAULT_MAP: MapConfig = {
  id: "sluggr-void-v1",
  halfWidth: 520,
  halfHeight: 320,
  floorColor: "#e8eee8",
  triangleRadius: 28,
  shields: [
    { x: -150, y: 0, width: 26, height: 96, angle: 0 },
    { x: 150, y: 0, width: 26, height: 96, angle: 0 },
  ],
};
