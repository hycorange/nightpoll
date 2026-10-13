import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRelayerServer, type RelayerOptions, type Sponsor } from '../relayer/server.js';
import { DailyBudget, summarize } from '../relayer/policy.js';
import { limitsFromEnv } from '../relayer/limits.js';

const A = 'aa'.repeat(32); const B = 'bb'.repeat(32);
const wire = (s: string) => Buffer.from(s).toString('hex');
// tx wire format "<addr>:<entry>:<fee>"
const fake = (calls: string[], dust: { v: bigint }): Sponsor => ({
  network: 'undeployed',
  inspect: (hex) => { const [a, e] = Buffer.from(hex, 'hex').toString().split(':'); return summarize({ intents: new Map([[1, { actions: [{ address: a, entryPoint: e }] }]]) }); },
  estimateFee: (hex) => BigInt(Buffer.from(hex, 'hex').toString().split(':')[2] ?? '0'),
  sponsorAndSubmit: async (hex) => { calls.push(hex); return `tx${calls.length}`; },
  dustBalance: async () => dust.v,
});

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
async function start(opts: Partial<RelayerOptions>, dust = { v: 1000n }) {
  const calls: string[] = [];
  server = createRelayerServer(fake(calls, dust), { allowedContracts: [A, B], perClientPerWindow: 100, minDustBalance: 100n, ...opts });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (s: string) => fetch(`${base}/sponsor/vote`, { method: 'POST', body: JSON.stringify({ tx: wire(s) }) }).then((r) => r.status);
  return { calls, base, post, dust };
}

describe('relayer spend limits', () => {
  it('allowlist: only listed contracts are sponsored (case/0x-insensitive)', async () => {
    const { post, calls } = await start({ allowedContracts: ['0x' + A.toUpperCase()] });
    expect(await post(`${A}:vote:1`)).toBe(200);
    expect(await post(`${B}:vote:1`)).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it('per-contract daily count cap, independent per contract, resets next UTC day', async () => {
    let t = Date.UTC(2026, 9, 13, 10);
    const { post } = await start({ dailyMaxTxPerContract: 2, now: () => t });
    expect(await post(`${A}:vote:1`)).toBe(200);
    expect(await post(`${A}:vote:1`)).toBe(200);
    expect(await post(`${A}:vote:1`)).toBe(429);
    expect(await post(`${B}:vote:1`)).toBe(200);
    t += 86_400_000;
    expect(await post(`${A}:vote:1`)).toBe(200);
  });
  it('per-contract daily DUST cap', async () => {
    const { post } = await start({ dailyMaxDustPerContract: 25n });
    expect(await post(`${A}:vote:10`)).toBe(200);
    expect(await post(`${A}:vote:10`)).toBe(200);
    expect(await post(`${A}:vote:10`)).toBe(429);
    expect(await post(`${A}:vote:5`)).toBe(200);
  });
  it('global max fee per tx', async () => {
    const { post, calls } = await start({ maxFeePerTx: 50n });
    expect(await post(`${A}:vote:51`)).toBe(403);
    expect(await post(`${A}:vote:50`)).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it('per-client-IP rate limit', async () => {
    const { post } = await start({ perClientPerWindow: 1 });
    expect(await post(`${A}:vote:1`)).toBe(200);
    expect(await post(`${A}:vote:1`)).toBe(429);
  });
  it('low DUST: /health degraded below warn, sponsorship refused below floor', async () => {
    const { post, base, dust, calls } = await start({ minDustBalance: 100n, warnDustBalance: 500n }, { v: 1000n });
    const health = async () => ((await (await fetch(`${base}/health`)).json()) as { status: string }).status;
    expect(await health()).toBe('ok');
    dust.v = 300n;
    expect(await health()).toBe('degraded');
    expect(await post(`${A}:vote:1`)).toBe(200);
    dust.v = 99n;
    expect(await post(`${A}:vote:1`)).toBe(503);
    expect(calls).toHaveLength(1);
  });
  it('safe defaults refuse sponsorship when DUST is tiny', async () => {
    const calls: string[] = [];
    server = createRelayerServer(fake(calls, { v: 5n }), { allowedContracts: [A] });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/sponsor/vote`, { method: 'POST', body: JSON.stringify({ tx: wire(`${A}:vote:1`) }) })).status).toBe(503);
    expect(((await (await fetch(`${base}/health`)).json()) as { status: string }).status).toBe('degraded');
  });
  it('DailyBudget unit', () => {
    const b = new DailyBudget(1, 10n, () => 0);
    expect(b.check(A, 5n).ok).toBe(true); b.record(A, 5n);
    expect(b.check('0x' + A, 1n).ok).toBe(false);
    expect(b.check(B, 11n).ok).toBe(false);
  });
  it('limitsFromEnv parses, omits unset, rejects garbage', () => {
    expect(limitsFromEnv({})).toEqual({});
    expect(limitsFromEnv({ NP_RELAYER_MAX_FEE: '7', NP_RELAYER_DAILY_TX: '3', NP_RELAYER_PER_CLIENT: '2', NP_RELAYER_MIN_DUST: '0' }))
      .toEqual({ maxFeePerTx: 7n, dailyMaxTxPerContract: 3, perClientPerWindow: 2, minDustBalance: 0n });
    expect(() => limitsFromEnv({ NP_RELAYER_MAX_FEE: '-1' })).toThrow();
    expect(() => limitsFromEnv({ NP_RELAYER_DAILY_TX: '0' })).toThrow();
  });
});
