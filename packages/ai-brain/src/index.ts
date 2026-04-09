export type Vec2 = { x: number; y: number };

/** Read-only snapshot; no DOM, canvas, or IO. */
export type GameSnapshot = {
  tick: number;
  dtMs: number;
  arenaHalfWidth: number;
  arenaHalfHeight: number;
  self: {
    position: Vec2;
    angle: number;
    velocity: Vec2;
  };
  opponent: {
    position: Vec2;
    angle: number;
    velocity: Vec2;
  };
  selfHp: number;
  opponentHp: number;
  timeLeftSec: number;
  /** True while human's knife swing is active (hard AI dodge / punish). */
  opponentKnifeExtended: boolean;
  /** Seconds since human knife swing ended. */
  opponentKnifeRecoverySec: number;
};

export type AiIntent = {
  moveX: number;
  moveY: number;
  jump: boolean;
  attack: boolean;
};

export type AiPersonalityPreset = "easy" | "medium" | "hard";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function norm(v: Vec2): Vec2 {
  const l = len(v);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Pure decision function: maps a game snapshot to normalized intent.
 * No side effects, no non-determinism beyond Math (same inputs → same outputs).
 */
export function decideAiAction(
  snapshot: GameSnapshot,
  preset: AiPersonalityPreset
): AiIntent {
  const { self, opponent } = snapshot;
  const toOpp = {
    x: opponent.position.x - self.position.x,
    y: opponent.position.y - self.position.y,
  };
  const dist = len(toOpp);
  const dirToOpp = norm(toOpp);

  const forward = { x: Math.cos(self.angle), y: Math.sin(self.angle) };
  const right = { x: -forward.y, y: forward.x };

  const wanderX = Math.sin(snapshot.tick * 0.02 + snapshot.selfHp * 0.1);
  const wanderY = Math.cos(snapshot.tick * 0.017 + snapshot.opponentHp * 0.07);

  if (preset === "easy") {
    const chase = dist > 200 ? 0.35 : dist > 120 ? 0.12 : 0;
    const mx = clamp(wanderX * 0.75 + dirToOpp.x * chase, -1, 1);
    const my = clamp(wanderY * 0.75 + dirToOpp.y * chase, -1, 1);
    const aimOk = dot(forward, dirToOpp) > 0.35;
    const attack =
      dist < 260 &&
      aimOk &&
      (snapshot.tick % 55 === 0 || (dist < 160 && snapshot.tick % 28 === 0));
    return {
      moveX: mx,
      moveY: my,
      jump: dist < 120 && snapshot.tick % 200 === 17,
      attack,
    };
  }

  if (preset === "medium") {
    const ideal = 240;
    let mx = dirToOpp.x;
    let my = dirToOpp.y;
    if (dist < ideal - 50) {
      mx = -dirToOpp.x * 0.75;
      my = -dirToOpp.y * 0.75;
    } else if (dist > ideal + 70) {
      mx = dirToOpp.x;
      my = dirToOpp.y;
    } else {
      const s = 0.42;
      const side = wanderX >= 0 ? 1 : -1;
      mx = right.x * s * side + dirToOpp.x * 0.15;
      my = right.y * s * side + dirToOpp.y * 0.15;
    }
    mx = clamp(mx, -1, 1);
    my = clamp(my, -1, 1);
    const aim = dot(forward, dirToOpp);
    const attack =
      dist < 300 &&
      (aim > 0.42 || (dist < 200 && aim > 0.28 && snapshot.tick % 6 === 0));
    return {
      moveX: mx,
      moveY: my,
      jump: dist < 140 && snapshot.tick % 48 === 0,
      attack,
    };
  }

  const aimScore = dot(forward, dirToOpp);
  let mx = dirToOpp.x;
  let my = dirToOpp.y;
  if (snapshot.opponentKnifeExtended && aimScore < 0.22) {
    const perp = { x: -dirToOpp.y, y: dirToOpp.x };
    const dodge = snapshot.tick % 2 === 0 ? 1 : -1;
    mx = clamp(perp.x * dodge, -1, 1);
    my = clamp(perp.y * dodge, -1, 1);
  } else if (
    snapshot.opponentKnifeRecoverySec > 0 &&
    snapshot.opponentKnifeRecoverySec < 0.5 &&
    dist < 320
  ) {
    mx = dirToOpp.x;
    my = dirToOpp.y;
  } else if (dist < 90) {
    const back = { x: -dirToOpp.x, y: -dirToOpp.y };
    mx = back.x * 0.92;
    my = back.y * 0.92;
  } else if (dist > 260) {
    mx = dirToOpp.x * 1;
    my = dirToOpp.y * 1;
  }

  mx = clamp(mx, -1, 1);
  my = clamp(my, -1, 1);

  const punishWindow =
    snapshot.opponentKnifeRecoverySec > 0.04 &&
    snapshot.opponentKnifeRecoverySec < 0.42;
  const spray =
    dist < 360 &&
    aimScore > 0.38 &&
    snapshot.tick % 5 === 0 &&
    snapshot.tick % 11 !== 0;
  const attack =
    (dist < 260 && aimScore > 0.52) ||
    (punishWindow && dist < 280) ||
    (dist < 340 && aimScore > 0.72) ||
    spray;

  return {
    moveX: mx,
    moveY: my,
    jump:
      snapshot.opponentKnifeExtended &&
      dist < 220 &&
      aimScore > 0.35 &&
      snapshot.tick % 3 === 0,
    attack,
  };
}
