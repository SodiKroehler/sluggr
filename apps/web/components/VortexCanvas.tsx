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
  manhattan,
  parseCellKey,
  pixelToCell,
  ringAttachmentPx,
  type Cell,
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

export type VortexSessionFinish = {
  winner: "player" | "ai" | "draw";
  playerHp: number;
  aiHp: number;
  reason: "hp" | "time";
};

type SimPhase = "countdown" | "planning" | "released" | "ended";

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
};

type Props = {
  tuning: VortexMapTuning;
  aiPreset: AiTrainingPreset;
  onSessionEnd: (r: VortexSessionFinish) => void;
};

function initialSim(layout: VortexLayout, sessionStart: number): SimState {
  const ringKeys = cellsTouchingCircleRing(layout, STROKE_PX);
  const countdownEnd = sessionStart + ARENA_COUNTDOWN_MS;
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
  };
}


function tryDamage(
  who: "player" | "ai",
  entered: Cell,
  s: SimState,
  dmg: number
): void {
  if (who === "player") {
    if (!s.playerDamage.has(cellKey(entered))) return;
    if (s.aiCell && manhattan(s.aiCell, entered) <= 1) {
      s.aiHp = Math.max(0, s.aiHp - dmg);
    }
  } else {
    if (!s.aiDamage.has(cellKey(entered))) return;
    if (s.playerCell && manhattan(s.playerCell, entered) <= 1) {
      s.playerHp = Math.max(0, s.playerHp - dmg);
    }
  }
}

export function VortexCanvas({ tuning, aiPreset, onSessionEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimState | null>(null);
  const endedRef = useRef(false);
  const hoverCellRef = useRef<Cell | null>(null);
  const tuningRef = useRef(tuning);
  const aiPresetRef = useRef(aiPreset);
  const onEndRef = useRef(onSessionEnd);
  tuningRef.current = tuning;
  aiPresetRef.current = aiPreset;
  onEndRef.current = onSessionEnd;

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

      if (e.button === 0) {
        if (!s.playerExit && s.ringKeys.has(cellKey(cell))) {
          s.playerExit = cell;
          s.playerPath = buildFibonacciSpiralPath(
            cell,
            s.layout.cols,
            s.layout.rows,
            tuningRef.current.spiralMaxCells
          );
          if (s.aiExit && s.planningEnd === null) {
            s.planningEnd = performance.now() + tuningRef.current.planningHoldMs;
          }
        }
      } else if (e.button === 2) {
        e.preventDefault();
        const k = cellKey(cell);
        if (s.playerDamage.has(k)) s.playerDamage.delete(k);
        else s.playerDamage.add(k);
      }
    };

    const onCtxMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onCtxMenu);

    let raf = 0;

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

      if (s.phase === "planning" || s.phase === "released") {
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
          s.aiPath = buildFibonacciSpiralPath(
            intent.pickExit,
            layout.cols,
            layout.rows,
            tun.spiralMaxCells
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
          s.playerPath = buildFibonacciSpiralPath(
            s.playerExit,
            s.layout.cols,
            s.layout.rows,
            tun.spiralMaxCells
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
          const omega = tun.spinRadPerSec;
          const v = omega * layout.R;
          const cps = v / layout.cellSize;
          s.playerPathSpeed = Math.max(1.8, cps * 0.85);
          s.aiPathSpeed = Math.max(1.8, cps * 0.85);
          s.playerOnRing = false;
          s.aiOnRing = false;
          s.playerCell = s.playerPath[0] ?? s.playerExit;
          s.aiCell = s.aiPath[0] ?? s.aiExit;
          s.lastPlayerPathIdx = 0;
          s.lastAiPathIdx = 0;
          s.playerPathProg = 0;
          s.aiPathProg = 0;
        }
      }

      if (s.phase === "released") {
        s.playerPathProg += s.playerPathSpeed * dtSec;
        s.aiPathProg += s.aiPathSpeed * dtSec;

        const pi = Math.min(
          s.playerPath.length - 1,
          Math.floor(s.playerPathProg)
        );
        const ai = Math.min(s.aiPath.length - 1, Math.floor(s.aiPathProg));
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

      const blink =
        s.phase === "planning" && Math.sin(now / 120) > 0;
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

      const drawTrebleClef = (x: number, y: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1.35;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.bezierCurveTo(10, -18, 14, -4, 8, 6);
        ctx.bezierCurveTo(2, 14, -6, 12, -4, 2);
        ctx.bezierCurveTo(-2, -8, 6, -12, 0, -14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-2, -10);
        ctx.lineTo(-2, 16);
        ctx.stroke();
        ctx.restore();
      };

      const drawBassClef = (x: number, y: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1.35;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(-2, 2, 9, 0.35, Math.PI * 1.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(6, -4, 4, 0.9, Math.PI * 1.45);
        ctx.stroke();
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.arc(-1, 10, 1.6, 0, Math.PI * 2);
        ctx.arc(5, 10, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      if (s.playerOnRing) {
        drawTrebleClef(pp.x, pp.y);
      } else if (s.playerCell) {
        const pc = cellCenterPx(layout, s.playerCell);
        drawTrebleClef(pc.x, pc.y);
      }

      if (s.aiOnRing) {
        drawBassClef(ap.x, ap.y);
      } else if (s.aiCell) {
        const ac = cellCenterPx(layout, s.aiCell);
        drawBassClef(ac.x, ac.y);
      }

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
      canvas.removeEventListener("contextmenu", onCtxMenu);
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
