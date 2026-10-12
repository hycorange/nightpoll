import { describe, it, expect } from 'vitest';
import { checkPolicy, RateLimiter, summarize, type TxLike } from '../relayer/policy.js';

const POLL = '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a';
const voteTx = (over: Partial<{ address: string; entryPoint: string | Uint8Array }> = {}, intent: Record<string, unknown> = {}, tx: Record<string, unknown> = {}): TxLike => ({
  intents: new Map([[1, { actions: [{ address: over.address ?? POLL, entryPoint: over.entryPoint ?? 'vote' }], ...intent }]]),
  ...tx,
});
const cfg = { allowedContracts: [POLL] };
const decide = (t: TxLike, size = 10_000, c = cfg) => checkPolicy(summarize(t), size, c);

describe('relayer policy', () => {
  it('accepts a single vote() call to the allowed poll', () => {
    expect(decide(voteTx())).toEqual({ ok: true });
  });
  it('accepts entry points given as bytes and addresses with 0x / upper case', () => {
    expect(decide(voteTx({ address: '0x' + POLL.toUpperCase(), entryPoint: new TextEncoder().encode('vote') }))).toEqual({ ok: true });
  });
  it('rejects other contracts', () => {
    expect(decide(voteTx({ address: 'ff'.repeat(32) }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not sponsored/) });
  });
  it('rejects other circuits unless allowed (register is opt-in)', () => {
    expect(decide(voteTx({ entryPoint: 'register' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/circuit register/) });
    expect(decide(voteTx({ entryPoint: 'closePoll' }))).toMatchObject({ ok: false });
    expect(decide(voteTx({ entryPoint: 'register' }), 10_000, { ...cfg, allowedEntryPoints: ['vote', 'register'] } as never)).toEqual({ ok: true });
  });
  it('rejects transactions that move tokens', () => {
    expect(decide(voteTx({}, { guaranteedUnshieldedOffer: {} }))).toMatchObject({ ok: false, reason: expect.stringMatching(/move tokens/) });
    expect(decide(voteTx({}, {}, { guaranteedOffer: {} }))).toMatchObject({ ok: false, reason: expect.stringMatching(/move tokens/) });
    expect(decide(voteTx({}, {}, { fallibleOffer: new Map([[1, {}]]) }))).toMatchObject({ ok: false });
  });
  it('rejects txs that already carry DUST actions, deploys, multiple calls or intents, rewards claims, oversize', () => {
    expect(decide(voteTx({}, { dustActions: {} }))).toMatchObject({ ok: false, reason: expect.stringMatching(/DUST/) });
    expect(decide({ intents: new Map([[1, { actions: [{}] }]]) })).toMatchObject({ ok: false, reason: expect.stringMatching(/deploys/) });
    expect(decide({ intents: new Map([[1, { actions: [{ address: POLL, entryPoint: 'vote' }, { address: POLL, entryPoint: 'vote' }] }]]) })).toMatchObject({ ok: false, reason: expect.stringMatching(/exactly 1 contract call/) });
    const two = voteTx(); (two.intents as Map<number, unknown>).set(2, { actions: [] });
    expect(decide(two)).toMatchObject({ ok: false, reason: expect.stringMatching(/exactly 1 intent/) });
    expect(decide({ intents: undefined })).toMatchObject({ ok: false });
    expect(decide(voteTx({}, {}, { rewards: {} }))).toMatchObject({ ok: false, reason: expect.stringMatching(/rewards/) });
    expect(decide(voteTx(), 300_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/too large/) });
  });
});

describe('relayer rate limiter', () => {
  it('limits per client and globally within a window, and resets after it', () => {
    let t = 0;
    const rl = new RateLimiter(2, 3, 1000, () => t);
    expect([rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, false]);
    expect(rl.take('b')).toBe(true);
    expect(rl.take('c')).toBe(false); // global budget (3) used up
    t = 1000;
    expect(rl.take('a')).toBe(true);
  });
});
