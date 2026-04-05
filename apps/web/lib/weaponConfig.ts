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
    /** Muzzle ahead of gun base along aim (world units). */
    muzzleForward: number;
    /** Short barrel line length in world units. */
    barrelLength: number;
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
    bulletSpeed: 520,
    bulletRadius: 3.2,
    damage: 1,
    muzzleForward: 10,
    barrelLength: 9,
  },
};
