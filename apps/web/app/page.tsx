"use client";

import { GameCanvas, type SessionFinish } from "@/components/GameCanvas";
import { DEFAULT_MAP } from "@/lib/mapConfig";
import { createNewToken, parsePlayerToken, type PlayerToken } from "@/lib/playerToken";
import {
  clearSessionProfile,
  readSessionProfile,
  writeSessionProfile,
} from "@/lib/sessionStorage";
import { decodeTokenPayload, encodeTokenPayload } from "@/lib/tokenCodec";
import { DEFAULT_COMBAT } from "@/lib/weaponConfig";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

const AI_PRESET_LOCKED = "easy" as const;

type Phase = "token" | "play" | "ended";

const TOKEN_DOWNLOAD_NAME = "me.sluggr";

function applySessionResult(token: PlayerToken, finish: SessionFinish): PlayerToken {
  const next = { ...token, record: { ...token.record } };
  if (finish.winner === "draw") return next;
  if (finish.winner === "player") next.record.wins += 1;
  else next.record.losses += 1;
  return next;
}

function downloadEncodedToken(token: PlayerToken) {
  const encoded = encodeTokenPayload(token);
  const blob = new Blob([encoded], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = TOKEN_DOWNLOAD_NAME;
  a.click();
  URL.revokeObjectURL(url);
}

const squareBtn: CSSProperties = {
  width: "min(10vw, 10vh)",
  height: "min(10vw, 10vh)",
  minWidth: 140,
  minHeight: 140,
  maxWidth: 220,
  maxHeight: 220,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 12,
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "clamp(0.85rem, 2vmin, 1rem)",
  lineHeight: 1.25,
  border: "2px solid var(--accent-dark)",
  boxShadow: "0 2px 0 rgba(30, 42, 34, 0.12)",
};

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("token");
  const [profile, setProfile] = useState<PlayerToken | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [lastFinish, setLastFinish] = useState<SessionFinish | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const mapConfig = useMemo(() => ({ ...DEFAULT_MAP }), []);
  const weaponConfig = useMemo(() => ({ ...DEFAULT_COMBAT }), []);

  useEffect(() => {
    const existing = readSessionProfile();
    if (existing) setProfile(existing);
    setHydrated(true);
  }, []);

  const beginMatch = useCallback(() => {
    setPhase("play");
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
      setPhase("play");
    },
    []
  );

  const onCreateNewToken = useCallback(() => {
    setTokenError(null);
    const t = createNewToken();
    writeSessionProfile(t);
    setProfile(t);
    setPhase("play");
  }, []);

  const onSessionEnd = useCallback((finish: SessionFinish) => {
    setLastFinish(finish);
    const current = readSessionProfile();
    if (current) {
      const updated = applySessionResult(current, finish);
      writeSessionProfile(updated);
      setProfile(updated);
      downloadEncodedToken(updated);
    }
    setPhase("ended");
  }, []);

  const replayMatch = useCallback(() => {
    setLastFinish(null);
    setPhase("play");
  }, []);

  const saveTokenAgain = useCallback(() => {
    if (profile) downloadEncodedToken(profile);
  }, [profile]);

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
          gap: 28,
        }}
      >
        <h1
          style={{
            fontSize: "clamp(1.75rem, 5vmin, 2.5rem)",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.02em",
            color: "var(--accent-dark)",
          }}
        >
          sluggr
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--muted)",
            textAlign: "center",
            lineHeight: 1.55,
            maxWidth: 420,
            fontSize: "0.95rem",
          }}
        >
          Upload your player token or create a new one. This browser keeps a session copy only.
          When a run ends, your updated token downloads as{" "}
          <code style={{ fontSize: "0.88em", color: "var(--ink)" }}>{TOKEN_DOWNLOAD_NAME}</code>.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: "clamp(16px, 4vmin, 36px)",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              ...squareBtn,
              background: "var(--accent)",
              color: "#f6faf7",
            }}
          >
            <input
              type="file"
              accept=".sluggr,.json,.txt,text/*,application/json,application/octet-stream"
              style={{ display: "none" }}
              onChange={(e) => onPickTokenFile(e.target.files?.[0] ?? null)}
            />
            Upload
            <br />
            token
          </label>
          <button
            type="button"
            onClick={onCreateNewToken}
            style={{
              ...squareBtn,
              background: "var(--panel)",
              color: "var(--accent-dark)",
            }}
          >
            Create
            <br />
            new token
          </button>
        </div>
        {profile ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Saved token · {profile.id.slice(0, 8)}…
            </p>
            <button
              type="button"
              onClick={beginMatch}
              style={{
                padding: "12px 32px",
                borderRadius: 4,
                border: "2px solid var(--accent-dark)",
                background: "var(--accent-dark)",
                color: "#f6faf7",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Enter arena
            </button>
          </div>
        ) : null}
        {tokenError ? (
          <p style={{ margin: 0, color: "#b44" }} role="alert">
            {tokenError}
          </p>
        ) : null}
        {profile ? (
          <button
            type="button"
            onClick={signOut}
            style={{
              marginTop: 8,
              background: "none",
              border: "none",
              color: "var(--muted)",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Clear saved token
          </button>
        ) : null}
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
          WASD move · Space jump toward cursor · Click knife · R rotate (hold) · Hazard zone
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
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, maxWidth: 360, textAlign: "center", lineHeight: 1.45 }}>
          A copy of your token may have downloaded when the run ended. Use{" "}
          <strong>Save token</strong> if you need the file again.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            width: "100%",
            maxWidth: 320,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={saveTokenAgain}
            style={{
              padding: "14px 20px",
              borderRadius: 4,
              border: "2px solid var(--accent-dark)",
              background: "var(--panel)",
              color: "var(--accent-dark)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              lineHeight: 1.3,
            }}
          >
            Save token (this is required to play again)
          </button>
          <button
            type="button"
            onClick={replayMatch}
            style={{
              padding: "14px 20px",
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
        </div>
      </main>
    );
  }

  return null;
}
