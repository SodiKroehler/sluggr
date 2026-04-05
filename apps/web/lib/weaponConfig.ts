/** Attack behaviour is data-driven for future weapon types. */
export type LungeWeaponConfig = {
  type: "lunge";
  /** Continuous movement force coefficient (scaled by mass in game loop). */
  moveForce: number;
  /** Single-frame upward (-Y) impulse coefficient. */
  jumpImpulse: number;
  /** Extra forward impulse per frame while lunge is active. */
  lungeImpulse: number;
  lungeDurationMs: number;
  cooldownMs: number;
  /** Hit radius from tip vs opponent centroid (world units). */
  hitRadius: number;
  damage: number;
};

export const DEFAULT_TRIANGLE_WEAPON: LungeWeaponConfig = {
  type: "lunge",
  moveForce: 0.00115,
  jumpImpulse: 0.052,
  lungeImpulse: 0.0024,
  lungeDurationMs: 220,
  cooldownMs: 650,
  hitRadius: 36,
  damage: 1,
};
