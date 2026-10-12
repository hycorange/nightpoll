// SPDX-License-Identifier: Apache-2.0
// Dry-run relayer for page testing: the REAL HTTP layer + deserialize + policy, but it never pays or submits
// (returns a fake txId "dry-run:<bytes>"). No wallet, no seed.  NP_RELAYER_CONTRACTS=<addr> npm run relayer:dry
import { createRelayerServer } from './server.js';
import { deserializeBound } from './sponsor.js';
import { summarize, type TxLike } from './policy.js';

const contracts = (process.env.NP_RELAYER_CONTRACTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!contracts.length) throw new Error('set NP_RELAYER_CONTRACTS');
const server = createRelayerServer({
  network: 'dry-run',
  inspect: (hex) => summarize(deserializeBound(hex) as unknown as TxLike),
  sponsorAndSubmit: async (hex) => `dry-run:${hex.length / 2}`,
  dustBalance: async () => 0n,
}, { allowedContracts: contracts, allowedEntryPoints: ['vote', 'register'], log: (m) => console.log(m) });
const port = Number(process.env.NP_RELAYER_PORT ?? 8790);
server.listen(port, '127.0.0.1', () => console.log(`dry-run relayer on http://127.0.0.1:${port} for ${contracts.join(', ')}`));
