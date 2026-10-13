// SPDX-License-Identifier: Apache-2.0
// NightPoll vote relayer (Wave 3 prototype). Pays the DUST fee for members' already-proven, bound vote txs.
//
//   NP_NETWORK=undeployed|preview  NP_RELAYER_SEED_FILE=.secrets/preview-relayer.seed (or NP_RELAYER_SEED=<hex seed of a THROWAWAY wallet with NIGHT registered for DUST>
//   NP_RELAYER_CONTRACTS=<addr>[,<addr>]  [NP_RELAYER_PORT=8790]  npm run relayer -w @nightpoll/cli
//
// Safety: refuses mainnet; requires an explicit relayer seed (never falls back to the CLI's own wallet seed,
// except the public genesis seed on the local `undeployed` chain).
import fs from 'node:fs';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { envFor, type NetworkName, UNDEPLOYED_GENESIS_SEED } from '../config.js';
import { NightPollWallet } from '../wallet.js';
import { createRelayerServer } from './server.js';
import { limitsFromEnv } from './limits.js';
import { walletSponsor } from './sponsor.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty' } });
const network = process.env.NP_NETWORK ?? 'undeployed';
if (!['undeployed', 'preview', 'preprod'].includes(network)) throw new Error(`relayer refuses network ${network}`);
const seedFile = process.env.NP_RELAYER_SEED_FILE;
const seed = (seedFile ? fs.readFileSync(seedFile, 'utf8').trim() : process.env.NP_RELAYER_SEED) ?? (network === 'undeployed' ? UNDEPLOYED_GENESIS_SEED : undefined);
if (!seed) throw new Error('set NP_RELAYER_SEED to a throwaway relayer wallet seed');
const contracts = (process.env.NP_RELAYER_CONTRACTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (contracts.length === 0) throw new Error('set NP_RELAYER_CONTRACTS to the poll contract address(es) to sponsor');
// The Wave 2 submitted demo poll is never sponsored (Wave 3 uses new polls only).
const DEMO = '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a';
if (contracts.includes(DEMO)) throw new Error('refusing to sponsor the submitted Wave 2 demo poll');
const entryPoints = (process.env.NP_RELAYER_ENTRYPOINTS ?? 'vote,register').split(',').map((s) => s.trim()).filter(Boolean);

setNetworkId(network);
const wallet = await NightPollWallet.build(logger, envFor(network as NetworkName), seed);
await wallet.start();
// Sync, and register the relayer's NIGHT for DUST generation if that hasn't happened yet.
await wallet.ensureDust(await wallet.sync());
logger.info(`relayer DUST balance: ${await wallet.dustBalance()}`);
const server = createRelayerServer(walletSponsor(wallet, network), {
  allowedContracts: contracts,
  allowedEntryPoints: entryPoints,
  log: (m) => logger.info(m),
  ...limitsFromEnv(process.env),
});
const port = Number(process.env.NP_RELAYER_PORT ?? 8790);
server.listen(port, '127.0.0.1', () => logger.info(`relayer listening on http://127.0.0.1:${port} for ${contracts.join(', ')}`));
