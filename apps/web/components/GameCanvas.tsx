"use client";

import { createSimulation } from "@locket/physics-engine";
import {
  decideAiAction,
  type AiPersonalityPreset,
  type GameSnapshot,
} from "@locket/ai-brain";
import { useCallback, useEffect, useRef } from "react";
import {
  AI_FIRE_COOLDOWN_FRACTION,
  DANGER_ZONE_DAMAGE_INTERVAL_MS,
  HEAL_ZONE_INTERVAL_MS,
  LENS_PASS_SPEED_MULT,
  MOVE_SPEED_MULTIPLIER,
  PROJECTILE_SPEED_MULTIPLIER,
  SESSION_DURATION_MS,
} from "@/lib/gameConstants";
import type { BulletLens, MapConfig } from "@/lib/mapConfig";
import type { CombatConfig } from "@/lib/weaponConfig";

type PhysBody = {
  id: string;
  label: "player" | "ai" | "floor" | "shield" | "bullet";
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  vertices: { x: number; y: number }[];
  bulletOwner?: "player" | "ai";
  damageMul?: number;
};

const MAX_HP = 10;
const DAMAGE_FLASH_MS = 140;

/** Circle vs actor square (center px,py, half-edge, rotation); used for bullet hits. */
function circleHitsRotatedSquare(
  bx: number,
  by: number,
  br: number,
  px: number,
  py: number,
  half: number,
  angle: number
): boolean {
  const dx = bx - px;
  const dy = by - py;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const qx = Math.max(-half, Math.min(half, lx));
  const qy = Math.max(-half, Math.min(half, ly));
  const ex = lx - qx;
  const ey = ly - qy;
  return ex * ex + ey * ey <= br * br + 1e-4;
}

