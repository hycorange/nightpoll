// SPDX-License-Identifier: Apache-2.0
// Wave 3 spike (local `undeployed` chain only): a member with an EMPTY, fresh wallet registers and votes;
// the relayer (genesis wallet on the dev chain) pays every DUST fee through the same policy + sponsor code
// the HTTP service uses. Run: scripts/localnet.sh start && npm run -s spike -w @nightpoll/cli
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { envFor, UNDEPLOYED_GENESIS_SEED } from '../config.js';
import { NightPollWallet } from '../wallet.js';
import { buildProviders, CompiledNightPoll, deployPoll, joinPoll, psId, readLedger, type NightPollProviders } from '../api.js';
import { checkPolicy } from './policy.js';
import { toWire, walletSponsor } from './sponsor.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty' } });
const network = 'undeployed';
setNetworkId(network);
const env = envFor(network);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const out: Record<string, unknown> = {};

const relayer = await NightPollWallet.build(logger, env, UNDEPLOYED_GENESIS_SEED);
await relayer.start();
const voter = await NightPollWallet.build(logger, env, hex(generateRandomSeed())); // fresh throwaway, never funded
await voter.start();
try {
  let rs = await relayer.sync(10 * 60_000);
  await relayer.ensureDust(rs);
  const vs = await voter.sync(10 * 60_000);
  const voterFunds = () => voter.sync(60_000).then((s) => ({ unshielded: Object.values(s.unshielded.balances).reduce((a, b) => a + b, 0n), dust: s.dust.balance(new Date()) }));
  out.voterFundsBefore = await voterFunds();
  logger.info(`voter wallet funds before: ${JSON.stringify(out.voterFundsBefore, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  void vs;

  const adminP = buildProviders(env, relayer);
  const d = await deployPoll(adminP, 'admin', 'Wave 3 spike: sponsored vote', 3, true);
  const addr = d.deployTxData.public.contractAddress;
  logger.info(`deployed ${addr}`);
  out.contract = addr;

  const voterP: NightPollProviders = buildProviders(env, voter);
  await joinPoll(voterP, addr, 'voter'); // creates the voter's local secret key (private state)
  const sponsor = walletSponsor(relayer, network);
  const policy = { allowedContracts: [addr], allowedEntryPoints: ['vote', 'register'] };

  const sponsored = async (circuitId: 'register' | 'vote', args: unknown[]) => {
    // USER side: build + prove locally, balance own value only (no DUST), bind.
    const unsubmitted = await createUnprovenCallTx(voterP as never, { compiledContract: CompiledNightPoll, contractAddress: addr, circuitId, args, privateStateId: psId('voter') } as never);
    const unbound = await voterP.proofProvider.proveTx(unsubmitted.private.unprovenTx);
    const bound = await voter.balanceOwnValueAndFinalize(unbound);
    const wire = toWire(bound);
    // RELAYER side: same checks as the HTTP service, then pay + submit.
    const decision = checkPolicy(sponsor.inspect(wire), wire.length / 2, policy);
    logger.info(`${circuitId}: ${wire.length / 2} bytes, policy ${JSON.stringify(decision)}`);
    if (!decision.ok) throw new Error(decision.reason);
    const txId = await sponsor.sponsorAndSubmit(wire);
    logger.info(`${circuitId}: sponsored tx ${txId}`);
    return { txId, bytes: wire.length / 2 };
  };
  const waitLedger = async (pred: (l: NonNullable<Awaited<ReturnType<typeof readLedger>>>) => boolean) => {
    for (let i = 0; i < 60; i++) { const l = await readLedger(adminP, addr); if (l && pred(l)) return l; await new Promise((r) => setTimeout(r, 2000)); }
    throw new Error('ledger did not reach the expected state');
  };

  out.register = await sponsored('register', []);
  await waitLedger((l) => l.memberCount === 1n);
  const admin = (await joinPoll(adminP, addr, 'admin')).callTx as unknown as { openVoting(): Promise<unknown> };
  await admin.openVoting();
  out.vote = await sponsored('vote', [2n]);
  const l = await waitLedger((x) => x.totalVotes === 1n);
  out.tally = [0n, 1n, 2n].map((k) => (l.tally.member(k) ? l.tally.lookup(k).read() : 0n).toString());
  try { await sponsored('vote', [1n]); out.doubleVote = 'accepted (BUG)'; } catch (e) { out.doubleVote = `rejected: ${String(e).slice(0, 140)}`; }
  out.voterFundsAfter = await voterFunds();
  console.log('RESULT ' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
} finally {
  await voter.stop().catch(() => {});
  await relayer.stop().catch(() => {});
}
