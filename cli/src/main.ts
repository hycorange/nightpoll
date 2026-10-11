// NightPoll CLI.  Usage: npm run np -- <command> [--flags]
//   wallet                         create/load testnet seed, print addresses + balances
//   fund                           sync, wait for NIGHT, register NIGHT for DUST (fees)
//   deploy --question Q --options N [--closed] [--as admin]
//   register --contract A --as NAME     (self-registration)
//   commitment --contract A --as NAME   (print commitment for admin-curated flow)
//   add-member --contract A --commitment HEX [--as admin]
//   open|close --contract A [--as admin]
//   vote --contract A --as NAME --choice K
//   tally --contract A
//   (network: --network preview|preprod|undeployed or NP_NETWORK=...; undeployed = scripts/localnet.sh)
//   e2e [--question Q --options N]   one process, one sync: fund, deploy, 2x register + 1x add-member, open, 3x vote,
//                                    double-vote attempt (must fail), close, tally; prints all tx ids
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import fs from 'node:fs';
import path from 'node:path';
import { envFor, type NetworkName, UNDEPLOYED_GENESIS_SEED, ROOT } from './config.js';
import { loadOrCreateSeed, NightPollWallet, isSynced } from './wallet.js';
import { firstValueFrom, filter, timeout } from 'rxjs';
import { buildProviders, deployPoll, joinPoll, psId, readLedger, phaseName, type NightPollProviders } from './api.js';
import { pureCircuits } from '../../contract/src/managed/nightpoll/contract/index.js';
import type { NightPollPrivateState } from '../../contract/src/witnesses.js';

(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty' } });

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true') : def;
};
const need = (name: string): string => {
  const v = flag(name);
  if (!v) throw new Error(`missing --${name}`);
  return v;
};

const network = (flag('network', process.env.NP_NETWORK ?? process.env.MIDNIGHT_NETWORK ?? 'preview') as NetworkName);

async function main() {
  setNetworkId(network);
  const env = envFor(network);
  if (!['preview', 'preprod', 'undeployed'].includes(network)) throw new Error(`unknown network ${network}`);
  // On the local dev chain use the pre-funded genesis wallet (override with NP_SEED).
  const seed = process.env.NP_SEED ?? (network === 'undeployed' ? UNDEPLOYED_GENESIS_SEED : loadOrCreateSeed(network, logger));
  const wallet = await NightPollWallet.build(logger, env, seed);
  await wallet.start();
  try {
    const addr = await wallet.addresses();
    if (cmd === 'wallet') {
      logger.info(`network=${network}`);
      logger.info(`unshielded address (faucet): ${addr.unshielded}`);
      logger.info(`shielded coin public key: ${addr.shieldedCoinPublicKey}`);
      if (flag('sync')) {
        const s = await wallet.sync();
        logger.info(`balances: unshielded=${JSON.stringify(s.unshielded.balances, big)} dust=${s.dust.balance(new Date())}`);
      }
      return;
    }
    let state = await wallet.sync();
    if (cmd === 'e2e' && Object.values(state.unshielded.balances).every((b) => b === 0n)) {
      logger.info(`no NIGHT yet - waiting for faucet tokens at ${addr.unshielded} ...`);
      state = await firstValueFrom(wallet.wallet.state().pipe(
        filter((s) => isSynced(s) && Object.values(s.unshielded.balances).some((b) => b > 0n)), timeout(Number(flag('wait-min', '120')) * 60_000)));
    }
    const night = Object.values(state.unshielded.balances).reduce((a, b) => a + b, 0n);
    logger.info(`synced: NIGHT=${night} DUST=${state.dust.balance(new Date())}`);
    if (cmd === 'fund') {
      if (night === 0n) throw new Error(`no NIGHT yet; request faucet tokens for ${addr.unshielded}`);
      const tx = await wallet.ensureDust(state);
      logger.info(tx ? `DUST registration tx ${tx}` : 'DUST already available');
      return;
    }
    const providers = buildProviders(env, wallet);
    const as = flag('as', 'admin')!;
    switch (cmd) {
      case 'deploy': {
        const d = await deployPoll(providers, as, need('question'), Number(flag('options', '2')), !flag('closed'));
        const p = d.deployTxData.public;
        out({ contractAddress: p.contractAddress, txId: p.txId, txHash: p.txHash, blockHeight: p.blockHeight });
        return;
      }
      case 'tally': return showTally(providers, need('contract'));
      case 'e2e': return e2e(providers, wallet, state);
      case 'commitment': {
        const c = await joinPoll(providers, need('contract'), as);
        const ps = (await providers.privateStateProvider.get(psId(as))) as NightPollPrivateState;
        const l = await readLedger(providers, need('contract'));
        out({ identity: as, commitment: toHex(pureCircuits.memberCommitment(l!.pollId, ps.secretKey)), contract: c.deployTxData.public.contractAddress });
        return;
      }
      default: {
        const c = await joinPoll(providers, need('contract'), as);
        const call = c.callTx as unknown as Record<string, (...a: unknown[]) => Promise<{ public: { txId: string; txHash: string; blockHeight: number } }>>;
        let r;
        if (cmd === 'register') r = await call.register();
        else if (cmd === 'add-member') r = await call.addMember(hexBytes(need('commitment')));
        else if (cmd === 'open') r = await call.openVoting();
        else if (cmd === 'close') r = await call.closePoll();
        else if (cmd === 'vote') r = await call.vote(BigInt(need('choice')));
        else throw new Error(`unknown command ${cmd}`);
        out({ circuit: cmd, as, txId: r.public.txId, txHash: r.public.txHash, blockHeight: r.public.blockHeight });
        return showTally(providers, need('contract'));
      }
    }
  } finally {
    await wallet.stop();
  }
}

