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
    /** Physics / draw radius (bounces). */
    bulletRadius: number;
    /** Damage test radius (can be larger than physics to reduce tunneling). */
    hitRadius: number;
    damage: number;
    /** Line extends this far past the square edge along aim (world units). */
    barrelPastEdge: number;
  };
};

export const DEFAULT_COMBAT: CombatConfig = {
  moveForce: 0.00038,
  jumpImpulse: 0.028,
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
    bulletSpeed: 72,
    bulletRadius: 3.2,
    hitRadius: 6.5,
    damage: 0.5,
    barrelPastEdge: 10,
  },
};
