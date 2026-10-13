// SPDX-License-Identifier: Apache-2.0
// Relayer spend limits from environment variables. Unset -> safe defaults in server.ts (DEFAULT_LIMITS).
//   NP_RELAYER_PER_CLIENT (per IP per window, 3)  NP_RELAYER_GLOBAL (per window, 60)  NP_RELAYER_WINDOW_MS (600000)
//   NP_RELAYER_MAX_FEE (specks per tx)  NP_RELAYER_DAILY_TX (per contract, 500)  NP_RELAYER_DAILY_DUST (specks per contract)
//   NP_RELAYER_MIN_DUST (refuse below)  NP_RELAYER_WARN_DUST (/health degraded below; default 2 x MIN)
import type { RelayerOptions } from './server.js';

const big = (v: string | undefined, name: string): bigint | undefined => {
  if (v === undefined || v === '') return undefined;
  if (!/^\d+$/.test(v)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(v);
};
const int = (v: string | undefined, name: string): number | undefined => {
  const b = big(v, name);
  if (b === undefined) return undefined;
  if (b < 1n) throw new Error(`${name} must be >= 1`);
  return Number(b);
};

export function limitsFromEnv(env: Record<string, string | undefined>): Partial<RelayerOptions> {
  const o: Partial<RelayerOptions> = {
    perClientPerWindow: int(env.NP_RELAYER_PER_CLIENT, 'NP_RELAYER_PER_CLIENT'),
    globalPerWindow: int(env.NP_RELAYER_GLOBAL, 'NP_RELAYER_GLOBAL'),
    windowMs: int(env.NP_RELAYER_WINDOW_MS, 'NP_RELAYER_WINDOW_MS'),
    maxFeePerTx: big(env.NP_RELAYER_MAX_FEE, 'NP_RELAYER_MAX_FEE'),
    dailyMaxTxPerContract: int(env.NP_RELAYER_DAILY_TX, 'NP_RELAYER_DAILY_TX'),
    dailyMaxDustPerContract: big(env.NP_RELAYER_DAILY_DUST, 'NP_RELAYER_DAILY_DUST'),
    minDustBalance: big(env.NP_RELAYER_MIN_DUST, 'NP_RELAYER_MIN_DUST'),
    warnDustBalance: big(env.NP_RELAYER_WARN_DUST, 'NP_RELAYER_WARN_DUST'),
  };
  for (const k of Object.keys(o) as (keyof typeof o)[]) if (o[k] === undefined) delete o[k];
  return o;
}