/** Swept bullet (segment) vs full square hitbox (half = half-edge of actor). */
function segmentHitsRotatedSquare(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  br: number,
  px: number,
  py: number,
  half: number,
  angle: number
): boolean {
  const segLen = Math.hypot(x1 - x0, y1 - y0);
  const spacing = Math.max(br * 0.35, 1.25);
  const steps = Math.min(28, Math.max(1, Math.ceil(segLen / spacing)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = x0 + (x1 - x0) * t;
    const by = y0 + (y1 - y0) * t;
    if (circleHitsRotatedSquare(bx, by, br, px, py, half, angle)) return true;
  }
  return false;
}

/** Gun: line from square center through front face, `pastEdge` beyond edge; muzzle past tip for spawn. */
function gunMuzzle(
  b: PhysBody,
  squareHalf: number,
  pastEdge: number,
  bulletRadius: number
) {
  const fx = Math.cos(b.angle);
  const fy = Math.sin(b.angle);
  const tipDist = squareHalf + pastEdge;
  const tipX = b.x + fx * tipDist;
  const tipY = b.y + fy * tipDist;
  const spawnDist = tipDist + bulletRadius + 1.5;
  const mx = b.x + fx * spawnDist;
  const my = b.y + fy * spawnDist;
  return { cx: b.x, cy: b.y, tipX, tipY, mx, my, fx, fy };
}

const PLAYER_BLOCK_FILL_START: [number, number, number] = [47, 122, 85];
const PLAYER_BLOCK_STROKE_START: [number, number, number] = [30, 74, 50];
const PLAYER_BLOCK_FILL_END: [number, number, number] = [210, 214, 210];
const PLAYER_BLOCK_STROKE_END: [number, number, number] = [175, 180, 175];
const PLACED_BLOCK_COLOR_MS = 1000;

function lerpByte(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function lerpRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number
) {
  return `rgb(${lerpByte(from[0], to[0], t)},${lerpByte(from[1], to[1], t)},${lerpByte(from[2], to[2], t)})`;
}

/** Closest place-cube grid cell center to the player (grid step = cell). */
function snapPlaceGridCenter(
  playerX: number,
  playerY: number,
  cell: number
): { x: number; y: number } {
  return {
    x: Math.round(playerX / cell) * cell,
    y: Math.round(playerY / cell) * cell,
  };
}

function pointInAnyDamageZone(
  px: number,
  py: number,
  zones: { x: number; y: number; halfWidth: number; halfHeight: number }[]
): boolean {
  for (const z of zones) {
    if (
      Math.abs(px - z.x) <= z.halfWidth &&
      Math.abs(py - z.y) <= z.halfHeight
    ) {
      return true;
    }
  }
  return false;
}

function pointInHealZone(
  px: number,
  py: number,
  hz: { x: number; y: number; halfWidth: number; halfHeight: number }
): boolean {
  return (
    Math.abs(px - hz.x) <= hz.halfWidth &&
    Math.abs(py - hz.y) <= hz.halfHeight
  );
}

function circleIntersectsLensAabb(
  bx: number,
  by: number,
  br: number,
  lens: BulletLens
): boolean {
  const dx = Math.max(Math.abs(bx - lens.x) - lens.halfWidth, 0);
  const dy = Math.max(Math.abs(by - lens.y) - lens.halfHeight, 0);
  return dx * dx + dy * dy < br * br - 1e-4;
}

function aiSquareColors(
  preset: AiPersonalityPreset,
  hitFlash: boolean
): { fill: string; stroke: string } {
  if (hitFlash) return { fill: "#d04545", stroke: "#7a1818" };
  switch (preset) {
    case "easy":
      return { fill: "#2f7a55", stroke: "#1e4a32" };
    case "medium":
      return { fill: "#d4b429", stroke: "#8f7a12" };
    case "hard":
      return { fill: "#c42a2a", stroke: "#7a1010" };
  }
}

export type SessionFinish = {
  reason: "hp" | "time";
  winner: "player" | "ai" | "draw";
  playerHp: number;
  aiHp: number;
};

type Props = {
  mapConfig: MapConfig;
  weaponConfig: CombatConfig;
  aiPreset: AiPersonalityPreset;
  onSessionEnd: (result: SessionFinish) => void;
};

export function GameCanvas({
  mapConfig,
  weaponConfig,
  aiPreset,
  onSessionEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const endedRef = useRef(false);
  const keysRef = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
  });
  const jumpConsumedRef = useRef(false);
  const fireTriggerRef = useRef(false);
  const mouseScreenRef = useRef({ x: 0, y: 0 });
  const placeBlockTriggerRef = useRef(false);
  const aiAttackHeldRef = useRef(false);

  const finishOnce = useCallback(
    (result: SessionFinish) => {
      if (endedRef.current) return;
      endedRef.current = true;
      onSessionEnd(result);
    },
    [onSessionEnd]
  );

  useEffect(() => {
    const surface = canvasRef.current;
    if (!surface) return;
    const canvasHost: HTMLCanvasElement = surface;

    const ctxRaw = canvasHost.getContext("2d");
    if (!ctxRaw) return;
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const hh = mapConfig.halfHeight;
    const inset = mapConfig.squareSize * 0.75;

    endedRef.current = false;
    const sim = createSimulation({
      halfWidth: mapConfig.halfWidth,
      halfHeight: mapConfig.halfHeight,
      squareSize: mapConfig.squareSize,
      player: { x: 0, y: -hh + inset, angle: Math.PI / 2 },
      ai: { x: 0, y: hh - inset, angle: -Math.PI / 2 },
      shields: mapConfig.shields,
      frictionAir: 0.014,
    });

    const stoneCenterKeys = new Set<string>();
    for (const s of mapConfig.shields) {
      if (s.tint === "stone") {
        stoneCenterKeys.add(`${Math.round(s.x)},${Math.round(s.y)}`);
      }
    }

    type DzRun = {
      x: number;
      y: number;
      halfWidth: number;
      halfHeight: number;
      vx: number;
      vy: number;
    };
    const dzRun: DzRun[] = mapConfig.damageZones.map((z) => ({
      x: z.x,
      y: z.y,
      halfWidth: z.halfWidth,
      halfHeight: z.halfHeight,
      vx: z.vx ?? 0,
      vy: z.vy ?? 0,
    }));
    const lensWasInside = new Map<string, boolean>();

    const gcfg = weaponConfig.gun;
    const squareHalf = mapConfig.squareSize / 2;

    let playerHp = MAX_HP;
    let aiHp = MAX_HP;
    const sessionStart = performance.now();
    let playerGunReadyAt = 0;
    let aiGunReadyAt = 0;
    let tick = 0;
    let playerWasInDz = false;
    let aiWasInDz = false;
    let lastPlayerDzDamageAt = 0;
    let lastAiDzDamageAt = 0;
    let playerWasInHeal = false;
    let aiWasInHeal = false;
    let lastPlayerHealAt = 0;
    let lastAiHealAt = 0;
    let raf = 0;
    let lastTs = performance.now();
    const playerPlacedBlockSpawnMs = new Map<string, number>();
    const curedPlacedBlockIds = new Set<string>();
    let playerDamageFlashUntil = 0;
    let aiDamageFlashUntil = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const keys = keysRef.current;
      if (e.code === "KeyW") keys.w = true;
      if (e.code === "KeyA") keys.a = true;
      if (e.code === "KeyS") keys.s = true;
      if (e.code === "KeyD") keys.d = true;
      if (e.code === "Space") {
        e.preventDefault();
        keys.space = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const keys = keysRef.current;
      if (e.code === "KeyW") keys.w = false;
      if (e.code === "KeyA") keys.a = false;
      if (e.code === "KeyS") keys.s = false;
      if (e.code === "KeyD") keys.d = false;
      if (e.code === "Space") keys.space = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) fireTriggerRef.current = true;
    };
    const onCanvasMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        placeBlockTriggerRef.current = true;
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvasHost.getBoundingClientRect();
      mouseScreenRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    canvasHost.addEventListener("mousedown", onCanvasMouseDown);
    canvasHost.addEventListener("contextmenu", onContextMenu);

    const resize = () => {
      const parent = canvasHost.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvasHost.width = Math.floor(w * dpr);
      canvasHost.height = Math.floor(h * dpr);
      canvasHost.style.width = `${w}px`;
      canvasHost.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvasHost.parentElement!);

    function frame(ts: number) {
      if (endedRef.current) return;
      const nowWall = performance.now();
      const elapsedSession = nowWall - sessionStart;
      const timeLeftSec = Math.max(0, (SESSION_DURATION_MS - elapsedSession) / 1000);
      const dtMs = Math.min(ts - lastTs, 32);
      lastTs = ts;

      const dtSec = dtMs / 1000;
      const arenaHw = mapConfig.halfWidth;
      const arenaHh = mapConfig.halfHeight;
      const zpad = 2;
      for (const z of dzRun) {
        z.x += z.vx * dtSec;
        z.y += z.vy * dtSec;
        if (z.x - z.halfWidth < -arenaHw + zpad) {
          z.x = -arenaHw + zpad + z.halfWidth;
          z.vx *= -1;
        }
        if (z.x + z.halfWidth > arenaHw - zpad) {
          z.x = arenaHw - zpad - z.halfWidth;
          z.vx *= -1;
        }
        if (z.y - z.halfHeight < -arenaHh + zpad) {
          z.y = -arenaHh + zpad + z.halfHeight;
          z.vy *= -1;
        }
        if (z.y + z.halfHeight > arenaHh - zpad) {
          z.y = arenaHh - zpad - z.halfHeight;
          z.vy *= -1;
        }
      }

      const bodies = sim.getBodies() as PhysBody[];
      const player = bodies.find((b) => b.label === "player");
      const aiBody = bodies.find((b) => b.label === "ai");
      if (!player || !aiBody) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const now = performance.now();
      const w = canvasHost.clientWidth;
      const h = canvasHost.clientHeight;
      const scale = Math.min(
        w / (mapConfig.halfWidth * 2.1),
        h / (mapConfig.halfHeight * 2.1)
      );
      const cx = w / 2;
      const cy = h / 2;
      const ms = mouseScreenRef.current;
      const worldMouse = {
        x: (ms.x - cx) / scale,
        y: (ms.y - cy) / scale,
      };

      if (placeBlockTriggerRef.current) {
        placeBlockTriggerRef.current = false;
        const cell = mapConfig.placeCubeSize;
        const { x: gx, y: gy } = snapPlaceGridCenter(player.x, player.y, cell);
        const id = sim.placeCube(gx, gy, cell);
        if (id) playerPlacedBlockSpawnMs.set(id, nowWall);
      }

      for (const [blockId, spawn] of playerPlacedBlockSpawnMs) {
        if (
          !curedPlacedBlockIds.has(blockId) &&
          nowWall - spawn >= PLACED_BLOCK_COLOR_MS
        ) {
          sim.hardenPlacedCube(blockId);
          curedPlacedBlockIds.add(blockId);
        }
      }

      const snapshot: GameSnapshot = {
        tick,
        dtMs,
        arenaHalfWidth: mapConfig.halfWidth,
        arenaHalfHeight: mapConfig.halfHeight,
        self: {
          position: { x: aiBody.x, y: aiBody.y },
          angle: aiBody.angle,
          velocity: { x: aiBody.vx, y: aiBody.vy },
        },
        opponent: {
          position: { x: player.x, y: player.y },
          angle: player.angle,
          velocity: { x: player.vx, y: player.vy },
        },
        selfHp: aiHp,
        opponentHp: playerHp,
        timeLeftSec,
        opponentKnifeExtended: false,
        opponentKnifeRecoverySec: 0,
      };

      const aiIntent = decideAiAction(snapshot, aiPreset);

      const keys = keysRef.current;
      let mx = 0;
      let my = 0;
      if (keys.w) my -= 1;
      if (keys.s) my += 1;
      if (keys.a) mx -= 1;
      if (keys.d) mx += 1;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1e-6) {
        mx /= mlen;
        my /= mlen;
      }
      sim.applyForce(
        "player",
        mx * weaponConfig.moveForce * MOVE_SPEED_MULTIPLIER,
        my * weaponConfig.moveForce * MOVE_SPEED_MULTIPLIER
      );

      if (keys.space && !jumpConsumedRef.current) {
        const dx = worldMouse.x - player.x;
        const dy = worldMouse.y - player.y;
        const jl = Math.hypot(dx, dy);
        let jx = 0;
        let jy = -1;
        if (jl > 6) {
          jx = dx / jl;
          jy = dy / jl;
        }
        sim.applyForce(
          "player",
          jx * weaponConfig.jumpImpulse * MOVE_SPEED_MULTIPLIER,
          jy * weaponConfig.jumpImpulse * MOVE_SPEED_MULTIPLIER
        );
        jumpConsumedRef.current = true;
      }
      if (!keys.space) jumpConsumedRef.current = false;

      sim.applyForce(
        "ai",
        aiIntent.moveX * weaponConfig.moveForce * MOVE_SPEED_MULTIPLIER,
        aiIntent.moveY * weaponConfig.moveForce * MOVE_SPEED_MULTIPLIER
      );

      if (aiIntent.jump && tick % 14 === 0) {
        const jdx = player.x - aiBody.x;
        const jdy = player.y - aiBody.y;
        const jl = Math.hypot(jdx, jdy);
        if (jl > 6) {
          sim.applyForce(
            "ai",
            (jdx / jl) *
              weaponConfig.jumpImpulse *
              MOVE_SPEED_MULTIPLIER *
              0.82,
            (jdy / jl) *
              weaponConfig.jumpImpulse *
              MOVE_SPEED_MULTIPLIER *
              0.82
          );
        } else {
          sim.applyForce(
            "ai",
            0,
            -weaponConfig.jumpImpulse * MOVE_SPEED_MULTIPLIER * 0.82
          );
        }
      }

      const aiAttackEdge = aiIntent.attack && !aiAttackHeldRef.current;
      aiAttackHeldRef.current = aiIntent.attack;

      const aimPlayer = Math.atan2(
        worldMouse.y - player.y,
        worldMouse.x - player.x
      );
      sim.setAngle("player", aimPlayer);
      const aimAi = Math.atan2(player.y - aiBody.y, player.x - aiBody.x);
      sim.setAngle("ai", aimAi);

      const spd = gcfg.bulletSpeed * PROJECTILE_SPEED_MULTIPLIER;
      const br = gcfg.bulletRadius;
      const preBodies = sim.getBodies() as PhysBody[];
      const pFire = preBodies.find((b) => b.label === "player");
      const aFire = preBodies.find((b) => b.label === "ai");

      if (fireTriggerRef.current && now >= playerGunReadyAt && pFire) {
        const m = gunMuzzle(
          pFire,
          squareHalf,
          gcfg.barrelPastEdge,
          br
        );
        const id = sim.spawnBullet(
          m.mx,
          m.my,
          m.fx * spd,
          m.fy * spd,
          br,
          "player"
        );
        if (id) playerGunReadyAt = now + gcfg.cooldownMs;
      }
      fireTriggerRef.current = false;

      if (aiAttackEdge && now >= aiGunReadyAt && aFire) {
        const m = gunMuzzle(
          aFire,
          squareHalf,
          gcfg.barrelPastEdge,
          br
        );
        const id = sim.spawnBullet(
          m.mx,
          m.my,
          m.fx * spd,
          m.fy * spd,
          br,
          "ai"
        );
        if (id) {
          aiGunReadyAt =
            now + gcfg.cooldownMs * AI_FIRE_COOLDOWN_FRACTION;
        }
      }

      const bulletPosBeforeStep = new Map<string, { x: number; y: number }>();
      for (const b of sim.getBodies() as PhysBody[]) {
        if (b.label === "bullet") {
          bulletPosBeforeStep.set(b.id, { x: b.x, y: b.y });
        }
      }

      sim.step(dtMs);

      const lens = mapConfig.bulletLens;
      if (lens) {
        const passDot = 0.1;
        const bodiesForLens = sim.getBodies() as PhysBody[];
        for (const b of bodiesForLens) {
          if (b.label !== "bullet") continue;
          const inside = circleIntersectsLensAabb(
            b.x,
            b.y,
            br,
            lens
          );
          if (!inside) {
            lensWasInside.delete(b.id);
            continue;
          }
          const wasIn = lensWasInside.get(b.id) ?? false;
          const dot = b.vx * lens.enterNx + b.vy * lens.enterNy;
          if (dot > passDot) {
            if (!wasIn) {
              sim.setBulletDamageMul(b.id, lens.multiplier);
              const sp = Math.max(
                0.35,
                Math.hypot(b.vx, b.vy) * LENS_PASS_SPEED_MULT
              );
              const a = Math.atan2(b.vy, b.vx);
              sim.setBulletVelocity(
                b.id,
                Math.cos(a) * sp,
                Math.sin(a) * sp
              );
            }
          } else if (!wasIn) {
            const rvx = b.vx - 2 * dot * lens.enterNx;
            const rvy = b.vy - 2 * dot * lens.enterNy;
            sim.setBulletVelocity(b.id, rvx * 0.9, rvy * 0.9);
          }
          lensWasInside.set(b.id, true);
        }
      }

      const after = sim.getBodies() as PhysBody[];
      const p2 = after.find((b) => b.label === "player");
      const a2 = after.find((b) => b.label === "ai");
      if (p2 && a2) {
        const now2 = performance.now();
        const dmg = gcfg.damage;
        const brHit = gcfg.hitRadius;
        for (const b of after) {
          if (b.label !== "bullet" || !b.bulletOwner) continue;
          const target = b.bulletOwner === "player" ? a2 : p2;
          const prev = bulletPosBeforeStep.get(b.id);
          const x0 = prev?.x ?? b.x;
          const y0 = prev?.y ?? b.y;
          if (
            segmentHitsRotatedSquare(
              x0,
              y0,
              b.x,
              b.y,
              brHit,
              target.x,
              target.y,
              squareHalf,
              target.angle
            )
          ) {
            const mul = b.damageMul ?? 1;
            const dealt = dmg * mul;
            if (b.bulletOwner === "player") {
              aiHp -= dealt;
              aiDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
            } else {
              playerHp -= dealt;
              playerDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
            }
            sim.removeBullet(b.id);
          }
        }

        if (dzRun.length > 0) {
          const pin = pointInAnyDamageZone(p2.x, p2.y, dzRun);
          if (pin && !playerWasInDz) {
            playerHp -= 1;
            lastPlayerDzDamageAt = now2;
            playerWasInDz = true;
            playerDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
          } else if (
            pin &&
            playerWasInDz &&
            now2 - lastPlayerDzDamageAt >= DANGER_ZONE_DAMAGE_INTERVAL_MS
          ) {
            playerHp -= 1;
            lastPlayerDzDamageAt = now2;
            playerDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
          } else if (!pin) {
            playerWasInDz = false;
          }

          const ain = pointInAnyDamageZone(a2.x, a2.y, dzRun);
          if (ain && !aiWasInDz) {
            aiHp -= 1;
            lastAiDzDamageAt = now2;
            aiWasInDz = true;
            aiDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
          } else if (
            ain &&
            aiWasInDz &&
            now2 - lastAiDzDamageAt >= DANGER_ZONE_DAMAGE_INTERVAL_MS
          ) {
            aiHp -= 1;
            lastAiDzDamageAt = now2;
            aiDamageFlashUntil = now2 + DAMAGE_FLASH_MS;
          } else if (!ain) {
            aiWasInDz = false;
          }
        }

        const hz = mapConfig.healZone;
        if (hz) {
          const ph = pointInHealZone(p2.x, p2.y, hz);
          if (ph && !playerWasInHeal) {
            playerHp = Math.min(MAX_HP, playerHp + 1);
            lastPlayerHealAt = now2;
            playerWasInHeal = true;
          } else if (
            ph &&
            playerWasInHeal &&
            now2 - lastPlayerHealAt >= HEAL_ZONE_INTERVAL_MS
          ) {
            playerHp = Math.min(MAX_HP, playerHp + 1);
            lastPlayerHealAt = now2;
          } else if (!ph) {
            playerWasInHeal = false;
          }

          const ah = pointInHealZone(a2.x, a2.y, hz);
          if (ah && !aiWasInHeal) {
            aiHp = Math.min(MAX_HP, aiHp + 1);
            lastAiHealAt = now2;
            aiWasInHeal = true;
          } else if (
            ah &&
            aiWasInHeal &&
            now2 - lastAiHealAt >= HEAL_ZONE_INTERVAL_MS
          ) {
            aiHp = Math.min(MAX_HP, aiHp + 1);
            lastAiHealAt = now2;
          } else if (!ah) {
            aiWasInHeal = false;
          }
        }
      }

      playerHp = Math.max(0, Math.min(MAX_HP, playerHp));
      aiHp = Math.max(0, Math.min(MAX_HP, aiHp));

      tick += 1;

      ctx.fillStyle = mapConfig.floorColor;
      ctx.fillRect(0, 0, w, h);

      const toS = (x: number, y: number) => ({
        x: cx + x * scale,
        y: cy + y * scale,
      });

      for (const dz of dzRun) {
        const p1 = toS(dz.x - dz.halfWidth, dz.y - dz.halfHeight);
        const p2s = toS(dz.x + dz.halfWidth, dz.y + dz.halfHeight);
        ctx.fillStyle = "rgba(200, 72, 72, 0.22)";
        ctx.strokeStyle = "rgba(160, 40, 40, 0.45)";
        ctx.lineWidth = 2;
        ctx.fillRect(p1.x, p1.y, p2s.x - p1.x, p2s.y - p1.y);
        ctx.strokeRect(p1.x, p1.y, p2s.x - p1.x, p2s.y - p1.y);
      }

      if (mapConfig.healZone) {
        const hz = mapConfig.healZone;
        const h1 = toS(hz.x - hz.halfWidth, hz.y - hz.halfHeight);
        const h2 = toS(hz.x + hz.halfWidth, hz.y + hz.halfHeight);
        ctx.fillStyle = "rgba(72, 120, 200, 0.2)";
        ctx.strokeStyle = "rgba(40, 90, 160, 0.5)";
        ctx.lineWidth = 2;
        ctx.fillRect(h1.x, h1.y, h2.x - h1.x, h2.y - h1.y);
        ctx.strokeRect(h1.x, h1.y, h2.x - h1.x, h2.y - h1.y);
      }

      if (mapConfig.bulletLens) {
        const L = mapConfig.bulletLens;
        const l1 = toS(L.x - L.halfWidth, L.y - L.halfHeight);
        const l2 = toS(L.x + L.halfWidth, L.y + L.halfHeight);
        ctx.fillStyle = "rgba(140, 90, 180, 0.18)";
        ctx.strokeStyle = "rgba(90, 50, 120, 0.55)";
        ctx.lineWidth = 2;
        ctx.fillRect(l1.x, l1.y, l2.x - l1.x, l2.y - l1.y);
        ctx.strokeRect(l1.x, l1.y, l2.x - l1.x, l2.y - l1.y);
        const cx = (l1.x + l2.x) / 2;
        const cy = (l1.y + l2.y) / 2;
        ctx.fillStyle = "rgba(50, 30, 70, 0.85)";
        ctx.font = `bold ${Math.max(11, 13 * scale)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`×${L.multiplier}`, cx, cy);
        const cen = toS(L.x, L.y);
        const tip = toS(
          L.x + L.enterNx * (Math.max(L.halfWidth, L.halfHeight) + 8),
          L.y + L.enterNy * (Math.max(L.halfWidth, L.halfHeight) + 8)
        );
        ctx.beginPath();
        ctx.moveTo(cen.x, cen.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.strokeStyle = "rgba(90, 50, 120, 0.75)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.save();
      ctx.strokeStyle = "rgba(45, 107, 74, 0.08)";
      ctx.lineWidth = 1;
      const g = 40 * scale;
      for (let gx = -mapConfig.halfWidth; gx <= mapConfig.halfWidth; gx += g / scale) {
        const a = toS(gx, -mapConfig.halfHeight);
        const b = toS(gx, mapConfig.halfHeight);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let gy = -mapConfig.halfHeight; gy <= mapConfig.halfHeight; gy += g / scale) {
        const a = toS(-mapConfig.halfWidth, gy);
        const b = toS(mapConfig.halfWidth, gy);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();

      const drawSquare = (b: PhysBody, fill: string, stroke: string) => {
        ctx.beginPath();
        const vs = b.vertices.map((v) => toS(v.x, v.y));
        if (vs.length) {
          ctx.moveTo(vs[0].x, vs[0].y);
          for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x, vs[i].y);
          ctx.closePath();
        }
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      };

      const drawGun = (b: PhysBody) => {
        const m = gunMuzzle(
          b,
          squareHalf,
          gcfg.barrelPastEdge,
          gcfg.bulletRadius
        );
        const c = toS(m.cx, m.cy);
        const t = toS(m.tipX, m.tipY);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = "#1a1f1c";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      };

      const drawShield = (b: PhysBody) => {
        ctx.beginPath();
        const vs = b.vertices.map((v) => toS(v.x, v.y));
        if (vs.length) {
          ctx.moveTo(vs[0].x, vs[0].y);
          for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x, vs[i].y);
          ctx.closePath();
        }
        const spawn = playerPlacedBlockSpawnMs.get(b.id);
        const stoneKey = `${Math.round(b.x)},${Math.round(b.y)}`;
        if (spawn !== undefined) {
          const t = Math.min(1, (nowWall - spawn) / PLACED_BLOCK_COLOR_MS);
          ctx.fillStyle = lerpRgb(
            PLAYER_BLOCK_FILL_START,
            PLAYER_BLOCK_FILL_END,
            t
          );
          ctx.strokeStyle = lerpRgb(
            PLAYER_BLOCK_STROKE_START,
            PLAYER_BLOCK_STROKE_END,
            t
          );
        } else if (stoneCenterKeys.has(stoneKey)) {
          ctx.fillStyle = "#4a4d52";
          ctx.strokeStyle = "#2a2c30";
        } else {
          ctx.fillStyle = "#b8c9b8";
          ctx.strokeStyle = "#7a9a84";
        }
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      };

      for (const b of after) {
        if (b.label === "shield") drawShield(b);
      }

      const playerHitFlash = nowWall < playerDamageFlashUntil;
      const aiHitFlash = nowWall < aiDamageFlashUntil;
      const aiColors = aiSquareColors(aiPreset, aiHitFlash);
      for (const b of after) {
        if (b.label === "player") {
          drawSquare(
            b,
            playerHitFlash ? "#d04545" : "#2f7a55",
            playerHitFlash ? "#7a1818" : "#1e4a32"
          );
          drawGun(b);
        } else if (b.label === "ai") {
          drawSquare(b, aiColors.fill, aiColors.stroke);
          drawGun(b);
        }
      }

      const bulletR = gcfg.bulletRadius * scale;
      for (const b of after) {
        if (b.label !== "bullet") continue;
        const c = toS(b.x, b.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, bulletR, 0, Math.PI * 2);
        ctx.fillStyle = "#0a0a0a";
        ctx.fill();
      }

      const seg = 10;
      const barH = 14;
      const gap = 4;
      const margin = 20;
      const bottomY = h - 28;

      for (let i = 0; i < MAX_HP; i++) {
        const x = margin + i * (seg + gap);
        const chunk = Math.max(0, Math.min(1, playerHp - i));
        ctx.fillStyle = "#c5d4c8";
        ctx.fillRect(x, bottomY, seg, barH);
        if (chunk > 0) {
          ctx.fillStyle = "#4a9d6f";
          ctx.fillRect(x, bottomY, seg * chunk, barH);
        }
      }
      for (let i = 0; i < MAX_HP; i++) {
        const x = w - margin - seg - i * (seg + gap);
        const chunk = Math.max(0, Math.min(1, aiHp - i));
        ctx.fillStyle = "#c5d4c8";
        ctx.fillRect(x, bottomY, seg, barH);
        if (chunk > 0) {
          ctx.fillStyle = "#4a9d6f";
          ctx.fillRect(x, bottomY, seg * chunk, barH);
        }
      }

      const mm = Math.floor(timeLeftSec / 60);
      const ss = Math.floor(timeLeftSec % 60);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${mm}:${ss.toString().padStart(2, "0")}`,
        w / 2,
        22
      );

      if (playerHp <= 0) {
        finishOnce({
          reason: "hp",
          winner: "ai",
          playerHp: 0,
          aiHp,
        });
        return;
      }
      if (aiHp <= 0) {
        finishOnce({
          reason: "hp",
          winner: "player",
          playerHp,
          aiHp: 0,
        });
        return;
      }
      if (elapsedSession >= SESSION_DURATION_MS) {
        let winner: SessionFinish["winner"] = "draw";
        if (playerHp > aiHp) winner = "player";
        else if (aiHp > playerHp) winner = "ai";
        finishOnce({
          reason: "time",
          winner,
          playerHp,
          aiHp,
        });
        return;
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      canvasHost.removeEventListener("mousedown", onCanvasMouseDown);
      canvasHost.removeEventListener("contextmenu", onContextMenu);
      ro.disconnect();
      sim.destroy();
    };
  }, [mapConfig, weaponConfig, aiPreset, finishOnce]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        touchAction: "none",
        cursor: "none",
      }}
      aria-label="Game arena"
    />
  );
}
