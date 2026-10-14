import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { SubmissionMixer, shuffle, batchFromEnv } from '../relayer/batch.js';
import { limitsFromEnv } from '../relayer/limits.js';
import { createRelayerServer, type Sponsor } from '../relayer/server.js';
import { summarize } from '../relayer/policy.js';

const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('relayer mixing window (batching)', () => {
  it('shuffle is a permutation and is deterministic for a given rand', () => {
    const out = shuffle([1, 2, 3, 4, 5], seq([0.1, 0.9, 0.5, 0.3]));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle([1, 2, 3, 4, 5], seq([0.1, 0.9, 0.5, 0.3]))).toEqual(out);
    expect(shuffle([], Math.random)).toEqual([]);
  });
  it('window off: runs immediately, in arrival order, one at a time', async () => {
    const m = new SubmissionMixer<number>(0);
    const order: number[] = []; let running = 0; let maxRunning = 0;
    const job = (n: number) => async () => { running++; maxRunning = Math.max(maxRunning, running); await tick(); order.push(n); running--; return n; };
    expect(await Promise.all([m.submit(job(1)), m.submit(job(2)), m.submit(job(3))])).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxRunning).toBe(1);
  });
  it('window on: holds jobs until the timer fires, then runs them shuffled; each caller gets its own result', async () => {
    let fire: (() => void) | undefined;
    const m = new SubmissionMixer<number>(1000, 8, () => 0, ((f: () => void) => { fire = f; return 1 as never; }) as never, () => {});
    const order: number[] = [];
    const ps = [1, 2, 3, 4].map((n) => m.submit(async () => { order.push(n); return n * 10; }));
    await tick();
    expect(order).toEqual([]);
    expect(m.waiting).toBe(4);
    fire!();
    expect(await Promise.all(ps)).toEqual([10, 20, 30, 40]);
    expect(order).not.toEqual([1, 2, 3, 4]); // rand()=0 always swaps with index 0 -> [2,3,4,1]
    expect([...order].sort()).toEqual([1, 2, 3, 4]);
  });
  it('flushes early at batchMax and isolates failures', async () => {
    const m = new SubmissionMixer<string>(60_000, 2);
    const a = m.submit(async () => { throw new Error('node rejected'); });
    const b = m.submit(async () => 'ok');
    await expect(a).rejects.toThrow('node rejected');
    await expect(b).resolves.toBe('ok');
    expect(m.waiting).toBe(0);
  });
  it('env parsing', () => {
    expect(batchFromEnv({})).toEqual({});
    expect(batchFromEnv({ NP_RELAYER_BATCH_MS: '30000', NP_RELAYER_BATCH_MAX: '5' })).toEqual({ batchMs: 30000, batchMax: 5 });
    expect(() => batchFromEnv({ NP_RELAYER_BATCH_MAX: '0' })).toThrow();
    expect(() => batchFromEnv({ NP_RELAYER_BATCH_MS: '-1' })).toThrow();
    expect(limitsFromEnv({ NP_RELAYER_BATCH_MS: '1000' })).toMatchObject({ batchMs: 1000 });
  });
  it('HTTP: with a window, concurrent votes are all sponsored and answered after the flush', async () => {
    const POLL = 'ab'.repeat(32); const submitted: string[] = [];
    const sponsor: Sponsor = {
      network: 'undeployed',
      inspect: (hex) => { const [addr, ep] = Buffer.from(hex, 'hex').toString('utf8').split(':'); return summarize({ intents: new Map([[1, { actions: [{ address: addr, entryPoint: ep }] }]]) }); },
      sponsorAndSubmit: async (hex) => { submitted.push(hex); return `tx-${Buffer.from(hex, 'hex').toString('utf8').split(':')[2]}`; },
      dustBalance: async () => 10n ** 20n,
    };
    const server = createRelayerServer(sponsor, { allowedContracts: [POLL], allowedEntryPoints: ['vote'], perClientPerWindow: 10, batchMs: 200, batchMax: 10 });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const t0 = Date.now();
      const rs = await Promise.all([0, 1, 2].map((i) => fetch(`${base}/sponsor/vote`, { method: 'POST', body: JSON.stringify({ tx: Buffer.from(`${POLL}:vote:${i}`).toString('hex') }) }).then((r) => r.json())));
      expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
      expect(rs).toEqual([{ ok: true, txId: 'tx-0' }, { ok: true, txId: 'tx-1' }, { ok: true, txId: 'tx-2' }]);
      expect(submitted).toHaveLength(3);
    } finally { await new Promise<void>((r) => server.close(() => r())); }
  });
});
