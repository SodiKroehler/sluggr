"use client";

import {
  decideVortexAi,
  type AiTrainingPreset,
  type VortexAiSnapshot,
} from "@locket/ai-brain";
import {
  computeVortexLayout,
  launchPathCellsPerSec,
  ringAttachmentPx,
  type VortexLayout,
  type VortexMapTuning,
} from "@locket/vortex-engine";
import {
  ATTACK_RADIUS,
  createRandomSplatter,
  cwTangentOnCircle,
  distSq,
  drawAttackDot,
  drawShockwave,
  drawSplatterBlobs,
  firstTierEndpoints,
  fourTierEndpoints,
  isValidCircleStart,
  JADE,
  JADE_STROKE_PX,
  PAUSE_AT_ATTACK_MS,
  polylineCumulativeLengths,
  positionAtArcLength,
  projectOntoCircle,
  randomFrozenPathColor,
  SEGMENT_UNIT_PX,
  SHOCKWAVE_DURATION_MS,
  SHOCKWAVE_MAX_RADIUS_PX,
  strokeCandidateBranches,
  strokePolylineExact,
  type BranchFirst,
  type BranchFour,
  type SplatterBlob,
  type Vec2,
} from "@/maps/vortex/pathDrawing";
import {
  ARENA_COUNTDOWN_MS,
  ATTRACT_PHASE_MS,
  RELEASE_PHASE_MS,
} from "@/lib/gameConstants";
import { useCallback, useEffect, useRef } from "react";

const MAX_HP = 10;
const STROKE_PX = 2;
const BG = "#f4f2ee";
const CIRCLE_HIT_BAND = 14;
const JUNCTION_CLICK_R = 26;
const SPRITE_FRAC = 0.85;
const RELEASE_LABEL_MS = 1400;
const DAMAGE_COOLDOWN_MS = 520;
const DAMAGE_NEAR_ATTACK = 1;

export type VortexSessionFinish = {
  winner: "player" | "ai" | "draw";
  playerHp: number;
  aiHp: number;
  reason: "hp" | "time";
};

type SimPhase = "countdown" | "planning" | "released" | "attract";

type PlanMode = "circle" | "branch";

type Shock = { x: number; y: number; t0: number };

type FrozenPath = { verts: Vec2[]; color: string };

type SimState = {
  phase: SimPhase;
  theta: number;
  sessionStart: number;
  countdownEnd: number;
  matchStart: number;
  layout: VortexLayout;

  playerMode: PlanMode;
  playerVerts: Vec2[];
  playerLastDir: Vec2 | null;
  playerBranchDepth: number;
  playerAttackVerts: Set<number>;
  playerAttackDots: Vec2[];

  aiMode: PlanMode;
  aiVerts: Vec2[];
  aiLastDir: Vec2 | null;
  aiBranchDepth: number;
  aiAttackVerts: Set<number>;
  aiAttackDots: Vec2[];

  planningEnd: number | null;

  playerAlong: number;
  aiAlong: number;
  playerSpeedPx: number;
  aiSpeedPx: number;
  playerPauseUntil: number;
  aiPauseUntil: number;
  playerProcessedAttackPause: Set<number>;
  aiProcessedAttackPause: Set<number>;
  playerShocks: Shock[];
  aiShocks: Shock[];

  playerOnRing: boolean;
  aiOnRing: boolean;

  playerHp: number;
  aiHp: number;
  lastPlayerNearAiAttack: number;
  lastAiNearPlayerAttack: number;

  tick: number;
  planningStart: number;
  releasedWallAt: number | null;
  attractWallAt: number | null;
  lastAiAttackToggleTick: number;

  /** Ghost trails from past planning rounds (screen space). */
  frozenPaths: FrozenPath[];
  /** Persistent splatter from damage hits. */
  splatters: SplatterBlob[];
};

type Props = {
  tuning: VortexMapTuning;
  aiPreset: AiTrainingPreset;
  onSessionEnd: (r: VortexSessionFinish) => void;
};

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function aiRingPointFromHint(u: Vec2, layout: VortexLayout): Vec2 {
  const { cx, cy, R } = layout;
  let d = norm(u);
  if (d.x >= -0.03) d = norm({ x: -Math.abs(d.x) - 0.2, y: d.y });
  return { x: cx + d.x * R, y: cy + d.y * R };
}

