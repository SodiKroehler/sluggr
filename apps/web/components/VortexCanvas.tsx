"use client";

import {
  decideVortexAi,
  type AiTrainingPreset,
  type VortexAiSnapshot,
} from "@locket/ai-brain";
import {
  buildFibonacciSpiralPath,
  cellCenterPx,
  cellKey,
  cellsTouchingCircleRing,
  computeVortexLayout,
  launchPathCellsPerSec,
  manhattan,
  parseCellKey,
  pathLerpPx,
  pixelToCell,
  randomSpiralVariant,
  ringAttachmentPx,
  type Cell,
  type SpiralVariant,
  type VortexLayout,
  type VortexMapTuning,
} from "@locket/vortex-engine";
import { ARENA_COUNTDOWN_MS } from "@/lib/gameConstants";
import { useCallback, useEffect, useRef } from "react";

const MAX_HP = 10;
const STROKE_PX = 2;
const BG = "#f4f2ee";
const GRID_LINE = "rgba(0,0,0,0.06)";
const PATH_HIGHLIGHT = "rgba(230, 200, 60, 0.55)";
const DAMAGE_PLAYER = "rgba(200, 60, 60, 0.45)";
const DAMAGE_AI = "rgba(160, 80, 160, 0.4)";
const RING_HIGHLIGHT = "rgba(80, 120, 200, 0.25)";
const SPRITE_FRAC = 0.85;
const RELEASE_LABEL_MS = 1400;

export type VortexSessionFinish = {
  winner: "player" | "ai" | "draw";
  playerHp: number;
  aiHp: number;
  reason: "hp" | "time";
};

type SimPhase = "countdown" | "planning" | "released" | "attract";

type SimState = {
  phase: SimPhase;
  theta: number;
  sessionStart: number;
  countdownEnd: number;
  matchStart: number;
  layout: VortexLayout;
  ringKeys: Set<string>;

  playerExit: Cell | null;
  aiExit: Cell | null;
  planningEnd: number | null;

  playerPath: Cell[];
  aiPath: Cell[];
  playerPathProg: number;
  aiPathProg: number;
  playerPathSpeed: number;
  aiPathSpeed: number;

  playerOnRing: boolean;
  aiOnRing: boolean;
  playerCell: Cell | null;
  aiCell: Cell | null;
  lastPlayerPathIdx: number;
  lastAiPathIdx: number;

  playerDamage: Set<string>;
  aiDamage: Set<string>;

  playerHp: number;
  aiHp: number;
  tick: number;
  planningStart: number;

  releasedWallAt: number | null;
  attractWallAt: number | null;

  playerVariant: SpiralVariant;
  aiVariant: SpiralVariant;
};

type Props = {
  tuning: VortexMapTuning;
  aiPreset: AiTrainingPreset;
  onSessionEnd: (r: VortexSessionFinish) => void;
};

function initialSim(layout: VortexLayout, sessionStart: number, tun: VortexMapTuning): SimState {
  const ringKeys = cellsTouchingCircleRing(layout, STROKE_PX);
  const countdownEnd = sessionStart + ARENA_COUNTDOWN_MS;
  const defVar = {
    maxCells: tun.spiralMaxCells,
    dirOffset: 0,
    turnSign: 1 as const,
    mirrorH: false,
    mirrorV: false,
  };
  return {
    phase: "countdown",
    theta: 0,
    sessionStart,
    countdownEnd,
    matchStart: countdownEnd,
    layout,
    ringKeys,
    playerExit: null,
    aiExit: null,
    planningEnd: null,
    playerPath: [],
    aiPath: [],
    playerPathProg: 0,
    aiPathProg: 0,
    playerPathSpeed: 0,
    aiPathSpeed: 0,
    playerOnRing: true,
    aiOnRing: true,
    playerCell: null,
    aiCell: null,
    lastPlayerPathIdx: -1,
    lastAiPathIdx: -1,
    playerDamage: new Set(),
    aiDamage: new Set(),
    playerHp: MAX_HP,
    aiHp: MAX_HP,
    tick: 0,
    planningStart: countdownEnd,
    releasedWallAt: null,
    attractWallAt: null,
    playerVariant: defVar,
    aiVariant: { ...defVar },
  };
}

function beginPlanningRound(s: SimState, now: number): void {
  s.phase = "planning";
  s.planningStart = now;
  s.playerExit = null;
  s.aiExit = null;
  s.planningEnd = null;
  s.playerPath = [];
  s.aiPath = [];
  s.playerPathProg = 0;
  s.aiPathProg = 0;
  s.playerPathSpeed = 0;
  s.aiPathSpeed = 0;
  s.playerOnRing = true;
  s.aiOnRing = true;
  s.playerCell = null;
  s.aiCell = null;
  s.lastPlayerPathIdx = -1;
  s.lastAiPathIdx = -1;
  s.releasedWallAt = null;
  s.attractWallAt = null;
  s.playerDamage.clear();
  s.aiDamage.clear();
}

