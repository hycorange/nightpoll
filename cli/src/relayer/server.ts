// SPDX-License-Identifier: Apache-2.0
// Transport for the NightPoll vote relayer. All chain work is behind the `Sponsor` interface so the HTTP
// layer and policy are testable without a wallet or network.
//
//   GET  /health        -> { status, network, dust }
//   POST /sponsor/vote  -> { tx: "<hex of FinalizedTransaction>" }  =>  { ok: true, txId } | { ok: false, error }
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { checkPolicy, RateLimiter, type PolicyConfig, type TxSummary } from './policy.js';

export interface Sponsor {
  network: string;
  /** Deserialize the user's bound tx (throws on malformed input) and return its policy summary. */
  inspect(txHex: string): TxSummary;
  /** Attach the sponsor's DUST fee, finalize, submit; returns the tx id. */
  sponsorAndSubmit(txHex: string): Promise<string>;
  dustBalance(): Promise<bigint>;
}

export type RelayerOptions = PolicyConfig & {
  perClientPerWindow?: number; // default 3
  globalPerWindow?: number;    // default 60
  windowMs?: number;           // default 10 min
  maxBodyBytes?: number;       // default 1 MB
  clientKey?: (req: IncomingMessage) => string;
  log?: (msg: string) => void;
  now?: () => number;
};

export function createRelayerServer(sponsor: Sponsor, opts: RelayerOptions): Server {
  const limiter = new RateLimiter(opts.perClientPerWindow ?? 3, opts.globalPerWindow ?? 60, opts.windowMs ?? 600_000, opts.now);
  const maxBody = opts.maxBodyBytes ?? 1_000_000;
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
      if (req.method === 'GET' && req.url === '/health') { send(res, 200, { status: 'ok', network: sponsor.network, dust: await sponsor.dustBalance() }); return; }
      if (req.method !== 'POST' || req.url !== '/sponsor/vote') { send(res, 404, { ok: false, error: 'not found' }); return; }
      let txHex: unknown;
      try { ({ tx: txHex } = JSON.parse(await readBody(req)) as { tx?: unknown }); }
      catch (e) { send(res, (e as { status?: number }).status ?? 400, { ok: false, error: 'invalid request body' }); return; }
      if (typeof txHex !== 'string' || !/^([0-9a-f]{2})+$/i.test(txHex)) { send(res, 400, { ok: false, error: 'tx must be a hex string' }); return; }
      let summary: TxSummary;
      try { summary = sponsor.inspect(txHex); } catch { send(res, 400, { ok: false, error: 'not a bound NightPoll transaction' }); return; }
      const decision = checkPolicy(summary, txHex.length / 2, opts);
      if (!decision.ok) { log(`rejected: ${decision.reason}`); send(res, 403, { ok: false, error: decision.reason }); return; }
      if (!limiter.take(keyOf(req))) { send(res, 429, { ok: false, error: 'rate limit exceeded' }); return; }
      const job = queue.then(() => sponsor.sponsorAndSubmit(txHex as string));
      queue = job.catch(() => undefined);
      try { const txId = await job; log(`sponsored vote tx ${txId}`); send(res, 200, { ok: true, txId }); }
      catch (e) { log(`submit failed: ${String(e)}`); send(res, 502, { ok: false, error: 'submission failed' }); }
    })();
  });
}
