/** Movement + knife combat tuning. */
export type CombatConfig = {
  moveForce: number;
  jumpImpulse: number;
  knife: {
    /** Blade reach from square edge when stowed (world units). */
    retractLength: number;
    /** Blade reach from square edge when fully extended. */
    extendLength: number;
    extendDurationMs: number;
    cooldownMs: number;
    tipHitRadius: number;
    damage: number;
  };
};

export const DEFAULT_COMBAT: CombatConfig = {
  moveForce: 0.0026,
  jumpImpulse: 0.062,
  knife: {
    retractLength: 5,
    extendLength: 44,
    extendDurationMs: 140,
    cooldownMs: 520,
    tipHitRadius: 14,
    damage: 1,
  },
};
