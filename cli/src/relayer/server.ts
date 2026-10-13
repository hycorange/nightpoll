// SPDX-License-Identifier: Apache-2.0
// Transport for the NightPoll vote relayer. All chain work is behind the `Sponsor` interface so the HTTP
// layer and policy are testable without a wallet or network.
//
//   GET  /health        -> { status, network, dust }
//   POST /sponsor/vote  -> { tx: "<hex of FinalizedTransaction>" }  =>  { ok: true, txId } | { ok: false, error }
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { checkPolicy, DailyBudget, RateLimiter, type PolicyConfig, type TxSummary } from './policy.js';

export interface Sponsor {
  network: string;
  /** Deserialize the user's bound tx (throws on malformed input) and return its policy summary. */
  inspect(txHex: string): TxSummary;
  /** Attach the sponsor's DUST fee, finalize, submit; returns the tx id. */
  sponsorAndSubmit(txHex: string): Promise<string>;
  dustBalance(): Promise<bigint>;
  /** Estimated DUST fee (specks) the sponsor would pay for this tx. Used for the max-fee and daily DUST caps. */
  estimateFee?(txHex: string): bigint;
}

export type RelayerOptions = PolicyConfig & {
  perClientPerWindow?: number; // default 3
  globalPerWindow?: number;    // default 60
  windowMs?: number;           // default 10 min
  maxBodyBytes?: number;       // default 1 MB
  maxFeePerTx?: bigint;        // global max estimated fee per tx (specks); default DEFAULT_LIMITS.maxFeePerTx
  dailyMaxTxPerContract?: number; // default 500
  dailyMaxDustPerContract?: bigint; // default DEFAULT_LIMITS.dailyMaxDustPerContract
  minDustBalance?: bigint;     // refuse sponsorship (503) below this floor
  warnDustBalance?: bigint;    // /health reports 'degraded' below this (default 2 x floor)
  clientKey?: (req: IncomingMessage) => string;
  log?: (msg: string) => void;
  now?: () => number;
};

export const DEFAULT_LIMITS = {
  maxFeePerTx: 10n ** 18n,
  dailyMaxTxPerContract: 500,
  dailyMaxDustPerContract: 50n * 10n ** 18n,
  minDustBalance: 10n ** 18n,
};

export function createRelayerServer(sponsor: Sponsor, opts: RelayerOptions): Server {
  const limiter = new RateLimiter(opts.perClientPerWindow ?? 3, opts.globalPerWindow ?? 60, opts.windowMs ?? 600_000, opts.now);
  const maxBody = opts.maxBodyBytes ?? 1_000_000;
  const maxFee = opts.maxFeePerTx ?? DEFAULT_LIMITS.maxFeePerTx;
  const budget = new DailyBudget(opts.dailyMaxTxPerContract ?? DEFAULT_LIMITS.dailyMaxTxPerContract,
    opts.dailyMaxDustPerContract ?? DEFAULT_LIMITS.dailyMaxDustPerContract, opts.now);
  const floor = opts.minDustBalance ?? DEFAULT_LIMITS.minDustBalance;
  const warn = opts.warnDustBalance ?? floor * 2n;
  const log = opts.log ?? (() => {});
  const keyOf = opts.clientKey ?? ((r: IncomingMessage) => r.socket.remoteAddress ?? 'unknown');
  let queue: Promise<unknown> = Promise.resolve(); // one submission at a time (avoids DUST double-spend, error 196)

  const send = (res: ServerResponse, status: number, body: unknown) => {
    if (res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > maxBody) { req.pause(); reject(Object.assign(new Error('body too large'), { status: 413 })); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET' }); res.end(); return; }
      if (req.method === 'GET' && req.url === '/health') { const dust = await sponsor.dustBalance(); send(res, 200, { status: dust < warn ? 'degraded' : 'ok', network: sponsor.network, dust }); return; }
      if (req.method !== 'POST' || req.url !== '/sponsor/vote') { send(res, 404, { ok: false, error: 'not found' }); return; }
      let txHex: unknown;
      try { ({ tx: txHex } = JSON.parse(await readBody(req)) as { tx?: unknown }); }
      catch (e) { send(res, (e as { status?: number }).status ?? 400, { ok: false, error: 'invalid request body' }); return; }
      if (typeof txHex !== 'string' || !/^([0-9a-f]{2})+$/i.test(txHex)) { send(res, 400, { ok: false, error: 'tx must be a hex string' }); return; }
      let summary: TxSummary;
      try { summary = sponsor.inspect(txHex); } catch { send(res, 400, { ok: false, error: 'not a bound NightPoll transaction' }); return; }
      const decision = checkPolicy(summary, txHex.length / 2, opts);
      if (!decision.ok) { log(`rejected: ${decision.reason}`); send(res, 403, { ok: false, error: decision.reason }); return; }
      let fee = 0n;
      try { fee = sponsor.estimateFee?.(txHex) ?? 0n; } catch { send(res, 400, { ok: false, error: 'cannot estimate fee' }); return; }
      if (fee > maxFee) { log('rejected: fee above max'); send(res, 403, { ok: false, error: `fee ${fee} exceeds max ${maxFee}` }); return; }
      const contract = summary.calls[0].address;
      const b = budget.check(contract, fee);
      if (!b.ok) { log(`rejected: ${b.reason}`); send(res, 429, { ok: false, error: b.reason }); return; }
      if (!limiter.take(keyOf(req))) { send(res, 429, { ok: false, error: 'rate limit exceeded' }); return; }
      if ((await sponsor.dustBalance()) < floor) { log('refused: DUST below floor'); send(res, 503, { ok: false, error: 'relayer DUST balance too low' }); return; }
      budget.record(contract, fee); // reserve before submitting (concurrent requests can't overshoot the cap)
      const job = queue.then(() => sponsor.sponsorAndSubmit(txHex as string));
      queue = job.catch(() => undefined);
      try { const txId = await job; log(`sponsored vote tx ${txId}`); send(res, 200, { ok: true, txId }); }
      catch (e) { log(`submit failed: ${String(e)}`); send(res, 502, { ok: false, error: 'submission failed' }); }
    })();
  });
}
