/**
 * Minimal base64 -> Int16Array decoder (little-endian byte pairs).
 * Pure, zero-dependency, environment-agnostic (no Buffer/atob) so the tables
 * load identically in workers, browsers, and Node.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REV = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) REV[ALPHABET.charCodeAt(i)] = i;

/** Decode base64 (with or without padding) into raw bytes. */
export function b64ToBytes(b64: string): Uint8Array {
  let end = b64.length;
  while (end > 0 && b64.charCodeAt(end - 1) === 61 /* '=' */) end--;
  const byteLen = Math.floor((end * 3) / 4);
  const out = new Uint8Array(byteLen);
  let o = 0;
  let i = 0;
  for (; i + 4 <= end; i += 4) {
    const a = REV[b64.charCodeAt(i)]!;
    const b = REV[b64.charCodeAt(i + 1)]!;
    const c = REV[b64.charCodeAt(i + 2)]!;
    const d = REV[b64.charCodeAt(i + 3)]!;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 0xff;
    out[o++] = (n >> 8) & 0xff;
    out[o++] = n & 0xff;
  }
  const rem = end - i;
  if (rem === 2) {
    const a = REV[b64.charCodeAt(i)]!;
    const b = REV[b64.charCodeAt(i + 1)]!;
    out[o++] = ((a << 2) | (b >> 4)) & 0xff;
  } else if (rem === 3) {
    const a = REV[b64.charCodeAt(i)]!;
    const b = REV[b64.charCodeAt(i + 1)]!;
    const c = REV[b64.charCodeAt(i + 2)]!;
    out[o++] = ((a << 2) | (b >> 4)) & 0xff;
    out[o++] = ((b << 4) | (c >> 2)) & 0xff;
  }
  return out;
}

/** Decode base64 of little-endian int16 pairs into an Int16Array. */
export function b64ToInt16(b64: string): Int16Array {
  const bytes = b64ToBytes(b64);
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)) << 16 >> 16;
  }
  return out;
}
