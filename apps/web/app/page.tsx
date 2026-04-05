"use client";

import { GameCanvas, type SessionFinish } from "@/components/GameCanvas";
import { DEFAULT_MAP } from "@/lib/mapConfig";
import { parsePlayerToken, type PlayerToken } from "@/lib/playerToken";
import { readSessionProfile, writeSessionProfile } from "@/lib/sessionStorage";
import { decodeTokenPayload, encodeTokenPayload } from "@/lib/tokenCodec";
import {
  idbClearTokenHandle,
  idbGetTokenHandle,
  idbSetTokenHandle,
  pickTokenFileLegacyInput,
  pickTokenFileWithPicker,
  readTextFromHandle,
  silentDownload,
  supportsFileSystemAccess,
  writeTextToHandle,
} from "@/lib/tokenFileAccess";
import { DEFAULT_COMBAT } from "@/lib/weaponConfig";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const AI_PRESET_LOCKED = "easy" as const;

type Phase = "boot" | "play" | "ended";

function applySessionResult(token: PlayerToken, finish: SessionFinish): PlayerToken {
  const next = { ...token, record: { ...token.record } };
  if (finish.winner === "draw") return next;
  if (finish.winner === "player") next.record.wins += 1;
  else next.record.losses += 1;
  return next;
}

function decodeTokenFileText(text: string): unknown {
  try {
    return decodeTokenPayload(text);
  } catch {
    return JSON.parse(text) as unknown;
  }
}

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [profile, setProfile] = useState<PlayerToken | null>(null);
  const [lastFinish, setLastFinish] = useState<SessionFinish | null>(null);
  const tokenHandleRef = useRef<FileSystemFileHandle | null>(null);

  const mapConfig = useMemo(() => ({ ...DEFAULT_MAP }), []);
  const weaponConfig = useMemo(() => ({ ...DEFAULT_COMBAT }), []);

  useEffect(() => {
    let alive = true;

    async function bootLoop() {
      while (alive) {
        try {
          let text: string | undefined;

          if (supportsFileSystemAccess()) {
            let h: FileSystemFileHandle | null = await idbGetTokenHandle();
            if (h) {
              try {
                text = await readTextFromHandle(h);
                tokenHandleRef.current = h;
              } catch {
                await idbClearTokenHandle();
                h = null;
                tokenHandleRef.current = null;
              }
            }
            if (!h || text === undefined) {
              const picked = await pickTokenFileWithPicker();
              await idbSetTokenHandle(picked);
              tokenHandleRef.current = picked;
              text = await readTextFromHandle(picked);
            }
          } else {
            const file = await pickTokenFileLegacyInput();
            tokenHandleRef.current = null;
            text = await file.text();
          }

          if (text === undefined) continue;

          const raw = decodeTokenFileText(text);
          const parsed = parsePlayerToken(raw);
          if (!parsed) {
            if (supportsFileSystemAccess()) await idbClearTokenHandle();
            tokenHandleRef.current = null;
            continue;
          }

          writeSessionProfile(parsed);
          if (!alive) return;
          setProfile(parsed);
          setPhase("play");
          return;
        } catch (e) {
          if (!alive) return;
          if (e instanceof DOMException && e.name === "AbortError") {
            continue;
          }
          if (supportsFileSystemAccess()) {
            await idbClearTokenHandle();
            tokenHandleRef.current = null;
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    }

    bootLoop();
    return () => {
      alive = false;
    };
  }, []);

  const persistTokenSilently = useCallback(async (token: PlayerToken) => {
    const encoded = encodeTokenPayload(token);
    const h = tokenHandleRef.current;
    if (h && supportsFileSystemAccess()) {
      try {
        await writeTextToHandle(h, encoded);
        return;
      } catch {
        /* fall through */
      }
    }
    silentDownload("me.sluggr", encoded);
  }, []);

  const onSessionEnd = useCallback(
    async (finish: SessionFinish) => {
      setLastFinish(finish);
      const current = readSessionProfile();
      if (current) {
        const updated = applySessionResult(current, finish);
        writeSessionProfile(updated);
        setProfile(updated);
        await persistTokenSilently(updated);
      }
      setPhase("ended");
    },
    [persistTokenSilently]
  );

  const replayMatch = useCallback(() => {
    setLastFinish(null);
    setPhase("play");
  }, []);

  if (phase === "boot") {
    return <div style={{ minHeight: "100vh", background: "var(--page-bg)" }} />;
  }

  if (phase === "play" && profile) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <GameCanvas
            mapConfig={mapConfig}
            weaponConfig={weaponConfig}
            aiPreset={AI_PRESET_LOCKED}
            onSessionEnd={onSessionEnd}
          />
        </div>
        <p
          style={{
            margin: 0,
            padding: "8px 16px",
            fontSize: 13,
            color: "var(--muted)",
            textAlign: "center",
            borderTop: "1px solid var(--stroke)",
            background: "var(--panel)",
          }}
        >
          WASD move · Space jump toward cursor · Click knife · Aim with mouse · Hazard zone
        </p>
      </div>
    );
  }

  if (phase === "ended" && profile && lastFinish) {
    const msg =
      lastFinish.winner === "draw"
        ? "Draw — equal health at time."
        : lastFinish.winner === "player"
          ? "You win."
          : "You lose.";
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 16,
          background: "var(--page-bg)",
        }}
      >
        <h2 style={{ margin: 0, color: "var(--accent-dark)" }}>Run over</h2>
        <p style={{ margin: 0 }}>{msg}</p>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          Record · {profile.record.wins}W / {profile.record.losses}L
        </p>
        <button
          type="button"
          onClick={replayMatch}
          style={{
            marginTop: 8,
            padding: "14px 28px",
            borderRadius: 4,
            border: "none",
            background: "var(--accent-dark)",
            color: "#f6faf7",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Replay
        </button>
      </main>
    );
  }

  return <div style={{ minHeight: "100vh", background: "var(--page-bg)" }} />;
}
