// SPDX-License-Identifier: Apache-2.0
// Minimal bech32m decoder (no Buffer) for Midnight keys such as `mn_shield-cpk_preview1…`.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M = 0x2bc830a3;

const polymod = (values: number[]) => {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
};
const hrpExpand = (hrp: string) => [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));

export function decodeBech32m(s: string): { hrp: string; bytes: Uint8Array } {
  const str = s.toLowerCase();
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) throw new Error('not a bech32m string');
  const hrp = str.slice(0, pos);
  const data = [...str.slice(pos + 1)].map((c) => { const v = CHARSET.indexOf(c); if (v < 0) throw new Error('bad bech32m char'); return v; });
  if (polymod(hrpExpand(hrp).concat(data)) !== BECH32M) throw new Error('bad bech32m checksum');
  let acc = 0, bits = 0; const out: number[] = [];
  for (const v of data.slice(0, -6)) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); } }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) throw new Error('bad bech32m padding');
  return { hrp, bytes: Uint8Array.from(out) };
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => { if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error('bad hex'); return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)); };

/** Lace may return keys as hex or as Midnight bech32m; midnight-js wants hex. */
export function keyToHex(k: string): string {
  if (/^[0-9a-f]{64}$/i.test(k)) return k.toLowerCase();
  if (k.startsWith('mn_')) return toHex(decodeBech32m(k).bytes);
  throw new Error(`unrecognized key format: ${k.slice(0, 16)}…`);
}
