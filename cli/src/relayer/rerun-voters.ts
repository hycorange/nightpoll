// SPDX-License-Identifier: Apache-2.0
// M5 live rerun helper (Preview/undeployed): N fresh members with NO wallet register or vote through the HTTP
// relayer at the same time, so the relayer's jitter + mixing window are exercised for real. Each member builds +
// proves locally (proof server), seals with tx.bind() (a NightPoll call moves no value), then POSTs.
// Member secret keys are throwaway and kept in NP_VOTER_KEYS (default .secrets/rerun-voters.json, chmod 600).
//   npm run -s rerun:voters -w @nightpoll/cli -- register --contract <addr> --n 3
//   npm run -s rerun:voters -w @nightpoll/cli -- vote --contract <addr> [--choices 0,2,1] [--only 2]   (--only: retry those member indexes)
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import * as NP from '../../../contract/src/managed/nightpoll/contract/index.js';
import { CompiledNightPoll, type CircuitKeys } from '../api.js';
import { envFor, SECRETS_DIR, ZK_PATH, type NetworkName } from '../config.js';

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const cmd = argv[0];
const network = (process.env.NP_NETWORK ?? 'preview') as NetworkName;
const contract = flag('contract');
const relayerUrl = process.env.NP_RELAYER_URL ?? 'http://127.0.0.1:8790';
if (!contract || !['register', 'vote', 'status'].includes(cmd)) throw new Error('usage: register|vote|status --contract <addr> [--n N] [--choices a,b,c]');
if (contract === '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a') throw new Error('never touch the Wave 2 demo poll');
setNetworkId(network);
const env = envFor(network);
const keysFile = process.env.NP_VOTER_KEYS ?? path.join(SECRETS_DIR, 'rerun-voters.json');
type Keys = Record<string, string[]>;
const loadKeys = (): Keys => (fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, 'utf8')) : {});
const saveKeys = (k: Keys) => fs.writeFileSync(keysFile, JSON.stringify(k, null, 1), { mode: 0o600 });
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

const zk = new NodeZkConfigProvider<CircuitKeys>(ZK_PATH);
const pdp = indexerPublicDataProvider(env.indexer, env.indexerWS);
const proof = httpClientProofProvider(env.proofServer, zk);

function providersFor(sk: Uint8Array) {
  let state: { secretKey: Uint8Array } | null = { secretKey: sk };
  const coin = hex(randomBytes(32)); // never used to receive anything; the call moves no value
  return {
    zkConfigProvider: zk, publicDataProvider: pdp,
    privateStateProvider: {
      setContractAddress() {}, async set(_i: string, s: { secretKey: Uint8Array }) { state = s; }, async get() { return state; },
      async remove() { state = null; }, async clear() { state = null; },
      async setSigningKey() {}, async getSigningKey() { return null; }, async removeSigningKey() {}, async clearSigningKeys() {},
    },
    walletProvider: { getCoinPublicKey: () => coin, getEncryptionPublicKey: () => hex(randomBytes(32)), balanceTx: () => { throw new Error('no wallet'); } },
  };
}

async function proveAndBind(sk: Uint8Array, circuitId: 'register' | 'vote', args: unknown[]): Promise<string> {
  const u = await createUnprovenCallTx(providersFor(sk) as never, { compiledContract: CompiledNightPoll, contractAddress: contract, circuitId, args, privateStateId: 'nightpoll:rerun' } as never);
  const proven = await proof.proveTx((u as unknown as { private: { unprovenTx: never } }).private.unprovenTx);
  const ser = (proven as unknown as { serialize(): Uint8Array }).serialize();
  const t = Transaction.deserialize('signature', 'proof', 'pre-binding', ser);
  return hex(t.bind().serialize());
}

async function post(tx: string) {
  const res = await fetch(`${relayerUrl}/sponsor/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx }) });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; txId?: string; error?: string };
  return { status: res.status, ...body };
}

async function status() {
  const st = await pdp.queryContractState(contract as never);
  if (!st) throw new Error('contract not found');
  const l = NP.ledger(st.data);
  const tally: string[] = [];
  for (let i = 0n; i < l.optionCount; i++) tally.push((l.tally.member(i) ? l.tally.lookup(i).read() : 0n).toString());
  return { phase: NP.Phase[l.phase], members: l.memberCount.toString(), votes: l.totalVotes.toString(), tally };
}

const keys = loadKeys();
if (cmd === 'status') { console.log('STATUS ' + JSON.stringify(await status())); process.exit(0); }
if (cmd === 'register') {
  const n = Number(flag('n', '3'));
  const sks = Array.from({ length: n }, () => new Uint8Array(randomBytes(32)));
  keys[contract] = [...(keys[contract] ?? []), ...sks.map(hex)]; saveKeys(keys);
  // Prove all first (sequential: the proof server runs 1 worker), then POST them at the same moment.
  const txs: string[] = [];
  for (const [i, sk] of sks.entries()) { txs.push(await proveAndBind(sk, 'register', [])); console.log(`${ts()} member ${i}: register proven+bound (${txs[i].length / 2} B)`); }
  const sent = Date.now();
  const rs = await Promise.all(txs.map(async (tx, i) => { const r = await post(tx); console.log(`${ts()} member ${i}: relayer -> ${r.status} ${r.ok ? r.txId : r.error} after ${((Date.now() - sent) / 1000).toFixed(1)}s`); return { i, ...r, ms: Date.now() - sent }; }));
  console.log('RESULT ' + JSON.stringify({ cmd, contract, results: rs, status: await status() }));
} else {
  const only = flag('only')?.split(',').map(Number); // retry a subset of members by index
  const sks = (keys[contract] ?? []).map((h) => new Uint8Array(Buffer.from(h, 'hex'))).filter((_, i) => !only || only.includes(i));
  if (sks.length === 0) throw new Error('no stored member keys for this contract; run register first');
  const choices = (flag('choices') ?? sks.map((_, i) => String(i % 3)).join(',')).split(',').map((c) => BigInt(c));
  const txs: string[] = [];
  for (const [i, sk] of sks.entries()) { txs.push(await proveAndBind(sk, 'vote', [choices[i]])); console.log(`${ts()} member ${i}: vote(${choices[i]}) proven+bound (${txs[i].length / 2} B)`); }
  const sent = Date.now();
  const rs = await Promise.all(txs.map(async (tx, i) => { const r = await post(tx); console.log(`${ts()} member ${i}: relayer -> ${r.status} ${r.ok ? r.txId : r.error} after ${((Date.now() - sent) / 1000).toFixed(1)}s`); return { i, choice: String(choices[i]), ...r, ms: Date.now() - sent }; }));
  let dbl = '';
  try { await proveAndBind(sks[0], 'vote', [1n]); dbl = 'accepted (BUG)'; } catch (e) { dbl = `rejected: ${String(e).slice(0, 120)}`; }
  console.log('RESULT ' + JSON.stringify({ cmd, contract, results: rs, doubleVote: dbl, status: await status() }));
}
process.exit(0);
