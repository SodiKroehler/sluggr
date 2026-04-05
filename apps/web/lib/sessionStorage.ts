import { parsePlayerToken, type PlayerToken } from "./playerToken";

const KEY = "locket_session_profile_v1";

export function readSessionProfile(): PlayerToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return parsePlayerToken(data);
  } catch {
    return null;
  }
}

export function writeSessionProfile(token: PlayerToken): void {
  localStorage.setItem(KEY, JSON.stringify(token));
}

export function clearSessionProfile(): void {
  localStorage.removeItem(KEY);
}
