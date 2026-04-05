/** Additive map descriptor; v1 uses a single void arena. */
export type MapConfig = {
  id: string;
  halfWidth: number;
  halfHeight: number;
  floorColor: string;
  triangleRadius: number;
};

export const DEFAULT_MAP: MapConfig = {
  id: "void-cream-v1",
  halfWidth: 520,
  halfHeight: 320,
  floorColor: "#FAF7F2",
  triangleRadius: 28,
};
