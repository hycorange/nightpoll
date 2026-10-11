// Network endpoints. Preview has public node/indexer endpoints; Preprod is served via
// Blockfrost and needs a BLOCKFROST_PROJECT_ID (account), so we default to Preview.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ZK_PATH = path.join(ROOT, 'contract', 'src', 'managed', 'nightpoll');
export const SECRETS_DIR = path.join(ROOT, '.secrets');
export const STATE_DIR = path.join(ROOT, '.secrets', 'state');

export type NetworkName = 'preview' | 'preprod' | 'undeployed';

/** Genesis wallet of the local `undeployed` dev chain (pre-funded NIGHT; same seed testkit-js uses). */
export const UNDEPLOYED_GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export const envFor = (network: NetworkName): EnvironmentConfiguration => {
  const proofServer = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';
  if (network === 'undeployed') {
    // Local stack from scripts/localnet.sh (midnight-node CFG_PRESET=dev + indexer-standalone + proof-server).
    const host = process.env.LOCALNET_HOST ?? '127.0.0.1';
    const nodePort = process.env.LOCALNET_NODE_PORT ?? '9944';
    const idxPort = process.env.LOCALNET_INDEXER_PORT ?? '8088';
    return {
      walletNetworkId: 'undeployed',
      networkId: 'undeployed',
      indexer: `http://${host}:${idxPort}/api/v4/graphql`,
      indexerWS: `ws://${host}:${idxPort}/api/v4/graphql/ws`,
      node: `http://${host}:${nodePort}`,
      nodeWS: `ws://${host}:${nodePort}`,
      faucet: undefined,
      proofServer,
    } as EnvironmentConfiguration;
  }
  if (network === 'preview') {
    return {
      walletNetworkId: 'preview',
      networkId: 'preview',
      indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preview.midnight.network',
      nodeWS: 'wss://rpc.preview.midnight.network',
      faucet: 'https://faucet.preview.midnight.network/',
      proofServer,
    };
  }
  const id = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!id) throw new Error('Preprod needs BLOCKFROST_PROJECT_ID (Blockfrost account).');
  const k = (u: string) => `${u}?project_id=${encodeURIComponent(id)}`;
  return {
    walletNetworkId: 'preprod',
    networkId: 'preprod',
    indexer: k('https://midnight-preprod.blockfrost.io/api/v0'),
    indexerWS: k('wss://midnight-preprod.blockfrost.io/api/v0/ws'),
    node: k('https://rpc.midnight-preprod.blockfrost.io'),
    nodeWS: k('wss://rpc.midnight-preprod.blockfrost.io'),
    faucet: 'https://faucet.preprod.midnight.network/',
    proofServer,
  };
};
