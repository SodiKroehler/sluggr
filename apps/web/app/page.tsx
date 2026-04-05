"use client";

import { GameCanvas, type SessionFinish } from "@/components/GameCanvas";
import { DEFAULT_MAP } from "@/lib/mapConfig";
import {
  createNewToken,
  parsePlayerToken,
  type PlayerToken,
} from "@/lib/playerToken";
import { readSessionProfile, writeSessionProfile } from "@/lib/sessionStorage";
import { decodeTokenPayload, encodeTokenPayload } from "@/lib/tokenCodec";
import {
  idbClearTokenHandle,
  idbSetTokenHandle,
  pickSaveTokenFileHandle,
  pickTokenFileWithPicker,
  readTextFromHandle,
  silentDownload,
  supportsFileSystemAccess,
  supportsSaveFilePicker,
  writeTextToHandle,
} from "@/lib/tokenFileAccess";
import { DEFAULT_COMBAT } from "@/lib/weaponConfig";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const AI_PRESET_LOCKED = "easy" as const;
const TOKEN_FILENAME = "me.sluggr";

type Phase = "token" | "play" | "ended";

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
  const [lastFinish, setLastFinish] = useState<SessionFinish | null>(null);
  const [tokenSaveFailed, setTokenSaveFailed] = useState(false);
  const tokenHandleRef = useRef<FileSystemFileHandle | null>(null);
  const legacyFileInputRef = useRef<HTMLInputElement>(null);

  const mapConfig = useMemo(() => ({ ...DEFAULT_MAP }), []);
  const weaponConfig = useMemo(() => ({ ...DEFAULT_COMBAT }), []);

  const applyToken = useCallback((parsed: PlayerToken) => {
    writeSessionProfile(parsed);
    setProfile(parsed);
    setPhase("play");
  }, []);

  const onCreateNewToken = useCallback(() => {
    tokenHandleRef.current = null;
    void idbClearTokenHandle();
    applyToken(createNewToken());
  }, [applyToken]);

  const loadFromText = useCallback(
    (text: string, handle: FileSystemFileHandle | null) => {
      const raw = decodeTokenFileText(text);
      const parsed = parsePlayerToken(raw);
      if (!parsed) return false;
      tokenHandleRef.current = handle;
      if (handle) {
        void idbSetTokenHandle(handle);
      } else {
        void idbClearTokenHandle();
      }
      applyToken(parsed);
      return true;
    },
    [applyToken]
  );

  const onUploadWithPicker = useCallback(async () => {
    if (supportsFileSystemAccess()) {
      try {
        const h = await pickTokenFileWithPicker();
        const text = await readTextFromHandle(h);
        loadFromText(text, h);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    } else {
      legacyFileInputRef.current?.click();
    }
  }, [loadFromText]);

  const onLegacyFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const text = await file.text();
      loadFromText(text, null);
    },
    [loadFromText]
  );

  const tryPersistTokenToFile = useCallback(
    async (token: PlayerToken): Promise<boolean> => {
      const encoded = encodeTokenPayload(token);
      const existing = tokenHandleRef.current;
      if (existing && supportsFileSystemAccess()) {
        try {
          await writeTextToHandle(existing, encoded);
          return true;
        } catch {
          /* try save picker */
        }
      }
      if (supportsFileSystemAccess() && supportsSaveFilePicker()) {
        try {
          const h = await pickSaveTokenFileHandle();
          await writeTextToHandle(h, encoded);
          await idbSetTokenHandle(h);
          tokenHandleRef.current = h;
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    []
  );

  const onSessionEnd = useCallback(
    async (finish: SessionFinish) => {
      setLastFinish(finish);
      setTokenSaveFailed(false);
      const current = readSessionProfile();
      let saved = false;
      if (current) {
        const updated = applySessionResult(current, finish);
        writeSessionProfile(updated);
        setProfile(updated);
        saved = await tryPersistTokenToFile(updated);
      }
      setTokenSaveFailed(!saved);
      setPhase("ended");
    },
    [tryPersistTokenToFile]
  );

  const replayMatch = useCallback(() => {
    setLastFinish(null);
    setTokenSaveFailed(false);
    setPhase("play");
  }, []);

  const manualDownloadToken = useCallback(() => {
    if (profile) silentDownload(TOKEN_FILENAME, encodeTokenPayload(profile));
  }, [profile]);

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
          background: "var(--page-bg)",
        }}
      >
        <input
          ref={legacyFileInputRef}
          type="file"
          accept=".sluggr,.json,.txt,application/octet-stream,application/json"
          style={{ display: "none" }}
          onChange={onLegacyFileChange}
        />
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
          <button
            type="button"
            onClick={onUploadWithPicker}
            style={{
              ...squareBtn,
              background: "var(--accent)",
              color: "#f6faf7",
              border: "2px solid var(--accent-dark)",
            }}
          >
            Upload
            <br />
            token
          </button>
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
      </main>
    );
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
          WASD move · Space jump toward cursor · Left click knife · Right-click place
          block · Aim with mouse · Hazard zone
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
        <h2 style={{ margin: 0, color: "var(--accent-dark)" }}>Game over</h2>
        <p style={{ margin: 0 }}>{msg}</p>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          Record · {profile.record.wins}W / {profile.record.losses}L
        </p>
        {tokenSaveFailed ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              maxWidth: 380,
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, color: "var(--ink)", lineHeight: 1.5 }}>
              Couldn&apos;t save your token — you&apos;ll need to do so manually.
            </p>
            <button
              type="button"
              onClick={manualDownloadToken}
              style={{
                padding: "12px 24px",
                borderRadius: 4,
                border: "2px solid var(--accent-dark)",
                background: "var(--panel)",
                color: "var(--accent-dark)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Download token
            </button>
          </div>
        ) : null}
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
