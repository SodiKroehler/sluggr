"use client";

import {
  VortexCanvas,
  type VortexSessionFinish,
} from "@/components/VortexCanvas";
import { MAPS, MAP_LIST, type MapId } from "@/lib/mapRegistry";
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
import { pickOpponent, type AiTrainingPreset } from "@locket/matching";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const TOKEN_FILENAME = "me.sluggr";

type Phase = "token" | "lobby" | "mapSelect" | "play" | "ended";

function applySessionResult(
  token: PlayerToken,
  finish: VortexSessionFinish
): PlayerToken {
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
  const [lastFinish, setLastFinish] = useState<VortexSessionFinish | null>(
    null
  );
  const [tokenSaveFailed, setTokenSaveFailed] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [selectedMapId, setSelectedMapId] = useState<MapId>("vortex");
  const tokenHandleRef = useRef<FileSystemFileHandle | null>(null);
  const legacyFileInputRef = useRef<HTMLInputElement>(null);

  const aiPreset: AiTrainingPreset = useMemo(() => {
    const opp = pickOpponent();
    return opp.source === "ai_training" ? opp.preset : "medium";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reroll opponent when sessionKey bumps
  }, [sessionKey]);

  const mapDef = MAPS[selectedMapId];

  const applyToken = useCallback((parsed: PlayerToken) => {
    writeSessionProfile(parsed);
    setProfile(parsed);
    setPhase("lobby");
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
    async (finish: VortexSessionFinish) => {
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

  const enterArena = useCallback(() => {
    setPhase("mapSelect");
  }, []);

  const startMap = useCallback((id: MapId) => {
    setSelectedMapId(id);
    setSessionKey((k) => k + 1);
    setPhase("play");
  }, []);

  const rematch = useCallback(() => {
    setLastFinish(null);
    setTokenSaveFailed(false);
    setSessionKey((k) => k + 1);
    setPhase("play");
  }, []);

  const chooseNewMap = useCallback(() => {
    setLastFinish(null);
    setTokenSaveFailed(false);
    setPhase("mapSelect");
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
          gap: 24,
          background: "var(--page-bg)",
        }}
      >
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Signed in · {profile.record.wins}W / {profile.record.losses}L
        </p>
        <button
          type="button"
          onClick={enterArena}
          style={{
            padding: "18px 36px",
            borderRadius: 4,
            border: "none",
            background: "var(--accent-dark)",
            color: "#f6faf7",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "clamp(1rem, 2.5vmin, 1.15rem)",
          }}
        >
          Enter arena
        </button>
      </main>
    );
  }

  if (phase === "mapSelect" && profile) {
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
          background: "var(--page-bg)",
        }}
      >
        <h2 style={{ margin: 0, color: "var(--accent-dark)" }}>Choose map</h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "center",
            maxWidth: 560,
          }}
        >
          {MAP_LIST.map((id) => {
            const m = MAPS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => startMap(id)}
                style={{
                  padding: "20px 28px",
                  borderRadius: 8,
                  border: "2px solid var(--accent-dark)",
                  background: "var(--panel)",
                  color: "var(--accent-dark)",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 200,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {m.description}
                </div>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  if (phase === "play" && profile) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <VortexCanvas
            key={sessionKey}
            tuning={mapDef.tuning}
            aiPreset={aiPreset}
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
          Vortex · Ring exit + yellow spiral · R or scroll = new spiral ·
          Right-click damage tile · RELEASE then fast path · ATTRACT returns to ring
        </p>
      </div>
    );
  }

  if (phase === "ended" && profile && lastFinish) {
    const msg =
      lastFinish.winner === "draw"
        ? "Draw."
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <button
            type="button"
            onClick={rematch}
            style={{
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
            Rematch
          </button>
          <button
            type="button"
            onClick={chooseNewMap}
            style={{
              padding: "14px 28px",
              borderRadius: 4,
              border: "2px solid var(--accent-dark)",
              background: "var(--panel)",
              color: "var(--accent-dark)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Play another map
          </button>
        </div>
      </main>
    );
  }

  return <div style={{ minHeight: "100vh", background: "var(--page-bg)" }} />;
}