function initialSim(layout: VortexLayout, sessionStart: number): SimState {
  const countdownEnd = sessionStart + ARENA_COUNTDOWN_MS;
  return {
    phase: "countdown",
    theta: 0,
    sessionStart,
    countdownEnd,
    matchStart: countdownEnd,
    layout,
    playerMode: "circle",
    playerVerts: [],
    playerLastDir: null,
    playerBranchDepth: 0,
    playerAttackVerts: new Set(),
    playerAttackDots: [],
    aiMode: "circle",
    aiVerts: [],
    aiLastDir: null,
    aiBranchDepth: 0,
    aiAttackVerts: new Set(),
    aiAttackDots: [],
    planningEnd: null,
    playerAlong: 0,
    aiAlong: 0,
    playerSpeedPx: 0,
    aiSpeedPx: 0,
    playerPauseUntil: 0,
    aiPauseUntil: 0,
    playerProcessedAttackPause: new Set(),
    aiProcessedAttackPause: new Set(),
    playerShocks: [],
    aiShocks: [],
    playerOnRing: true,
    aiOnRing: true,
    playerHp: MAX_HP,
    aiHp: MAX_HP,
    lastPlayerNearAiAttack: 0,
    lastAiNearPlayerAttack: 0,
    tick: 0,
    planningStart: countdownEnd,
    releasedWallAt: null,
    attractWallAt: null,
    lastAiAttackToggleTick: -999,
    frozenPaths: [],
    splatters: [],
  };
}

function beginPlanningRound(s: SimState, now: number): void {
  s.phase = "planning";
  s.planningStart = now;
  s.playerMode = "circle";
  s.playerVerts = [];
  s.playerLastDir = null;
  s.playerBranchDepth = 0;
  s.playerAttackVerts = new Set();
  s.playerAttackDots = [];
  s.aiMode = "circle";
  s.aiVerts = [];
  s.aiLastDir = null;
  s.aiBranchDepth = 0;
  s.aiAttackVerts = new Set();
  s.aiAttackDots = [];
  s.planningEnd = null;
  s.playerAlong = 0;
  s.aiAlong = 0;
  s.playerSpeedPx = 0;
  s.aiSpeedPx = 0;
  s.playerPauseUntil = 0;
  s.aiPauseUntil = 0;
  s.playerProcessedAttackPause = new Set();
  s.aiProcessedAttackPause = new Set();
  s.playerShocks = [];
  s.aiShocks = [];
  s.playerOnRing = true;
  s.aiOnRing = true;
  s.releasedWallAt = null;
  s.attractWallAt = null;
  s.lastPlayerNearAiAttack = 0;
  s.lastAiNearPlayerAttack = 0;
  s.lastAiAttackToggleTick = -999;
  // frozenPaths + splatters persist across rounds
}

function currentJunction(verts: Vec2[]): Vec2 | null {
  if (verts.length === 0) return null;
  return verts[verts.length - 1]!;
}

function appendBranchPlayer(s: SimState, end: Vec2): void {
  const j = s.playerVerts.length - 1;
  const prev = s.playerVerts[j]!;
  s.playerVerts.push(end);
  s.playerLastDir = norm({ x: end.x - prev.x, y: end.y - prev.y });
  s.playerBranchDepth += 1;
}

function tryStartPlanningTimer(s: SimState, holdMs: number): void {
  if (s.planningEnd !== null) return;
  if (s.playerVerts.length >= 2 && s.aiVerts.length >= 2) {
    s.planningEnd = performance.now() + holdMs;
  }
}

