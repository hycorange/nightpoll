// SPDX-License-Identifier: Apache-2.0
// The member's NightPoll secret key, kept only in this browser (localStorage), one per poll.
// It is NOT the Lace wallet key: Lace only pays/approves; the vote secret never leaves the page.
import { fromHex, toHex } from './bech32m';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const slot = (contract: string) => `nightpoll:sk:${contract}`;

export function getKey(kv: KV, contract: string): Uint8Array | null {
  const v = kv.getItem(slot(contract));
  return v ? fromHex(v) : null;
}
export function getOrCreateKey(kv: KV, contract: string, rand: (n: number) => Uint8Array): Uint8Array {
  const k = getKey(kv, contract);
  if (k) return k;
  const sk = rand(32);
  if (sk.length !== 32) throw new Error('rng returned wrong length');
  kv.setItem(slot(contract), toHex(sk));
  return sk;
}
export const exportKey = (kv: KV, contract: string) => kv.getItem(slot(contract));
export function importKey(kv: KV, contract: string, hex: string, overwrite = false): void {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('key must be 64 hex characters');
  const cur = kv.getItem(slot(contract));
  if (cur && cur !== h && !overwrite) throw new Error('a different key is already stored for this poll; export it first');
  kv.setItem(slot(contract), h);
}

/** midnight-js PrivateStateProvider backed by the same storage (state = { secretKey }). */
export function kvPrivateStateProvider(kv: KV) {
  let contract = '';
  const need = () => { if (!contract) throw new Error('setContractAddress first'); return contract; };
  const sig = (a: string) => `nightpoll:sig:${a}`;
  return {
    setContractAddress(a: string) { contract = String(a); },
    async set(_id: string, s: { secretKey: Uint8Array }) { kv.setItem(slot(need()), toHex(s.secretKey)); },
    async get(_id: string) { const k = getKey(kv, need()); return k ? { secretKey: k } : null; },
    async remove() { kv.removeItem(slot(need())); },
    async clear() { kv.removeItem(slot(need())); },
    async setSigningKey(a: string, k: string) { kv.setItem(sig(a), k); },
    async getSigningKey(a: string) { return kv.getItem(sig(a)); },
    async removeSigningKey(a: string) { kv.removeItem(sig(a)); },
    async clearSigningKeys() { /* per-address keys are removed individually */ },
  };
}
