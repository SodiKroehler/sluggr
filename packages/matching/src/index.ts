/**
 * Matchmaking facade. v1: random offline AI preset only.
 * Later: resolve human opponents from token pool / presence (no implementation yet).
 */

export type AiTrainingPreset = "easy" | "medium" | "hard";

export type MatchOpponent =
  | {
      source: "ai_training";
      preset: AiTrainingPreset;
    };

export type PickOpponentOptions = {
  /** Inject RNG for tests; defaults to Math.random. */
  random?: () => number;
};

const PRESETS: readonly AiTrainingPreset[] = ["easy", "medium", "hard"];

/**
 * Selects who you fight this session. Pure aside from calling `random`.
 */
export function pickOpponent(options?: PickOpponentOptions): MatchOpponent {
  const rnd = options?.random ?? Math.random;
  const i = Math.min(PRESETS.length - 1, Math.floor(rnd() * PRESETS.length));
  return { source: "ai_training", preset: PRESETS[i]! };
}
