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

type Injected = Record<string, InitialAPI> | undefined;
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lace injects `window.midnight` from its content script, which can land after the page's first render on a hard
 * refresh. Poll for a usable entry (default up to 3 s) instead of failing on the first look.
 */
export async function waitForWallet(
  get: () => Injected,
  { timeoutMs = 3000, intervalMs = 100, log = (_: string) => {}, sleep = sleepMs }: { timeoutMs?: number; intervalMs?: number; log?: (m: string) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Entry> {
  let waited = 0;
  for (;;) {
    try {
      const e = pickWallet(get());
      if (waited > 0) log(`wallet injected after ~${waited} ms`);
      return e;
    } catch (err) {
      if (waited >= timeoutMs) throw new Error(`No Midnight wallet found after ${timeoutMs} ms (window.midnight ${get() ? 'has no usable entry' : 'is undefined'}). Install/unlock Lace and reload the page.`);
      if (waited === 0) log('waiting for Lace to inject window.midnight…');
      await sleep(intervalMs);
      waited += intervalMs;
    }
  }
}

/** Reject if a wallet call never settles, so the page log says so instead of hanging silently. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s (check for a Lace popup, unlock Lace, then click Connect again)`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export async function connectPreview(
  injected: Injected | (() => Injected),
  log: (m: string) => void = () => {},
  opts: { waitMs?: number; connectTimeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const get = typeof injected === 'function' ? injected : () => injected;
  const { id, api, via } = await waitForWallet(get, { timeoutMs: opts.waitMs ?? 3000, log, sleep: opts.sleep });
  log(`wallet: ${api.name ?? id} (key ${id}, rdns ${api.rdns || '-'}, api ${api.apiVersion}) via ${via}`);
  if (majorVersion(api.apiVersion) !== 4) throw new Error(`wallet connector API ${api.apiVersion}; this page needs 4.x`);
  log(`connect: asking ${api.name ?? id} for "${REQUIRED_NETWORK}" (approve the Lace popup if shown)…`);
  const connected: ConnectedAPI = await withTimeout(Promise.resolve(api.connect(REQUIRED_NETWORK)), opts.connectTimeoutMs ?? 120_000, 'Lace connect()');
  const config = await withTimeout(Promise.resolve(connected.getConfiguration()), opts.connectTimeoutMs ?? 120_000, 'Lace getConfiguration()');
  checkNetwork(config.networkId);
  return { id, via, name: api.name, connected, config };
}
