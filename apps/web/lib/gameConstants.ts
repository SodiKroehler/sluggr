/** Full match length (ms). Bump for production; keep low for iteration. */
export const SESSION_DURATION_MS = 180_000;

/** Scales horizontal movement force (WASD / AI). */
export const MOVE_SPEED_MULTIPLIER = 1;

/** Scales bullet world speed from weapon config. */
export const PROJECTILE_SPEED_MULTIPLIER = 1;

/** Damage tick interval while standing in red danger zones (ms). */
export const DANGER_ZONE_DAMAGE_INTERVAL_MS = 1000;

/** HP restored while in blue heal zone (ms between +1). */
export const HEAL_ZONE_INTERVAL_MS = 5000;

/** Red zone drift speed (world units / second, axis-aligned bounce in arena). */
export const DANGER_ZONE_DRIFT_MAX = 22;

/** AI uses this fraction of the human gun cooldown between shots. */
export const AI_FIRE_COOLDOWN_FRACTION = 0.32;

/** Bullet speed multiplier after passing through the damage lens (0–1). */
export const LENS_PASS_SPEED_MULT = 0.52;
