// SPDX-License-Identifier: Apache-2.0
/** The Wave 2 submitted demo poll on Preview. The Wave 3 vote page never sends transactions to it. */
export const DEMO_CONTRACT = '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a';
export const REQUIRED_NETWORK = 'preview';

export function validateTarget(raw: string): { ok: true; address: string } | { ok: false; reason: string } {
  const a = raw.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(a)) return { ok: false, reason: 'contract address must be 64 hex characters' };
  if (a === DEMO_CONTRACT) return { ok: false, reason: 'this is the submitted Wave 2 demo poll; use a new Wave 3 poll' };
  return { ok: true, address: a };
}

export function checkNetwork(networkId: string): void {
  if (networkId !== REQUIRED_NETWORK) throw new Error(`wallet is on "${networkId}", switch Lace to Midnight Preview (never mainnet)`);
}
