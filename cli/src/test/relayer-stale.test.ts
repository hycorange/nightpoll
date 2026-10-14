import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRelayerServer, type Sponsor } from '../relayer/server.js';
import { summarize, DailyBudget, RateLimiter } from '../relayer/policy.js';
import { isStaleProofError, STALE_PROOF_CODE } from '../relayer/stale.js';

const POLL = '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a';
const wire = (s: string) => Buffer.from(s).toString('hex');
// The exact text the Preview node returned in the M5 rerun.
const NODE_104 = '1010: Invalid Transaction: Custom error: 104';

describe('isStaleProofError', () => {
  it('matches the node 104 rejection in its usual shapes', () => {
    expect(isStaleProofError(new Error(NODE_104))).toBe(true);
    expect(isStaleProofError(NODE_104)).toBe(true);
    expect(isStaleProofError(new Error('submit failed', { cause: new Error(NODE_104) }))).toBe(true);
    expect(isStaleProofError({ code: 1010, message: 'Invalid Transaction', data: 'Custom error: 104' })).toBe(true);
    expect(isStaleProofError({ message: 'RPC error', cause: { message: 'custom error 104' } })).toBe(true);
  });
  it('does not match other node errors', () => {
    expect(isStaleProofError(new Error('1010: Invalid Transaction: Custom error: 196'))).toBe(false);
    expect(isStaleProofError(new Error('Custom error: 1040'))).toBe(false);
    expect(isStaleProofError(new Error('InvalidDustSpendProof'))).toBe(false);
    expect(isStaleProofError(undefined)).toBe(false);
    expect(isStaleProofError(104)).toBe(false);
  });
});

describe('budget / limiter give-back', () => {
  it('DailyBudget.release undoes one reservation and never goes negative', () => {
    const b = new DailyBudget(1, 10n, () => 0);
    b.record(POLL, 4n);
    expect(b.check(POLL, 1n).ok).toBe(false);
    b.release(POLL, 4n);
    expect(b.usage(POLL)).toEqual({ count: 0, dust: 0n });
    b.release(POLL, 4n);
    expect(b.usage(POLL)).toEqual({ count: 0, dust: 0n });
  });
  it('RateLimiter.refund gives back one slot', () => {
    const l = new RateLimiter(1, 10, 1000, () => 0);
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(false);
    l.refund('a');
    expect(l.take('a')).toBe(true);
  });
});

describe('relayer: stale proof (104) -> 409 retryable', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  const start = async (sponsorAndSubmit: Sponsor['sponsorAndSubmit'], logs: string[]) => {
    const sponsor: Sponsor = {
      network: 'undeployed',
      inspect: (hex) => { const [address, entryPoint] = Buffer.from(hex, 'hex').toString('utf8').split(':'); return summarize({ intents: new Map([[1, { actions: [{ address, entryPoint }] }]]) }); },
      sponsorAndSubmit, dustBalance: async () => 10n ** 20n, estimateFee: () => 5n,
    };
    server = createRelayerServer(sponsor, { allowedContracts: [POLL], perClientPerWindow: 1, dailyMaxTxPerContract: 1, log: (m) => logs.push(m) });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    return (tx: string) => fetch(`${base}/sponsor/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx }) });
  };

  it('returns a distinct retryable error and lets the re-proven resend through (slot + budget given back)', async () => {
    let n = 0; const logs: string[] = [];
    const post = await start(async () => { n++; if (n === 1) throw new Error(NODE_104); return 'tx-ok'; }, logs);
    const first = await post(wire(`${POLL}:vote`));
    expect(first.status).toBe(409);
    const body = (await first.json()) as { error: string };
    expect(body).toMatchObject({ ok: false, code: STALE_PROOF_CODE, retryable: true });
    expect(body.error).toMatch(/re-prove/);
    // perClientPerWindow = 1 and dailyMaxTxPerContract = 1: the resend only fits because the stale attempt was refunded.
    const second = await post(wire(`${POLL}:vote`));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, txId: 'tx-ok' });
    expect(logs.some((l) => /stale proof/.test(l))).toBe(true);
  });

  it('other submission failures stay a plain 502 and are not refunded', async () => {
    const post = await start(async () => { throw new Error('1010: Invalid Transaction: Custom error: 196'); }, []);
    const r = await post(wire(`${POLL}:vote`));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body).toEqual({ ok: false, error: 'submission failed' });
    expect((await post(wire(`${POLL}:vote`))).status).toBe(429);
  });
});
