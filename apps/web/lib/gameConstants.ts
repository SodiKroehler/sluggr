/**
 * Central place for **session / phase** timings used by VortexCanvas.
 *
 * Other tunables live in:
 * - `apps/web/maps/vortex/pathDrawing.ts` — segment length, attack radius, jade stroke,
 *   pause/shockwave, Fibonacci turn angles
 * - `apps/web/components/VortexCanvas.tsx` — HP, damage cooldown, hit radii, UI timings
 * - `apps/web/lib/mapRegistry.ts` — per-map `tuning` from `@locket/vortex-engine` (spin rate,
 *   planning hold, match length, launch feel, etc.)
 */

/** Full match length after countdown (ms). Should match map `tuning.matchDurationMs` unless you change both. */
export const SESSION_DURATION_MS = 180_000;

/** Pre-round countdown 5 → 1 (ms). */
export const ARENA_COUNTDOWN_MS = 5000;

/** After planning ends: how long the RELEASE run lasts before ATTRACT (ms). */
export const RELEASE_PHASE_MS = 4_500;

/** How long ATTRACT lasts before the next planning round (ms). */
export const ATTRACT_PHASE_MS = 12_000;
