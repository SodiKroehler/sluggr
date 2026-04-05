"use client";

import { GameCanvas, type SessionFinish } from "@/components/GameCanvas";
import { DEFAULT_MAP } from "@/lib/mapConfig";
import {
  createGuestToken,
  parsePlayerToken,
  type PlayerToken,
} from "@/lib/playerToken";
import {
  clearSessionProfile,
  readSessionProfile,
  writeSessionProfile,
} from "@/lib/sessionStorage";
import { decodeTokenPayload, encodeTokenPayload } from "@/lib/tokenCodec";
import { DEFAULT_TRIANGLE_WEAPON } from "@/lib/weaponConfig";
import type { AiPersonalityPreset } from "@locket/ai-brain";
import { useCallback, useEffect, useMemo, useState } from "react";

type Phase = "token" | "lobby" | "play" | "ended";

function applySessionResult(token: PlayerToken, finish: SessionFinish): PlayerToken {
  const next = { ...token, record: { ...token.record } };
  if (finish.winner === "draw") return next;
  if (finish.winner === "player") next.record.wins += 1;
  else next.record.losses += 1;
  return next;
}

function downloadEncodedToken(token: PlayerToken, filename: string) {
  const encoded = encodeTokenPayload(token);
  const blob = new Blob([encoded], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("token");
  const [profile, setProfile] = useState<PlayerToken | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [difficulty, setDifficulty] = useState<AiPersonalityPreset>("medium");
  const [lastFinish, setLastFinish] = useState<SessionFinish | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const mapConfig = useMemo(() => ({ ...DEFAULT_MAP }), []);
  const weaponConfig = useMemo(() => ({ ...DEFAULT_TRIANGLE_WEAPON }), []);

  useEffect(() => {
    const existing = readSessionProfile();
    if (existing) {
      setProfile(existing);
      setPhase("lobby");
    }
    setHydrated(true);
  }, []);

  const onPickTokenFile = useCallback(
    async (file: File | null) => {
      setTokenError(null);
      if (!file) return;
      const text = await file.text().catch(() => "");
      let raw: unknown;
      try {
        raw = decodeTokenPayload(text);
      } catch {
        try {
          raw = JSON.parse(text) as unknown;
        } catch {
          setTokenError("Could not read token file.");
          return;
        }
      }
      const parsed = parsePlayerToken(raw);
      if (!parsed) {
        setTokenError("Invalid token schema.");
        return;
      }
      writeSessionProfile(parsed);
      setProfile(parsed);
      setPhase("lobby");
    },
    []
  );

  const onUseGuest = useCallback(() => {
    const g = createGuestToken();
    writeSessionProfile(g);
    setProfile(g);
    setPhase("lobby");
  }, []);

  const onSessionEnd = useCallback(
    (finish: SessionFinish) => {
      setLastFinish(finish);
      const current = readSessionProfile();
      if (current) {
        const updated = applySessionResult(current, finish);
        writeSessionProfile(updated);
        setProfile(updated);
        downloadEncodedToken(updated, `locket-token-${updated.id.slice(0, 8)}.txt`);
      }
      setPhase("ended");
    },
    []
  );

  const startMatch = () => setPhase("play");
  const backToLobby = () => {
    setLastFinish(null);
    setPhase("lobby");
  };

  const signOut = () => {
    clearSessionProfile();
    setProfile(null);
    setLastFinish(null);
    setPhase("token");
  };

  if (!hydrated) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        Loading…
      </main>
    );
  }

  if (phase === "token") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 20,
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Locket</h1>
        <p style={{ margin: 0, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
          Upload your player token to start. The session keeps a copy in this browser only.
          When the run ends, an encoded token file downloads automatically.
        </p>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            background: "#1a1a1a",
            color: "#faf7f2",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          <input
            type="file"
            accept=".txt,.json,text/*,application/json"
            style={{ display: "none" }}
            onChange={(e) => onPickTokenFile(e.target.files?.[0] ?? null)}
          />
          Upload token file
        </label>
        <button
          type="button"
          onClick={onUseGuest}
          style={{
            background: "transparent",
            border: "1px solid #c4bdb4",
            padding: "10px 18px",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--muted)",
          }}
        >
          Continue without file (guest token)
        </button>
        {tokenError ? (
          <p style={{ margin: 0, color: "#a33" }} role="alert">
            {tokenError}
          </p>
        ) : null}
      </main>
    );
  }

  if (phase === "lobby" && profile) {
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
        }}
      >
        <p style={{ margin: 0, color: "var(--muted)" }}>Token id · {profile.id}</p>
        <h2 style={{ margin: 0, fontSize: "1.15rem" }}>AI difficulty</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {(["easy", "medium", "hard"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: difficulty === d ? "2px solid #1a1a1a" : "1px solid #c4bdb4",
                background: difficulty === d ? "#eae6df" : "transparent",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {d}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={startMatch}
          style={{
            marginTop: 8,
            padding: "12px 28px",
            borderRadius: 8,
            border: "none",
            background: "#1a1a1a",
            color: "#faf7f2",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Enter arena
        </button>
        <button
          type="button"
          onClick={signOut}
          style={{
            marginTop: 24,
            background: "none",
            border: "none",
            color: "var(--muted)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Clear session / upload different token
        </button>
      </main>
    );
  }

  if (phase === "play") {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <GameCanvas
            mapConfig={mapConfig}
            weaponConfig={weaponConfig}
            aiPreset={difficulty}
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
            borderTop: "1px solid #e8e2d8",
          }}
        >
          WASD move · Space jump · Click lunge · 10:00 limit · Tip hits deal damage
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
          : "AI wins.";
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Session over</h2>
        <p style={{ margin: 0 }}>{msg}</p>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          Record · {profile.record.wins}W / {profile.record.losses}L · Updated token downloaded
        </p>
        <button
          type="button"
          onClick={backToLobby}
          style={{
            marginTop: 12,
            padding: "10px 22px",
            borderRadius: 8,
            border: "none",
            background: "#1a1a1a",
            color: "#faf7f2",
            cursor: "pointer",
          }}
        >
          Back to lobby
        </button>
      </main>
    );
  }

  return null;
}
