/** Movement + combat tuning (knife retained for future; gun is active). */
export type CombatConfig = {
  moveForce: number;
  jumpImpulse: number;
  knife: {
    retractLength: number;
    extendLength: number;
    extendDurationMs: number;
    cooldownMs: number;
    tipHitRadius: number;
    damage: number;
  };
  gun: {
    cooldownMs: number;
    /** World units per second. */
    bulletSpeed: number;
    bulletRadius: number;
    damage: number;
    /** Line extends this far past the square edge along aim (world units). */
    barrelPastEdge: number;
  };
};

export const DEFAULT_COMBAT: CombatConfig = {
  moveForce: 0.0012,
  jumpImpulse: 0.062,
  knife: {
    retractLength: 5,
    extendLength: 44,
    extendDurationMs: 140,
    cooldownMs: 520,
    tipHitRadius: 14,
    damage: 1,
  },
  gun: {
    cooldownMs: 280,
    bulletSpeed: 140,
    bulletRadius: 3.2,
    damage: 1,
    barrelPastEdge: 10,
  },
};