export function VortexCanvas({ tuning, aiPreset, onSessionEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimState | null>(null);
  const endedRef = useRef(false);
  const tuningRef = useRef(tuning);
  const aiPresetRef = useRef(aiPreset);
  tuningRef.current = tuning;
  aiPresetRef.current = aiPreset;

  const finishOnce = useCallback((r: VortexSessionFinish) => {
    if (endedRef.current) return;
    endedRef.current = true;
    onSessionEnd(r);
  }, [onSessionEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    endedRef.current = false;
    const sessionStart = performance.now();
    let layout = computeVortexLayout(canvas.clientWidth, canvas.clientHeight, {
      circleFrac: tuningRef.current.circleFrac,
    });
    simRef.current = initialSim(layout, sessionStart);

    const trebleImg = new Image();
    const bassImg = new Image();
    trebleImg.src = "/treble.svg";
    bassImg.src = "/bass.svg";

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout = computeVortexLayout(canvas.clientWidth, canvas.clientHeight, {
        circleFrac: tuningRef.current.circleFrac,
      });
      const s = simRef.current;
      if (s) s.layout = layout;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    let lastFrame = performance.now();

    const applyPlayerBranchFirst = (s: SimState, k: BranchFirst) => {
      if (s.playerMode !== "branch" || s.playerVerts.length === 0) return;
      const j = currentJunction(s.playerVerts)!;
      const t = cwTangentOnCircle(j, { x: layout.cx, y: layout.cy });
      const ends = firstTierEndpoints(j, t, SEGMENT_UNIT_PX);
      const end = ends[k];
      appendBranchPlayer(s, end);
      tryStartPlanningTimer(s, tuningRef.current.planningHoldMs);
    };

    const applyPlayerBranchFour = (s: SimState, k: BranchFour) => {
      if (s.playerMode !== "branch" || s.playerVerts.length < 2) return;
      const j = currentJunction(s.playerVerts)!;
      const prev = s.playerVerts[s.playerVerts.length - 2]!;
      const incoming = norm({ x: j.x - prev.x, y: j.y - prev.y });
      const ends = fourTierEndpoints(j, incoming, SEGMENT_UNIT_PX);
      const end = ends[k];
      appendBranchPlayer(s, end);
      tryStartPlanningTimer(s, tuningRef.current.planningHoldMs);
    };

    const toggleAttackPlayer = (s: SimState) => {
      if (s.playerMode !== "branch" || s.playerVerts.length === 0) return;
      const idx = s.playerVerts.length - 1;
      const j = s.playerVerts[idx]!;
      if (s.playerAttackVerts.has(idx)) {
        s.playerAttackVerts.delete(idx);
        s.playerAttackDots = s.playerAttackDots.filter(
          (p) => distSq(p, j) > 4
        );
      } else {
        s.playerAttackVerts.add(idx);
        s.playerAttackDots.push({ ...j });
      }
    };

    const applyAiBranch = (s: SimState, first: BranchFirst | null, four: BranchFour | null) => {
      if (s.aiMode !== "branch" || s.aiVerts.length === 0) return;
      const j = currentJunction(s.aiVerts)!;
      let end: Vec2;
      if (s.aiBranchDepth === 0 && first) {
        const t = cwTangentOnCircle(j, { x: layout.cx, y: layout.cy });
        end = firstTierEndpoints(j, t, SEGMENT_UNIT_PX)[first];
      } else if (four && s.aiVerts.length >= 2) {
        const prev = s.aiVerts[s.aiVerts.length - 2]!;
        const incoming = norm({ x: j.x - prev.x, y: j.y - prev.y });
        end = fourTierEndpoints(j, incoming, SEGMENT_UNIT_PX)[four];
      } else return;
      const prevJ = s.aiVerts[s.aiVerts.length - 1]!;
      s.aiVerts.push(end);
      s.aiLastDir = norm({ x: end.x - prevJ.x, y: end.y - prevJ.y });
      s.aiBranchDepth += 1;
      tryStartPlanningTimer(s, tuningRef.current.planningHoldMs);
    };

    const toggleAttackAi = (s: SimState) => {
      if (s.aiMode !== "branch" || s.aiVerts.length === 0) return;
      const idx = s.aiVerts.length - 1;
      const j = s.aiVerts[idx]!;
      if (s.aiAttackVerts.has(idx)) {
        s.aiAttackVerts.delete(idx);
        s.aiAttackDots = s.aiAttackDots.filter((p) => distSq(p, j) > 4);
      } else {
        s.aiAttackVerts.add(idx);
        s.aiAttackDots.push({ ...j });
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const s = simRef.current;
      if (!s || s.phase !== "planning") return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (s.playerMode === "circle") {
        const on = projectOntoCircle(px, py, layout, CIRCLE_HIT_BAND);
        if (on && isValidCircleStart(on, layout, "player")) {
          s.playerVerts = [on];
          s.playerLastDir = cwTangentOnCircle(on, { x: layout.cx, y: layout.cy });
          s.playerMode = "branch";
          s.playerBranchDepth = 0;
          tryStartPlanningTimer(s, tuningRef.current.planningHoldMs);
        }
        return;
      }

      const jun = currentJunction(s.playerVerts);
      if (jun && Math.hypot(px - jun.x, py - jun.y) <= JUNCTION_CLICK_R) {
        toggleAttackPlayer(s);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = simRef.current;
      if (!s || s.phase !== "planning" || s.playerMode !== "branch") return;
      const c = e.code;
      if (c === "KeyR") {
        e.preventDefault();
        toggleAttackPlayer(s);
        return;
      }
      if (s.playerBranchDepth === 0 && s.playerVerts.length >= 1) {
        if (c === "KeyW") {
          e.preventDefault();
          applyPlayerBranchFirst(s, "w");
        } else if (c === "KeyD") {
          e.preventDefault();
          applyPlayerBranchFirst(s, "d");
        } else if (c === "KeyS") {
          e.preventDefault();
          applyPlayerBranchFirst(s, "s");
        }
        return;
      }
      if (s.playerBranchDepth >= 1 && s.playerVerts.length >= 2) {
        if (c === "KeyW") {
          e.preventDefault();
          applyPlayerBranchFour(s, "w");
        } else if (c === "KeyA") {
          e.preventDefault();
          applyPlayerBranchFour(s, "a");
        } else if (c === "KeyS") {
          e.preventDefault();
          applyPlayerBranchFour(s, "s");
        } else if (c === "KeyD") {
          e.preventDefault();
          applyPlayerBranchFour(s, "d");
        }
      }
    };

    const onCtxMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onCtxMenu);
    window.addEventListener("keydown", onKeyDown);

    let raf = 0;

    const drawSprite = (
      img: HTMLImageElement,
      x: number,
      y: number,
      cellSize: number
    ) => {
      const sz = cellSize * SPRITE_FRAC;
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
      } else {
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(x, y, sz * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const advanceAlongPath = (
      s: SimState,
      which: "player" | "ai",
      now: number,
      dtSec: number
    ): Vec2 => {
      const verts = which === "player" ? s.playerVerts : s.aiVerts;
      const attacks = which === "player" ? s.playerAttackVerts : s.aiAttackVerts;
      const shocks = which === "player" ? s.playerShocks : s.aiShocks;
      const processed =
        which === "player" ? s.playerProcessedAttackPause : s.aiProcessedAttackPause;
      let along = which === "player" ? s.playerAlong : s.aiAlong;
      let pauseUntil = which === "player" ? s.playerPauseUntil : s.aiPauseUntil;
      const speed = which === "player" ? s.playerSpeedPx : s.aiSpeedPx;

      if (verts.length < 2) return verts[0] ?? { x: layout.cx, y: layout.cy };

      const { cum, total } = polylineCumulativeLengths(verts);

      if (now < pauseUntil) {
        if (which === "player") s.playerAlong = along;
        else s.aiAlong = along;
        return positionAtArcLength(verts, cum, along);
      }

      let nextAlong = Math.min(total, along + speed * dtSec);

      const hitAttack = [...attacks]
        .filter((k) => k >= 0 && k < verts.length && !processed.has(k))
        .map((k) => ({ k, ck: cum[k]! }))
        .filter(({ ck }) => ck > along && ck <= nextAlong)
        .sort((a, b) => a.ck - b.ck)[0];

      if (hitAttack) {
        nextAlong = hitAttack.ck;
        pauseUntil = now + PAUSE_AT_ATTACK_MS;
        shocks.push({
          x: verts[hitAttack.k]!.x,
          y: verts[hitAttack.k]!.y,
          t0: now,
        });
        processed.add(hitAttack.k);
      }

      along = nextAlong;
      if (which === "player") {
        s.playerAlong = along;
        s.playerPauseUntil = pauseUntil;
      } else {
        s.aiAlong = along;
        s.aiPauseUntil = pauseUntil;
      }
      return positionAtArcLength(verts, cum, along);
    };

    const frame = () => {
      if (endedRef.current) return;
      const s = simRef.current;
      if (!s) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const now = performance.now();
      const dtSec = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const tun = tuningRef.current;
      layout = s.layout;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const center = { x: layout.cx, y: layout.cy };
      const cellSize = layout.cellSize;

      if (s.phase === "countdown") {
        if (now >= s.countdownEnd) {
          s.phase = "planning";
          s.planningStart = now;
        }
      }

      if (
        s.phase === "planning" ||
        s.phase === "released" ||
        s.phase === "attract"
      ) {
        s.theta += tun.spinRadPerSec * dtSec;
      }

      if (s.phase === "planning") {
        const snap: VortexAiSnapshot = {
          tick: s.tick,
          aiCirclePlaced: s.aiVerts.length > 0,
          aiNeedsBranch: s.aiMode === "branch" && s.aiVerts.length > 0,
          aiBranchDepth: s.aiBranchDepth,
        };
        const intent = decideVortexAi(snap, aiPresetRef.current);
        if (intent.pickCirclePoint && s.aiMode === "circle") {
          const p = aiRingPointFromHint(intent.pickCirclePoint, layout);
          s.aiVerts = [p];
          s.aiLastDir = cwTangentOnCircle(p, center);
          s.aiMode = "branch";
          s.aiBranchDepth = 0;
          tryStartPlanningTimer(s, tun.planningHoldMs);
        }
        if (
          intent.addAttackAtJunction &&
          s.tick - s.lastAiAttackToggleTick > 20
        ) {
          toggleAttackAi(s);
          s.lastAiAttackToggleTick = s.tick;
        }
        if (intent.pickBranchFirst && s.aiBranchDepth === 0) {
          applyAiBranch(s, intent.pickBranchFirst, null);
        }
        if (intent.pickBranchFour && s.aiBranchDepth > 0) {
          applyAiBranch(s, null, intent.pickBranchFour);
        }

        if (
          s.planningEnd !== null &&
          now >= s.planningEnd &&
          s.playerVerts.length >= 2 &&
          s.aiVerts.length >= 2
        ) {
          s.frozenPaths.push(
            {
              verts: s.playerVerts.map((v) => ({ ...v })),
              color: randomFrozenPathColor(),
            },
            {
              verts: s.aiVerts.map((v) => ({ ...v })),
              color: randomFrozenPathColor(),
            }
          );
          s.phase = "released";
          s.releasedWallAt = now;
          const omega = tun.spinRadPerSec;
          const cps = launchPathCellsPerSec(
            layout,
            omega,
            tun.launchVelocityMul,
            tun.launchMassKg
          );
          const vPx = Math.max(180, cps * layout.cellSize);
          s.playerSpeedPx = vPx;
          s.aiSpeedPx = vPx;
          s.playerOnRing = false;
          s.aiOnRing = false;
          s.playerAlong = 0;
          s.aiAlong = 0;
          s.playerPauseUntil = 0;
          s.aiPauseUntil = 0;
          s.playerProcessedAttackPause = new Set();
          s.aiProcessedAttackPause = new Set();
          s.playerShocks = [];
          s.aiShocks = [];
        }
      }

      let playerPx: Vec2;
      let aiPx: Vec2;

      if (s.phase === "released" && s.releasedWallAt !== null) {
        playerPx = advanceAlongPath(s, "player", now, dtSec);
        aiPx = advanceAlongPath(s, "ai", now, dtSec);

        const r2 = ATTACK_RADIUS * ATTACK_RADIUS;
        for (const ap of s.aiAttackDots) {
          if (distSq(playerPx, ap) <= r2 && now - s.lastPlayerNearAiAttack > DAMAGE_COOLDOWN_MS) {
            s.playerHp = Math.max(0, s.playerHp - DAMAGE_NEAR_ATTACK);
            s.lastPlayerNearAiAttack = now;
            s.splatters.push(...createRandomSplatter(playerPx.x, playerPx.y));
          }
        }
        for (const ap of s.playerAttackDots) {
          if (distSq(aiPx, ap) <= r2 && now - s.lastAiNearPlayerAttack > DAMAGE_COOLDOWN_MS) {
            s.aiHp = Math.max(0, s.aiHp - DAMAGE_NEAR_ATTACK);
            s.lastAiNearPlayerAttack = now;
            s.splatters.push(...createRandomSplatter(aiPx.x, aiPx.y));
          }
        }

        if (now >= s.releasedWallAt + RELEASE_PHASE_MS) {
          s.phase = "attract";
          s.attractWallAt = now;
          s.playerOnRing = true;
          s.aiOnRing = true;
        }
      } else {
        playerPx = ringAttachmentPx(layout, s.theta, "player");
        aiPx = ringAttachmentPx(layout, s.theta, "ai");
      }

      if (s.phase === "attract" && s.attractWallAt !== null) {
        if (now >= s.attractWallAt + ATTRACT_PHASE_MS) {
          beginPlanningRound(s, now);
        }
      }

      const matchElapsed = now - s.matchStart;
      if (s.phase !== "countdown" && matchElapsed >= tun.matchDurationMs) {
        let winner: VortexSessionFinish["winner"] = "draw";
        if (s.playerHp > s.aiHp) winner = "player";
        else if (s.aiHp > s.playerHp) winner = "ai";
        finishOnce({
          reason: "time",
          winner,
          playerHp: s.playerHp,
          aiHp: s.aiHp,
        });
        return;
      }

      if (s.playerHp <= 0 || s.aiHp <= 0) {
        finishOnce({
          reason: "hp",
          winner:
            s.playerHp <= 0 && s.aiHp <= 0
              ? "draw"
              : s.playerHp <= 0
                ? "ai"
                : "player",
          playerHp: s.playerHp,
          aiHp: s.aiHp,
        });
        return;
      }

      s.tick += 1;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      const { cx, cy, R } = layout;

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = STROKE_PX;
      ctx.stroke();

      for (const fp of s.frozenPaths) {
        if (fp.verts.length >= 2) {
          strokePolylineExact(ctx, fp.verts, {
            strokePx: 4,
            color: fp.color,
            glow: false,
          });
        }
      }

      if (s.phase === "planning") {
        if (s.playerVerts.length >= 2) {
          strokePolylineExact(ctx, s.playerVerts, {
            strokePx: JADE_STROKE_PX,
            color: JADE,
            glow: true,
          });
        }
        if (s.playerMode === "branch" && s.playerVerts.length > 0) {
          const j = currentJunction(s.playerVerts)!;
          const L = SEGMENT_UNIT_PX;
          if (s.playerBranchDepth === 0) {
            const t = cwTangentOnCircle(j, center);
            const ends = firstTierEndpoints(j, t, L);
            strokeCandidateBranches(ctx, j, [ends.w, ends.d, ends.s]);
          } else if (s.playerVerts.length >= 2) {
            const prev = s.playerVerts[s.playerVerts.length - 2]!;
            const incoming = norm({ x: j.x - prev.x, y: j.y - prev.y });
            const e = fourTierEndpoints(j, incoming, L);
            strokeCandidateBranches(ctx, j, [e.w, e.a, e.s, e.d]);
          }
        }

        if (s.aiVerts.length >= 2) {
          strokePolylineExact(ctx, s.aiVerts, {
            strokePx: 3,
            color: "rgba(120, 90, 140, 0.75)",
            glow: false,
          });
        }
        if (s.aiMode === "branch" && s.aiVerts.length > 0) {
          const j = currentJunction(s.aiVerts)!;
          const L = SEGMENT_UNIT_PX;
          if (s.aiBranchDepth === 0) {
            const t = cwTangentOnCircle(j, center);
            const ends = firstTierEndpoints(j, t, L);
            strokeCandidateBranches(ctx, j, [ends.w, ends.d, ends.s], "rgba(120, 90, 140, 0.35)");
          } else if (s.aiVerts.length >= 2) {
            const prev = s.aiVerts[s.aiVerts.length - 2]!;
            const incoming = norm({ x: j.x - prev.x, y: j.y - prev.y });
            const e = fourTierEndpoints(j, incoming, L);
            strokeCandidateBranches(ctx, j, [e.w, e.a, e.s, e.d], "rgba(120, 90, 140, 0.35)");
          }
        }

        for (const p of s.playerAttackDots) {
          drawAttackDot(ctx, p, "rgba(200, 60, 60, 0.95)", 4);
        }
        for (const p of s.aiAttackDots) {
          drawAttackDot(ctx, p, "rgba(90, 60, 140, 0.95)", 4);
        }
      }

      if (s.phase === "released") {
        if (s.playerVerts.length >= 2) {
          strokePolylineExact(ctx, s.playerVerts, {
            strokePx: JADE_STROKE_PX,
            color: JADE,
            glow: true,
          });
        }
        if (s.aiVerts.length >= 2) {
          strokePolylineExact(ctx, s.aiVerts, {
            strokePx: 3,
            color: "rgba(120, 90, 140, 0.75)",
            glow: false,
          });
        }
        for (const p of s.playerAttackDots) {
          drawAttackDot(ctx, p, "rgba(200, 60, 60, 0.85)", 4);
        }
        for (const p of s.aiAttackDots) {
          drawAttackDot(ctx, p, "rgba(90, 60, 140, 0.85)", 4);
        }

        const tShock = (sh: Shock) => {
          const u = (now - sh.t0) / SHOCKWAVE_DURATION_MS;
          if (u >= 1) return;
          drawShockwave(ctx, { x: sh.x, y: sh.y }, u, SHOCKWAVE_MAX_RADIUS_PX);
        };
        s.playerShocks.forEach(tShock);
        s.aiShocks.forEach(tShock);
      }

      drawSplatterBlobs(ctx, s.splatters);

      drawSprite(trebleImg, playerPx.x, playerPx.y, cellSize);
      drawSprite(bassImg, aiPx.x, aiPx.y, cellSize);

      const inCd = s.phase === "countdown" && now < s.countdownEnd;
      if (inCd) {
        const remain = Math.max(0, s.countdownEnd - now);
        const n = Math.ceil(remain / 1000);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, w, h);
        const fontPx = Math.max(72, Math.min(w, h) * 0.26);
        ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(5, fontPx * 0.06);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        const label = String(n);
        ctx.strokeText(label, w / 2, h / 2);
        ctx.fillText(label, w / 2, h / 2);
      }

      if (
        s.phase === "released" &&
        s.releasedWallAt !== null &&
        now < s.releasedWallAt + RELEASE_LABEL_MS
      ) {
        if (Math.sin(now / 100) > 0) {
          ctx.font = `bold ${Math.max(28, Math.min(w, h) * 0.07)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.fillStyle = "rgba(255, 90, 40, 0.95)";
          ctx.strokeText("RELEASE", w / 2, h * 0.12);
          ctx.fillText("RELEASE", w / 2, h * 0.12);
        }
      }

      if (s.phase === "attract") {
        if (Math.sin(now / 120) > 0) {
          ctx.font = `bold ${Math.max(28, Math.min(w, h) * 0.07)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.fillStyle = "rgba(60, 100, 220, 0.95)";
          ctx.strokeText("ATTRACT", w / 2, h * 0.12);
          ctx.fillText("ATTRACT", w / 2, h * 0.12);
        }
      }

      const barY = h - 22;
      const seg = 8;
      const gap = 3;
      const margin = 16;
      for (let i = 0; i < MAX_HP; i++) {
        const x = margin + i * (seg + gap);
        ctx.fillStyle = "#ddd";
        ctx.fillRect(x, barY, seg, 10);
        if (s.playerHp > i) {
          ctx.fillStyle = "#3d8f5a";
          ctx.fillRect(x, barY, seg, 10);
        }
      }
      for (let i = 0; i < MAX_HP; i++) {
        const x = w - margin - seg - i * (seg + gap);
        ctx.fillStyle = "#ddd";
        ctx.fillRect(x, barY, seg, 10);
        if (s.aiHp > i) {
          ctx.fillStyle = "#a44";
          ctx.fillRect(x, barY, seg, 10);
        }
      }

      const leftMs = Math.max(
        0,
        tun.matchDurationMs - Math.max(0, now - s.matchStart)
      );
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${Math.floor(leftMs / 60000)}:${Math.floor((leftMs % 60000) / 1000)
          .toString()
          .padStart(2, "0")}`,
        w / 2,
        16
      );

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onCtxMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [finishOnce]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        touchAction: "none",
      }}
    />
  );
}