function tryDamage(
  who: "player" | "ai",
  entered: Cell,
  st: SimState,
  dmg: number
): void {
  if (who === "player") {
    if (!st.playerDamage.has(cellKey(entered))) return;
    if (st.aiCell && manhattan(st.aiCell, entered) <= 1) {
      st.aiHp = Math.max(0, st.aiHp - dmg);
    }
  } else {
    if (!st.aiDamage.has(cellKey(entered))) return;
    if (st.playerCell && manhattan(st.playerCell, entered) <= 1) {
      st.playerHp = Math.max(0, st.playerHp - dmg);
    }
  }
}

function rerollPlayerPath(s: SimState, tun: VortexMapTuning): void {
  if (!s.playerExit) return;
  s.playerVariant = randomSpiralVariant(Math.random);
  s.playerVariant.maxCells = Math.min(
    s.playerVariant.maxCells,
    tun.spiralMaxCells + 40
  );
  s.playerPath = buildFibonacciSpiralPath(
    s.playerExit,
    s.layout.cols,
    s.layout.rows,
    s.playerVariant
  );
}

export function VortexCanvas({ tuning, aiPreset, onSessionEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimState | null>(null);
  const endedRef = useRef(false);
  const hoverCellRef = useRef<Cell | null>(null);
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
    simRef.current = initialSim(layout, sessionStart, tuningRef.current);

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
      if (s) {
        s.layout = layout;
        s.ringKeys = cellsTouchingCircleRing(layout, STROKE_PX);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    let lastFrame = performance.now();
    const PLANNING_MAX_MS = 45_000;

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const s = simRef.current;
      if (!s) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      hoverCellRef.current = pixelToCell(s.layout, x, y);
    };

    const onMouseDown = (e: MouseEvent) => {
      const s = simRef.current;
      if (!s || s.phase !== "planning") return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cell = pixelToCell(s.layout, x, y);
      if (!cell) return;
      const tun = tuningRef.current;

      if (e.button === 0) {
        if (!s.playerExit && s.ringKeys.has(cellKey(cell))) {
          s.playerExit = cell;
          s.playerVariant = randomSpiralVariant(Math.random);
          s.playerVariant.maxCells = Math.min(
            s.playerVariant.maxCells,
            tun.spiralMaxCells + 40
          );
          s.playerPath = buildFibonacciSpiralPath(
            cell,
            s.layout.cols,
            s.layout.rows,
            s.playerVariant
          );
          if (s.aiExit && s.planningEnd === null) {
            s.planningEnd = performance.now() + tun.planningHoldMs;
          }
        }
      } else if (e.button === 2) {
        e.preventDefault();
        const k = cellKey(cell);
        if (s.playerDamage.has(k)) s.playerDamage.delete(k);
        else s.playerDamage.add(k);
      }
    };

    const onWheel = (e: WheelEvent) => {
      const s = simRef.current;
      if (!s || s.phase !== "planning" || !s.playerExit) return;
      e.preventDefault();
      rerollPlayerPath(s, tuningRef.current);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyR") return;
      const s = simRef.current;
      if (!s || s.phase !== "planning" || !s.playerExit) return;
      e.preventDefault();
      rerollPlayerPath(s, tuningRef.current);
    };

    const onCtxMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
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
        const ringList = [...s.ringKeys];
        const snap: VortexAiSnapshot = {
          tick: s.tick,
          ringCellKeys: ringList,
          aiExitChosen: !!s.aiExit,
          playerExitChosen: !!s.playerExit,
          playerPathKeys: s.playerPath.map(cellKey),
          aiDamageCount: s.aiDamage.size,
        };
        const intent = decideVortexAi(snap, aiPresetRef.current);
        if (intent.pickExit && !s.aiExit) {
          s.aiExit = intent.pickExit;
          s.aiVariant = randomSpiralVariant(Math.random);
          s.aiVariant.maxCells = Math.min(
            s.aiVariant.maxCells,
            tun.spiralMaxCells + 40
          );
          s.aiPath = buildFibonacciSpiralPath(
            intent.pickExit,
            layout.cols,
            layout.rows,
            s.aiVariant
          );
          if (s.playerExit && s.planningEnd === null) {
            s.planningEnd = now + tun.planningHoldMs;
          }
        }
        if (intent.setDamageCell) {
          s.aiDamage.add(cellKey(intent.setDamageCell));
        }

        if (
          !s.playerExit &&
          now - s.planningStart > PLANNING_MAX_MS &&
          s.ringKeys.size > 0
        ) {
          const keys = [...s.ringKeys];
          const pick = keys[Math.floor(Math.random() * keys.length)]!;
          s.playerExit = parseCellKey(pick);
          s.playerVariant = randomSpiralVariant(Math.random);
          s.playerVariant.maxCells = Math.min(
            s.playerVariant.maxCells,
            tun.spiralMaxCells + 40
          );
          s.playerPath = buildFibonacciSpiralPath(
            s.playerExit,
            s.layout.cols,
            s.layout.rows,
            s.playerVariant
          );
          if (s.aiExit && s.planningEnd === null) {
            s.planningEnd = now + tun.planningHoldMs;
          }
        }

        if (
          s.planningEnd !== null &&
          now >= s.planningEnd &&
          s.playerExit &&
          s.aiExit
        ) {
          s.phase = "released";
          s.releasedWallAt = now;
          const omega = tun.spinRadPerSec;
          const cps = launchPathCellsPerSec(
            layout,
            omega,
            tun.launchVelocityMul,
            tun.launchMassKg
          );
          s.playerPathSpeed = Math.max(4, cps);
          s.aiPathSpeed = Math.max(4, cps);
          s.playerOnRing = false;
          s.aiOnRing = false;
          s.lastPlayerPathIdx = -1;
          s.lastAiPathIdx = -1;
          s.playerPathProg = 0;
          s.aiPathProg = 0;
          s.playerCell = s.playerPath[0] ?? s.playerExit;
          s.aiCell = s.aiPath[0] ?? s.aiExit;
        }
      }

      if (s.phase === "released" && s.releasedWallAt !== null) {
        const maxPP = Math.max(0, s.playerPath.length - 1);
        const maxAP = Math.max(0, s.aiPath.length - 1);
        s.playerPathProg = Math.min(
          maxPP,
          s.playerPathProg + s.playerPathSpeed * dtSec
        );
        s.aiPathProg = Math.min(
          maxAP,
          s.aiPathProg + s.aiPathSpeed * dtSec
        );

        const pi = Math.min(maxPP, Math.floor(s.playerPathProg + 1e-6));
        const ai = Math.min(maxAP, Math.floor(s.aiPathProg + 1e-6));
        if (pi !== s.lastPlayerPathIdx && s.playerPath.length > 0) {
          const entered = s.playerPath[pi]!;
          s.playerCell = entered;
          tryDamage("player", entered, s, tun.damageAmount);
          s.lastPlayerPathIdx = pi;
        }
        if (ai !== s.lastAiPathIdx && s.aiPath.length > 0) {
          const entered = s.aiPath[ai]!;
          s.aiCell = entered;
          tryDamage("ai", entered, s, tun.damageAmount);
          s.lastAiPathIdx = ai;
        }

        if (now >= s.releasedWallAt + tun.releasedToAttractMs) {
          s.phase = "attract";
          s.attractWallAt = now;
          s.playerOnRing = true;
          s.aiOnRing = true;
          s.playerPathSpeed = 0;
          s.aiPathSpeed = 0;
        }
      }

      if (s.phase === "attract" && s.attractWallAt !== null) {
        if (now >= s.attractWallAt + tun.attractDurationMs) {
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

      const { cols, rows, cellSize, ox, oy, cx, cy, R } = layout;

      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) {
        const x = ox + c * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + rows * cellSize);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        const y = oy + r * cellSize;
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + cols * cellSize, y);
        ctx.stroke();
      }

      const drawCellFill = (cell: Cell, fill: string) => {
        const x = ox + cell.c * cellSize;
        const y = oy + cell.r * cellSize;
        ctx.fillStyle = fill;
        ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      };

      for (const k of s.playerDamage) {
        drawCellFill(parseCellKey(k), DAMAGE_PLAYER);
      }
      for (const k of s.aiDamage) {
        drawCellFill(parseCellKey(k), DAMAGE_AI);
      }

      if (s.phase === "planning" && s.playerPath.length > 0) {
        for (const c of s.playerPath) {
          drawCellFill(c, PATH_HIGHLIGHT);
        }
      }

      const blink = s.phase === "planning" && Math.sin(now / 120) > 0;
      const hc = hoverCellRef.current;
      if (
        blink &&
        hc &&
        s.phase === "planning" &&
        s.ringKeys.has(cellKey(hc)) &&
        !s.playerExit
      ) {
        drawCellFill(hc, RING_HIGHLIGHT);
      }

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = STROKE_PX;
      ctx.stroke();

      const pp = ringAttachmentPx(layout, s.theta, "player");
      const ap = ringAttachmentPx(layout, s.theta, "ai");

      let playerPx: { x: number; y: number };
      let aiPx: { x: number; y: number };
      if (s.playerOnRing) {
        playerPx = pp;
      } else if (s.phase === "released" && s.playerPath.length > 0) {
        playerPx = pathLerpPx(layout, s.playerPath, s.playerPathProg);
      } else if (s.playerCell) {
        playerPx = cellCenterPx(layout, s.playerCell);
      } else {
        playerPx = pp;
      }

      if (s.aiOnRing) {
        aiPx = ap;
      } else if (s.phase === "released" && s.aiPath.length > 0) {
        aiPx = pathLerpPx(layout, s.aiPath, s.aiPathProg);
      } else if (s.aiCell) {
        aiPx = cellCenterPx(layout, s.aiCell);
      } else {
        aiPx = ap;
      }

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
        const flash = Math.sin(now / 100) > 0;
        if (flash) {
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
        const flash = Math.sin(now / 120) > 0;
        if (flash) {
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
      const mm = Math.floor(leftMs / 60000);
      const ss = Math.floor((leftMs % 60000) / 1000);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${mm}:${ss.toString().padStart(2, "0")}`,
        w / 2,
        16
      );

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("wheel", onWheel);
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
