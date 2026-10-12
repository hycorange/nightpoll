// SPDX-License-Identifier: Apache-2.0
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { checkNetwork, REQUIRED_NETWORK } from './guard';

/** Prefer Lace (`mnLace`), otherwise the only injected Midnight wallet. */
export function pickWallet(injected: Record<string, InitialAPI> | undefined): { id: string; api: InitialAPI } {
  if (!injected) throw new Error('No Midnight wallet found. Install Lace and reload the page.');
  if (injected.mnLace) return { id: 'mnLace', api: injected.mnLace };
  const ids = Object.keys(injected);
  if (ids.length === 1) return { id: ids[0], api: injected[ids[0]] };
  throw new Error(ids.length ? `several wallets injected (${ids.join(', ')}); Lace (mnLace) not among them` : 'No Midnight wallet found.');
}

export function majorVersion(v: string): number { return Number(String(v).split('.')[0]); }

export async function connectPreview(injected: Record<string, InitialAPI> | undefined) {
  const { id, api } = pickWallet(injected);
  if (majorVersion(api.apiVersion) !== 4) throw new Error(`wallet connector API ${api.apiVersion}; this page needs 4.x`);
  const connected: ConnectedAPI = await api.connect(REQUIRED_NETWORK);
  const config = await connected.getConfiguration();
  checkNetwork(config.networkId);
  return { id, name: api.name, connected, config };
}
