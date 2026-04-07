import type { AiPersonalityPreset } from "@locket/ai-brain";
import type {
  BulletLens,
  DamageZone,
  HealZone,
  MapConfig,
  ShieldPlacement,
} from "@/lib/mapConfig";
import { DANGER_ZONE_DRIFT_MAX } from "@/lib/gameConstants";

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Keep procedural stuff away from initial spawn band (player top, AI bottom). */
function clearOfSpawns(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  halfArenaW: number,
  halfArenaH: number
): boolean {
  if (
    Math.abs(cx) + halfW > halfArenaW - 8 ||
    Math.abs(cy) + halfH > halfArenaH - 8
  ) {
    return false;
  }
  const r2 = 115 * 115;
  if (dist2(cx, cy, 0, -halfArenaH * 0.82) < r2) return false;
  if (dist2(cx, cy, 0, halfArenaH * 0.82) < r2) return false;
  return true;
}

function generateStoneClusters(
  halfArenaW: number,
  halfArenaH: number,
  cell: number
): ShieldPlacement[] {
  const out: ShieldPlacement[] = [];
  const clusters = randInt(5, 10);
  const ixMax = Math.floor((halfArenaW - cell) / cell) - 1;
  const iyMax = Math.floor((halfArenaH - cell) / cell) - 1;
  const ixMin = -ixMax;

  for (let c = 0; c < clusters; c++) {
    const blocksInCluster = randInt(2, 4);
    let ix = randInt(ixMin + 1, ixMax - 1);
    let iy = randInt(-iyMax + 1, iyMax - 1);
    const used = new Set<string>();

    for (let b = 0; b < blocksInCluster; b++) {
      const key = `${ix},${iy}`;
      if (!used.has(key)) {
        used.add(key);
        const wx = ix * cell;
        const wy = iy * cell;
        if (clearOfSpawns(wx, wy, cell / 2, cell / 2, halfArenaW, halfArenaH)) {
          out.push({
            x: wx,
            y: wy,
            width: cell,
            height: cell,
            tint: "stone",
          });
        }
      }
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const d = dirs[randInt(0, 3)]!;
      ix += d[0];
      iy += d[1];
      ix = Math.max(ixMin, Math.min(ixMax, ix));
      iy = Math.max(-iyMax, Math.min(iyMax, iy));
    }
  }
  return out;
}

function tryLens(
  halfArenaW: number,
  halfArenaH: number
): BulletLens | null {
  const halfW = randInt(20, 38);
  const halfH = randInt(24, 48);
  const mult = randInt(2, 5) as 2 | 3 | 4 | 5;
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const [enx, eny] = dirs[randInt(0, 3)]!;

  for (let attempt = 0; attempt < 40; attempt++) {
    const xMin = -halfArenaW + halfW + 40;
    const xMax = halfArenaW - halfW - 40;
    const yMin = -halfArenaH + halfH + 40;
    const yMax = halfArenaH - halfH - 40;
    if (xMax < xMin || yMax < yMin) return null;
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    if (clearOfSpawns(x, y, halfW, halfH, halfArenaW, halfArenaH)) {
      return {
        x,
        y,
        halfWidth: halfW,
        halfHeight: halfH,
        enterNx: enx,
        enterNy: eny,
        multiplier: mult,
      };
    }
  }
  return null;
}

function tryHealZone(
  halfArenaW: number,
  halfArenaH: number
): HealZone | null {
  const halfW = randInt(38, 62);
  const halfH = randInt(32, 52);
  for (let attempt = 0; attempt < 35; attempt++) {
    const xMin = -halfArenaW + halfW + 24;
    const xMax = halfArenaW - halfW - 24;
    const yMin = -halfArenaH + halfH + 24;
    const yMax = halfArenaH - halfH - 24;
    if (xMax < xMin || yMax < yMin) return null;
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    if (clearOfSpawns(x, y, halfW, halfH, halfArenaW, halfArenaH)) {
      return { x, y, halfWidth: halfW, halfHeight: halfH };
    }
  }
  return null;
}

export type RolledMapFields = Pick<
  MapConfig,
  "damageZones" | "shields" | "healZone" | "bulletLens"
>;

/** Random AI tier, danger zones (with drift), stones, lens, heal zone. */
export function rollMatchSetup(
  halfWidth: number,
  halfHeight: number,
  placeCubeSize: number
): { aiPreset: AiPersonalityPreset; rolledMap: RolledMapFields } {
  const presets: AiPersonalityPreset[] = ["easy", "medium", "hard"];
  const aiPreset = presets[randInt(0, 2)]!;
  const count = randInt(1, 10);
  const zones: DamageZone[] = [];
  const edgePad = 28;
  const minHalf = 8;

  for (let i = 0; i < count; i++) {
    const maxHalfW = Math.floor(halfWidth - edgePad - minHalf);
    const maxHalfH = Math.floor(halfHeight - edgePad - minHalf);
    if (maxHalfW < minHalf || maxHalfH < minHalf) break;

    const halfWidthZ = randInt(minHalf, Math.min(maxHalfW, 95));
    const halfHeightZ = randInt(minHalf, Math.min(maxHalfH, 75));

    const xMin = -halfWidth + halfWidthZ + edgePad;
    const xMax = halfWidth - halfWidthZ - edgePad;
    const yMin = -halfHeight + halfHeightZ + edgePad;
    const yMax = halfHeight - halfHeightZ - edgePad;
    if (xMax < xMin || yMax < yMin) continue;

    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    const speed =
      (0.35 + Math.random() * 0.65) * DANGER_ZONE_DRIFT_MAX;
    const ang = Math.random() * Math.PI * 2;
    zones.push({
      x,
      y,
      halfWidth: halfWidthZ,
      halfHeight: halfHeightZ,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
    });
  }

  const stones = generateStoneClusters(halfWidth, halfHeight, placeCubeSize);
  const bulletLens = tryLens(halfWidth, halfHeight);
  const healZone = tryHealZone(halfWidth, halfHeight);

  return {
    aiPreset,
    rolledMap: {
      damageZones: zones,
      shields: stones,
      healZone,
      bulletLens,
    },
  };
}