async function e2e(providers: NightPollProviders, wallet: NightPollWallet, state: Awaited<ReturnType<NightPollWallet['sync']>>) {
  type Tx = { txId: string; txHash?: string; blockHeight?: number };
  type Pub = { public: { txId: string; txHash: string; blockHeight: number } };
  const txs: Record<string, Tx> = {};
  const rec = (name: string, r: Pub) => {
    txs[name] = { txId: r.public.txId, txHash: r.public.txHash, blockHeight: r.public.blockHeight };
    logger.info(`${name}: tx ${r.public.txHash} (block ${r.public.blockHeight})`);
  };
  const startedAt = new Date().toISOString();
  const dustTx = await wallet.ensureDust(state);
  if (dustTx) txs['dust-registration'] = { txId: dustTx };
  else if (process.env.NP_DUST_REG_TX) txs['dust-registration'] = { txId: process.env.NP_DUST_REG_TX, txHash: process.env.NP_DUST_REG_HASH, blockHeight: process.env.NP_DUST_REG_BLOCK ? Number(process.env.NP_DUST_REG_BLOCK) : undefined }; // registered in an earlier run
  const question = flag('question', 'NightPoll demo: best day for the community call?')!;
  const d = await deployPoll(providers, 'admin', question, Number(flag('options', '3')), true);
  const addr = d.deployTxData.public.contractAddress;
  rec('deploy', d.deployTxData as unknown as Pub);
  logger.info(`deployed NightPoll at ${addr}`);
  type Call = Record<string, (...a: unknown[]) => Promise<Pub>>;
  const as = async (id: string) => (await joinPoll(providers, addr, id)).callTx as unknown as Call;
  const members = ['alice', 'bob', 'carol'];
  // alice + bob self-register; carol uses the admin-curated flow (sends her commitment off-chain, admin adds it)
  for (const m of members.slice(0, 2)) rec(`register:${m}`, await (await as(m)).register());
  await as('carol');
  const carolSk = ((await providers.privateStateProvider.get(psId('carol'))) as NightPollPrivateState).secretKey;
  const pollId = (await readLedger(providers, addr))!.pollId;
  const carolCommitment = toHex(pureCircuits.memberCommitment(pollId, carolSk));
  logger.info(`carol commitment (sent to admin off-chain): ${carolCommitment}`);
  rec('addMember:carol', await (await as('admin')).addMember(hexBytes(carolCommitment)));
  rec('openVoting', await (await as('admin')).openVoting());
  const choices = [0n, 2n, 2n];
  for (const [i, m] of members.entries()) rec(`vote:${m}`, await (await as(m)).vote(choices[i]));
  let doubleVote = 'accepted (BUG)';
  try { await (await as('alice')).vote(1n); } catch (e) { doubleVote = `rejected: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`; }
  logger.info('tally while voting is open:'); await showTally(providers, addr);
  rec('closePoll', await (await as('admin')).closePoll());
  out({ network, contractAddress: addr, txs, doubleVote });
  const final = await showTally(providers, addr);
  // machine-readable summary for scripts/demo.sh -> scripts/summary.mjs
  const file = path.join(ROOT, 'logs', `e2e-summary-${network}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ network, startedAt, finishedAt: new Date().toISOString(), contractAddress: addr, question,
    wallet: (await wallet.addresses()).unshielded, txs, doubleVote, carolCommitment, final }, null, 2) + '\n');
  logger.info(`summary written to ${path.relative(ROOT, file)}`);
}

async function showTally(providers: NightPollProviders, contract: string) {
  const l = await readLedger(providers, contract);
  if (!l) throw new Error(`no NightPoll at ${contract}`);
  const tally: Record<string, string> = {};
  for (let i = 0n; i < l.optionCount; i++) tally[i.toString()] = (l.tally.member(i) ? l.tally.lookup(i).read() : 0n).toString();
  const r = { contract, question: l.question, phase: phaseName(l.phase), members: l.memberCount.toString(), totalVotes: l.totalVotes.toString(), nullifiers: l.nullifiers.size().toString(), tally };
  out(r);
  return r;
}

const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
const out = (o: unknown) => console.log('RESULT ' + JSON.stringify(o, big));
const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

main().then(() => process.exit(0)).catch((e) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
