// SPDX-License-Identifier: Apache-2.0
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { checkNetwork, REQUIRED_NETWORK } from './guard';

export const LACE_RDNS = 'io.lace.wallet';
type Entry = { id: string; api: InitialAPI; via: string };
const hasConnect = (v: unknown): v is InitialAPI => !!v && typeof (v as InitialAPI).connect === 'function';

/**
 * Real Lace (connector API 4.0.1) injects under a non-fixed key, e.g. Object.values(window.midnight)[0],
 * with rdns 'io.lace.wallet'. Prefer that entry, else the first entry with connect(); `mnLace` is a last fallback.
 */
export function pickWallet(injected: Record<string, InitialAPI> | undefined): Entry {
  const all = Object.entries(injected || {}).filter(([, v]) => hasConnect(v));
  const lace = all.find(([, v]) => v.rdns === LACE_RDNS);
  if (lace) return { id: lace[0], api: lace[1], via: `rdns ${LACE_RDNS}` };
  if (all.length) return { id: all[0][0], api: all[0][1], via: 'first entry with connect()' };
  const legacy = (injected as Record<string, unknown> | undefined)?.mnLace;
  if (hasConnect(legacy)) return { id: 'mnLace', api: legacy, via: 'mnLace fallback' };
  throw new Error('No Midnight wallet found. Install Lace and reload the page.');
}

/** Lace 4.0.1 only has getUnshieldedAddress (singular); fall back to a plural getUnshieldedAddresses if present. */
export async function getUnshieldedAddress(c: unknown): Promise<string | undefined> {
  const a = c as { getUnshieldedAddress?: () => Promise<unknown>; getUnshieldedAddresses?: () => Promise<unknown> };
  const pick = (r: unknown): string | undefined => {
    if (r == null) return undefined;
    if (typeof r === 'string') return r;
    if (Array.isArray(r)) return pick(r[0]);
    const o = r as Record<string, unknown>;
    return typeof o.unshieldedAddress === 'string' ? o.unshieldedAddress : typeof o.address === 'string' ? o.address : undefined;
  };
  if (typeof a.getUnshieldedAddress === 'function') return pick(await a.getUnshieldedAddress());
  if (typeof a.getUnshieldedAddresses === 'function') return pick(await a.getUnshieldedAddresses());
  return undefined;
}

export function majorVersion(v: string): number { return Number(String(v).split('.')[0]); }

export async function connectPreview(injected: Record<string, InitialAPI> | undefined, log: (m: string) => void = () => {}) {
  const { id, api, via } = pickWallet(injected);
  log(`wallet: ${api.name ?? id} (key ${id}, rdns ${api.rdns || '-'}, api ${api.apiVersion}) via ${via}`);
  if (majorVersion(api.apiVersion) !== 4) throw new Error(`wallet connector API ${api.apiVersion}; this page needs 4.x`);
  const connected: ConnectedAPI = await api.connect(REQUIRED_NETWORK);
  const config = await connected.getConfiguration();
  checkNetwork(config.networkId);
  return { id, via, name: api.name, connected, config };
}
