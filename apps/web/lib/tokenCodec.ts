/**
 * Opaque on-disk encoding for the token file (not cryptographic).
 * Upload decodes to JSON; session end encodes for download.
 */
export function encodeTokenPayload(obj: object): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

export function decodeTokenPayload(encoded: string): unknown {
  const bin = atob(encoded.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as unknown;
}
