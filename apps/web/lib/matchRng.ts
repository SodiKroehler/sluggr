import type { AiPersonalityPreset } from "@locket/ai-brain";
import type { DamageZone } from "@/lib/mapConfig";

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Random AI tier + 1–10 danger rectangles with varied sizes (world space). */
export function rollMatchSetup(
  halfWidth: number,
  halfHeight: number
): { aiPreset: AiPersonalityPreset; damageZones: DamageZone[] } {
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
    zones.push({
      x,
      y,
      halfWidth: halfWidthZ,
      halfHeight: halfHeightZ,
    });
  }

  return { aiPreset, damageZones: zones };
}
