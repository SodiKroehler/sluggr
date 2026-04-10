export type AiTrainingPreset = "easy" | "medium" | "hard";

export type Vec2 = { x: number; y: number };

export type VortexAiSnapshot = {
  tick: number;
  /** AI has placed first point on circle. */
  aiCirclePlaced: boolean;
  /** AI is at a branch junction (needs W/A/S/D). */
  aiNeedsBranch: boolean;
  /** 0 = first 3-way (W/D/S), else 4-way. */
  aiBranchDepth: number;
};

export type VortexAiIntent = {
  /** Pick a point on AI-allowed semicircle (once). */
  pickCirclePoint: Vec2 | null;
  /** First-tier branch. */
  pickBranchFirst: "w" | "d" | "s" | null;
  /** Four-way branch. */
  pickBranchFour: "w" | "a" | "s" | "d" | null;
  /** Mark attack at current junction. */
  addAttackAtJunction: boolean;
};

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

/**
 * Pure: same snapshot + preset + rng → same intent.
 */
export function decideVortexAi(
  snapshot: VortexAiSnapshot,
  preset: AiTrainingPreset,
  rnd: () => number = Math.random
): VortexAiIntent {
  const none = (): VortexAiIntent => ({
    pickCirclePoint: null,
    pickBranchFirst: null,
    pickBranchFour: null,
    addAttackAtJunction: false,
  });

  if (!snapshot.aiCirclePlaced) {
    let delay = 110;
    if (preset === "medium") delay = 72;
    if (preset === "hard") delay = 38;
    if (snapshot.tick < delay) return none();
    const t = rnd() * Math.PI - Math.PI / 2;
    const x = -Math.cos(t) * 0.85;
    const y = Math.sin(t) * 0.95;
    return {
      pickCirclePoint: { x, y },
      pickBranchFirst: null,
      pickBranchFour: null,
      addAttackAtJunction: false,
    };
  }

  if (snapshot.aiNeedsBranch) {
    if (snapshot.aiBranchDepth === 0) {
      const keys = ["w", "d", "s"] as const;
      if (snapshot.tick % 22 !== 0) return none();
      return {
        pickCirclePoint: null,
        pickBranchFirst: pick(keys, rnd),
        pickBranchFour: null,
        addAttackAtJunction: rnd() < (preset === "hard" ? 0.22 : 0.12),
      };
    }
    const keys4 = ["w", "a", "s", "d"] as const;
    if (snapshot.tick % 20 !== 0) return none();
    return {
      pickCirclePoint: null,
      pickBranchFirst: null,
      pickBranchFour: pick(keys4, rnd),
      addAttackAtJunction: rnd() < (preset === "hard" ? 0.2 : 0.1),
    };
  }

  return none();
}
