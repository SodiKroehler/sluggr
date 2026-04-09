import type { Cell } from "@locket/vortex-engine";

export type AiTrainingPreset = "easy" | "medium" | "hard";

export type VortexAiSnapshot = {
  tick: number;
  /** Ring cells the AI may choose as exit. */
  ringCellKeys: string[];
  aiExitChosen: boolean;
  playerExitChosen: boolean;
  /** Keys on player's highlighted path (for damage placement). */
  playerPathKeys: string[];
  aiDamageCount: number;
};

export type VortexAiIntent = {
  /** Pick this ring cell as AI exit (once). */
  pickExit: Cell | null;
  /** Mark a cell as AI damage tile (right-click analogue). */
  setDamageCell: Cell | null;
};

function pick<T>(arr: T[], rnd: () => number): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(rnd() * arr.length)]!;
}

function keyToCell(k: string): Cell {
  const [c, r] = k.split(",").map(Number);
  return { c: c!, r: r! };
}

/**
 * Pure: same snapshot + preset + rng → same intent.
 */
export function decideVortexAi(
  snapshot: VortexAiSnapshot,
  preset: AiTrainingPreset,
  rnd: () => number = Math.random
): VortexAiIntent {
  const ringCells = snapshot.ringCellKeys.map(keyToCell);

  if (!snapshot.aiExitChosen && ringCells.length > 0) {
    let delay = 45;
    if (preset === "medium") delay = 28;
    if (preset === "hard") delay = 12;
    if (snapshot.tick >= delay) {
      const cell = pick(ringCells, rnd);
      return { pickExit: cell, setDamageCell: null };
    }
  }

  if (snapshot.aiExitChosen && snapshot.playerPathKeys.length > 0) {
    const maxTraps = preset === "easy" ? 1 : preset === "medium" ? 2 : 3;
    if (snapshot.aiDamageCount < maxTraps && snapshot.tick % 22 === 7) {
      const k = pick(snapshot.playerPathKeys, rnd);
      if (k) return { pickExit: null, setDamageCell: keyToCell(k) };
    }
  }

  return { pickExit: null, setDamageCell: null };
}
