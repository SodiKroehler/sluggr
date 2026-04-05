"use client";

import { createSimulation } from "@locket/physics-engine";
import {
  decideAiAction,
  type AiPersonalityPreset,
  type GameSnapshot,
} from "@locket/ai-brain";
import { useCallback, useEffect, useRef } from "react";
import type { MapConfig } from "@/lib/mapConfig";
import type { LungeWeaponConfig } from "@/lib/weaponConfig";

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
const SESSION_MS = 10 * 60 * 1000;

function tipPosition(b: PhysBody): { x: number; y: number } {
  const fx = Math.cos(b.angle);
  const fy = Math.sin(b.angle);
  let best = { x: b.x, y: b.y };
  let bestDot = -Infinity;
  for (const v of b.vertices) {
    const dx = v.x - b.x;
    const dy = v.y - b.y;
    const d = dx * fx + dy * fy;
    if (d > bestDot) {
      bestDot = d;
      best = { x: v.x, y: v.y };
    }
  }
  return best;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type SessionFinish = {
  reason: "hp" | "time";
  winner: "player" | "ai" | "draw";
  playerHp: number;
  aiHp: number;
};

type Props = {
  mapConfig: MapConfig;
  weaponConfig: LungeWeaponConfig;
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
  const attackDownRef = useRef(false);

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

    endedRef.current = false;
    const sim = createSimulation({
      halfWidth: mapConfig.halfWidth,
      halfHeight: mapConfig.halfHeight,
      triangleRadius: mapConfig.triangleRadius,
      player: { x: -140, y: 40, angle: 0 },
      ai: { x: 140, y: -30, angle: Math.PI },
      shields: mapConfig.shields,
      frictionAir: 0.055,
    });

    let playerHp = MAX_HP;
    let aiHp = MAX_HP;
    const sessionStart = performance.now();
    let playerLungeUntil = 0;
    let aiLungeUntil = 0;
    let playerAttackReadyAt = 0;
    let aiAttackReadyAt = 0;
    let lastPlayerHitMark = 0;
    let lastAiHitMark = 0;
    let tick = 0;
    let playerWasLunging = false;
    let playerLungeEndedAt = 0;
    let raf = 0;
    let lastTs = performance.now();

    const onKeyDown = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.code === "KeyW") k.w = true;
      if (e.code === "KeyA") k.a = true;
      if (e.code === "KeyS") k.s = true;
      if (e.code === "KeyD") k.d = true;
      if (e.code === "Space") {
        e.preventDefault();
        k.space = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.code === "KeyW") k.w = false;
      if (e.code === "KeyA") k.a = false;
      if (e.code === "KeyS") k.s = false;
      if (e.code === "KeyD") k.d = false;
      if (e.code === "Space") k.space = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) attackDownRef.current = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) attackDownRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

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

    function tryHit(
      now: number,
      attackerLunging: boolean,
      tip: { x: number; y: number },
      target: PhysBody,
      lastMark: number,
      markKey: "p" | "a"
    ): number {
      if (!attackerLunging) return lastMark;
      if (now - lastMark < weaponConfig.cooldownMs) return lastMark;
      const c = { x: target.x, y: target.y };
      if (dist(tip, c) <= weaponConfig.hitRadius) {
        if (markKey === "p") aiHp -= weaponConfig.damage;
        else playerHp -= weaponConfig.damage;
        return now;
      }
      return lastMark;
    }

    function frame(ts: number) {
      if (endedRef.current) return;
      const nowWall = performance.now();
      const elapsedSession = nowWall - sessionStart;
      const timeLeftSec = Math.max(0, (SESSION_MS - elapsedSession) / 1000);
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
      const playerLunging = now < playerLungeUntil;
      const aiLunging = now < aiLungeUntil;

      if (playerWasLunging && !playerLunging) {
        playerLungeEndedAt = now;
      }
      playerWasLunging = playerLunging;

      const opponentLungeRecoverySec = playerLunging
        ? 0
        : Math.min(2, (now - playerLungeEndedAt) / 1000);

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
        opponentIsLunging: playerLunging,
        opponentLungeRecoverySec,
      };

      const aiIntent = decideAiAction(snapshot, aiPreset);

      const k = keysRef.current;
      let mx = 0;
      let my = 0;
      if (k.w) my -= 1;
      if (k.s) my += 1;
      if (k.a) mx -= 1;
      if (k.d) mx += 1;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1e-6) {
        mx /= mlen;
        my /= mlen;
      }
      sim.applyForce("player", mx * weaponConfig.moveForce, my * weaponConfig.moveForce);

      if (k.space && !jumpConsumedRef.current) {
        sim.applyForce("player", 0, -weaponConfig.jumpImpulse);
        jumpConsumedRef.current = true;
      }
      if (!k.space) jumpConsumedRef.current = false;

      if (attackDownRef.current && now >= playerAttackReadyAt && !playerLunging) {
        playerLungeUntil = now + weaponConfig.lungeDurationMs;
        playerAttackReadyAt = now + weaponConfig.cooldownMs;
      }

      sim.applyForce(
        "ai",
        aiIntent.moveX * weaponConfig.moveForce,
        aiIntent.moveY * weaponConfig.moveForce
      );

      if (aiIntent.jump && tick % 14 === 0) {
        sim.applyForce("ai", 0, -weaponConfig.jumpImpulse * 0.78);
      }
      if (aiIntent.attack && now >= aiAttackReadyAt && !aiLunging) {
        aiLungeUntil = now + weaponConfig.lungeDurationMs;
        aiAttackReadyAt = now + weaponConfig.cooldownMs;
      }

      const pf = Math.cos(player.angle);
      const qf = Math.sin(player.angle);
      if (playerLunging) {
        sim.applyForce("player", pf * weaponConfig.lungeImpulse, qf * weaponConfig.lungeImpulse);
      }
      if (aiLunging) {
        const afx = Math.cos(aiBody.angle);
        const afy = Math.sin(aiBody.angle);
        sim.applyForce("ai", afx * weaponConfig.lungeImpulse, afy * weaponConfig.lungeImpulse);
      }

      sim.step(dtMs);

      const after = sim.getBodies() as PhysBody[];
      const p2 = after.find((b) => b.label === "player");
      const a2 = after.find((b) => b.label === "ai");
      if (p2 && a2) {
        const pTip = tipPosition(p2);
        const aTip = tipPosition(a2);
        const pl = performance.now() < playerLungeUntil;
        const al = performance.now() < aiLungeUntil;
        lastPlayerHitMark = tryHit(
          performance.now(),
          pl,
          pTip,
          a2,
          lastPlayerHitMark,
          "p"
        );
        lastAiHitMark = tryHit(
          performance.now(),
          al,
          aTip,
          p2,
          lastAiHitMark,
          "a"
        );
      }

      playerHp = Math.max(0, Math.min(MAX_HP, playerHp));
      aiHp = Math.max(0, Math.min(MAX_HP, aiHp));

      tick += 1;

      const w = canvasHost.clientWidth;
      const h = canvasHost.clientHeight;
      const scale = Math.min(w / (mapConfig.halfWidth * 2.1), h / (mapConfig.halfHeight * 2.1));
      const cx = w / 2;
      const cy = h / 2;

      ctx.fillStyle = mapConfig.floorColor;
      ctx.fillRect(0, 0, w, h);

      const toS = (x: number, y: number) => ({
        x: cx + x * scale,
        y: cy + y * scale,
      });

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

      const drawTri = (b: PhysBody, fill: string, stroke: string) => {
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
      for (const b of after) {
        if (b.label === "player") drawTri(b, "#2f7a55", "#1e4a32");
        else if (b.label === "ai") drawTri(b, "#5a6d62", "#2c3830");
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
      ctx.fillText(`${mm}:${ss.toString().padStart(2, "0")}`, w / 2, 22);

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
      if (elapsedSession >= SESSION_MS) {
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
      window.removeEventListener("mouseup", onMouseUp);
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
