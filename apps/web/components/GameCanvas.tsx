"use client";

import { createSimulation } from "@locket/physics-engine";
import {
  decideAiAction,
  type AiPersonalityPreset,
  type GameSnapshot,
} from "@locket/ai-brain";
import { useCallback, useEffect, useRef } from "react";
import { SESSION_DURATION_MS } from "@/lib/gameConstants";
import type { MapConfig } from "@/lib/mapConfig";
import type { CombatConfig } from "@/lib/weaponConfig";

type PhysBody = {
  id: string;
  label: "player" | "ai" | "floor" | "shield";
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  vertices: { x: number; y: number }[];
};

const MAX_HP = 10;
const DAMAGE_ZONE_INTERVAL_MS = 5000;

/** Fibonacci scale for R-hold rotation (rad/s); negative = clockwise in Matter. */
const FIB_OMEGA = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] as const;

function fibOmegaRadPerSec(holdMs: number): number {
  const idx = Math.min(FIB_OMEGA.length - 1, Math.floor(holdMs / 90));
  return -FIB_OMEGA[idx]! * 0.22;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function knifeTip(
  b: PhysBody,
  squareHalf: number,
  bladeReach: number
): { x: number; y: number } {
  const fx = Math.cos(b.angle);
  const fy = Math.sin(b.angle);
  return {
    x: b.x + fx * (squareHalf + bladeReach),
    y: b.y + fy * (squareHalf + bladeReach),
  };
}

function knifeBase(b: PhysBody, squareHalf: number): { x: number; y: number } {
  const fx = Math.cos(b.angle);
  const fy = Math.sin(b.angle);
  return { x: b.x + fx * squareHalf, y: b.y + fy * squareHalf };
}

function pointInDamageZone(
  px: number,
  py: number,
  map: MapConfig
): boolean {
  const z = map.damageZone;
  if (!z) return false;
  return (
    Math.abs(px - z.x) <= z.halfWidth && Math.abs(py - z.y) <= z.halfHeight
  );
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
    r: false,
  });
  const jumpConsumedRef = useRef(false);
  const knifeTriggerRef = useRef(false);
  const mouseScreenRef = useRef({ x: 0, y: 0 });
  const rDownAtRef = useRef<number | null>(null);
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

    const k = weaponConfig.knife;
    const squareHalf = mapConfig.squareSize / 2;

    let playerHp = MAX_HP;
    let aiHp = MAX_HP;
    const sessionStart = performance.now();
    let playerKnifeUntil = 0;
    let aiKnifeUntil = 0;
    let playerKnifeReadyAt = 0;
    let aiKnifeReadyAt = 0;
    let playerKnifeDealtHit = false;
    let aiKnifeDealtHit = false;
    let tick = 0;
    let playerWasKnife = false;
    let playerKnifeEndedAt = 0;
    let playerWasInDz = false;
    let aiWasInDz = false;
    let lastPlayerDzDamageAt = 0;
    let lastAiDzDamageAt = 0;
    let raf = 0;
    let lastTs = performance.now();

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
      if (e.code === "KeyR") {
        keys.r = true;
        if (rDownAtRef.current === null) {
          rDownAtRef.current = performance.now();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const keys = keysRef.current;
      if (e.code === "KeyW") keys.w = false;
      if (e.code === "KeyA") keys.a = false;
      if (e.code === "KeyS") keys.s = false;
      if (e.code === "KeyD") keys.d = false;
      if (e.code === "Space") keys.space = false;
      if (e.code === "KeyR") {
        keys.r = false;
        rDownAtRef.current = null;
        sim.setAngularVelocity("player", 0);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) knifeTriggerRef.current = true;
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvasHost.getBoundingClientRect();
      mouseScreenRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    canvasHost.addEventListener("mousemove", onMouseMove);

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

      const playerKnifeOut = now < playerKnifeUntil;

      if (playerWasKnife && !playerKnifeOut) {
        playerKnifeEndedAt = now;
      }
      playerWasKnife = playerKnifeOut;

      const opponentKnifeRecoverySec = playerKnifeOut
        ? 0
        : Math.min(2, (now - playerKnifeEndedAt) / 1000);

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
        opponentKnifeExtended: playerKnifeOut,
        opponentKnifeRecoverySec,
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
        mx * weaponConfig.moveForce,
        my * weaponConfig.moveForce
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
          jx * weaponConfig.jumpImpulse,
          jy * weaponConfig.jumpImpulse
        );
        jumpConsumedRef.current = true;
      }
      if (!keys.space) jumpConsumedRef.current = false;

      if (
        knifeTriggerRef.current &&
        now >= playerKnifeReadyAt &&
        now >= playerKnifeUntil
      ) {
        playerKnifeUntil = now + k.extendDurationMs;
        playerKnifeReadyAt = now + k.cooldownMs;
        playerKnifeDealtHit = false;
      }
      knifeTriggerRef.current = false;

      sim.applyForce(
        "ai",
        aiIntent.moveX * weaponConfig.moveForce,
        aiIntent.moveY * weaponConfig.moveForce
      );

      if (aiIntent.jump && tick % 14 === 0) {
        const jdx = player.x - aiBody.x;
        const jdy = player.y - aiBody.y;
        const jl = Math.hypot(jdx, jdy);
        if (jl > 6) {
          sim.applyForce(
            "ai",
            (jdx / jl) * weaponConfig.jumpImpulse * 0.82,
            (jdy / jl) * weaponConfig.jumpImpulse * 0.82
          );
        } else {
          sim.applyForce("ai", 0, -weaponConfig.jumpImpulse * 0.82);
        }
      }

      const aiAttackEdge = aiIntent.attack && !aiAttackHeldRef.current;
      aiAttackHeldRef.current = aiIntent.attack;
      if (aiAttackEdge && now >= aiKnifeReadyAt && now >= aiKnifeUntil) {
        aiKnifeUntil = now + k.extendDurationMs;
        aiKnifeReadyAt = now + k.cooldownMs;
        aiKnifeDealtHit = false;
      }

      if (keys.r && rDownAtRef.current !== null) {
        const hold = now - rDownAtRef.current;
        sim.setAngularVelocity("player", fibOmegaRadPerSec(hold));
      }

      sim.step(dtMs);

      const after = sim.getBodies() as PhysBody[];
      const p2 = after.find((b) => b.label === "player");
      const a2 = after.find((b) => b.label === "ai");
      if (p2 && a2) {
        const now2 = performance.now();
        const pk = now2 < playerKnifeUntil;
        const ak = now2 < aiKnifeUntil;

        if (pk && !playerKnifeDealtHit) {
          const tip = knifeTip(p2, squareHalf, k.extendLength);
          if (dist(tip, { x: a2.x, y: a2.y }) <= k.tipHitRadius) {
            aiHp -= k.damage;
            playerKnifeDealtHit = true;
          }
        }
        if (ak && !aiKnifeDealtHit) {
          const tip = knifeTip(a2, squareHalf, k.extendLength);
          if (dist(tip, { x: p2.x, y: p2.y }) <= k.tipHitRadius) {
            playerHp -= k.damage;
            aiKnifeDealtHit = true;
          }
        }

        if (mapConfig.damageZone) {
          const pin = pointInDamageZone(p2.x, p2.y, mapConfig);
          if (pin && !playerWasInDz) {
            playerHp -= 1;
            lastPlayerDzDamageAt = now2;
            playerWasInDz = true;
          } else if (
            pin &&
            playerWasInDz &&
            now2 - lastPlayerDzDamageAt >= DAMAGE_ZONE_INTERVAL_MS
          ) {
            playerHp -= 1;
            lastPlayerDzDamageAt = now2;
          } else if (!pin) {
            playerWasInDz = false;
          }

          const ain = pointInDamageZone(a2.x, a2.y, mapConfig);
          if (ain && !aiWasInDz) {
            aiHp -= 1;
            lastAiDzDamageAt = now2;
            aiWasInDz = true;
          } else if (
            ain &&
            aiWasInDz &&
            now2 - lastAiDzDamageAt >= DAMAGE_ZONE_INTERVAL_MS
          ) {
            aiHp -= 1;
            lastAiDzDamageAt = now2;
          } else if (!ain) {
            aiWasInDz = false;
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

      if (mapConfig.damageZone) {
        const dz = mapConfig.damageZone;
        const p1 = toS(dz.x - dz.halfWidth, dz.y - dz.halfHeight);
        const p2s = toS(dz.x + dz.halfWidth, dz.y + dz.halfHeight);
        ctx.fillStyle = "rgba(200, 72, 72, 0.22)";
        ctx.strokeStyle = "rgba(160, 40, 40, 0.45)";
        ctx.lineWidth = 2;
        ctx.fillRect(p1.x, p1.y, p2s.x - p1.x, p2s.y - p1.y);
        ctx.strokeRect(p1.x, p1.y, p2s.x - p1.x, p2s.y - p1.y);
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

      const drawKnife = (b: PhysBody, extended: boolean) => {
        const reach = extended ? k.extendLength : k.retractLength;
        const tipW = knifeTip(b, squareHalf, reach);
        const baseW = knifeBase(b, squareHalf * 0.92);
        const t1 = toS(tipW.x, tipW.y);
        const t0 = toS(baseW.x, baseW.y);
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.strokeStyle = extended ? "#2a2a2a" : "#4a4a4a";
        ctx.lineWidth = extended ? 4 : 2;
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
        ctx.fillStyle = "#b8c9b8";
        ctx.strokeStyle = "#7a9a84";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      };

      for (const b of after) {
        if (b.label === "shield") drawShield(b);
      }

      const nowDraw = performance.now();
      for (const b of after) {
        if (b.label === "player") {
          drawSquare(b, "#2f7a55", "#1e4a32");
          drawKnife(b, nowDraw < playerKnifeUntil);
        } else if (b.label === "ai") {
          drawSquare(b, "#5a6d62", "#2c3830");
          drawKnife(b, nowDraw < aiKnifeUntil);
        }
      }

      const seg = 10;
      const barH = 14;
      const gap = 4;
      const margin = 20;
      const bottomY = h - 28;

      for (let i = 0; i < MAX_HP; i++) {
        const x = margin + i * (seg + gap);
        ctx.fillStyle = i < playerHp ? "#4a9d6f" : "#c5d4c8";
        ctx.fillRect(x, bottomY, seg, barH);
      }
      for (let i = 0; i < MAX_HP; i++) {
        const x = w - margin - seg - i * (seg + gap);
        ctx.fillStyle = i < aiHp ? "#4a9d6f" : "#c5d4c8";
        ctx.fillRect(x, bottomY, seg, barH);
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
      canvasHost.removeEventListener("mousemove", onMouseMove);
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
      }}
      aria-label="Game arena"
    />
  );
}
