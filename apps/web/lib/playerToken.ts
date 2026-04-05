export type PlayerToken = {
  v: number;
  id: string;
  playstyle: { aggression: number; mobility: number };
  record: { wins: number; losses: number };
  proficiency: {
    weapons: Record<string, unknown>;
    maps: Record<string, unknown>;
    teammates: Record<string, unknown>;
  };
  personality: [number, number, number, number];
};

const DEFAULT_PROFICIENCY = {
  weapons: {},
  maps: {},
  teammates: {},
} as const;

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function parsePlayerToken(raw: unknown): PlayerToken | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  const ps = raw.playstyle;
  if (!isRecord(ps) || !isNum(ps.aggression) || !isNum(ps.mobility)) return null;
  const rec = raw.record;
  if (!isRecord(rec) || !isNum(rec.wins) || !isNum(rec.losses)) return null;
  const prof = raw.proficiency;
  if (!isRecord(prof)) return null;
  const weapons = prof.weapons;
  const maps = prof.maps;
  const teammates = prof.teammates;
  if (!isRecord(weapons) || !isRecord(maps) || !isRecord(teammates)) return null;
  const pers = raw.personality;
  if (
    !Array.isArray(pers) ||
    pers.length !== 4 ||
    !pers.every(isNum)
  ) {
    return null;
  }
  return {
    v: 1,
    id: raw.id,
    playstyle: { aggression: ps.aggression, mobility: ps.mobility },
    record: { wins: rec.wins, losses: rec.losses },
    proficiency: { weapons, maps, teammates },
    personality: [pers[0], pers[1], pers[2], pers[3]],
  };
}

export function createGuestToken(): PlayerToken {
  return {
    v: 1,
    id: crypto.randomUUID(),
    playstyle: { aggression: 0.5, mobility: 0.5 },
    record: { wins: 0, losses: 0 },
    proficiency: { ...DEFAULT_PROFICIENCY },
    personality: [0.5, 0.5, 0.5, 0.5],
  };
}
