import { describe, expect, it, vi } from 'vitest';
import * as NP from '../../../../contract/src/managed/nightpoll/contract/index.js';
import { canVote, voterStatus } from '../voted';
import { connectPreview, waitForWallet, withTimeout } from '../connector';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const setOf = (...xs: Uint8Array[]) => { const s = new Set(xs.map(hex)); return { member: (x: Uint8Array) => s.has(hex(x)) }; };
const pollId = new Uint8Array(32).fill(7), sk = new Uint8Array(32).fill(9), other = new Uint8Array(32).fill(1);

describe('already-voted (local nullifier check)', () => {
  const nul = NP.pureCircuits.voteNullifier(pollId, sk);
  const com = NP.pureCircuits.memberCommitment(pollId, sk);
  it('nullifier and commitment are domain-separated and key/poll specific', () => {
    expect(hex(nul)).not.toBe(hex(com));
    expect(hex(NP.pureCircuits.voteNullifier(pollId, other))).not.toBe(hex(nul));
    expect(hex(NP.pureCircuits.voteNullifier(other, sk))).not.toBe(hex(nul));
  });
  it('detects voted / registered from the public sets', () => {
    expect(voterStatus({ pollId, nullifiers: setOf(), commitments: setOf(com) }, sk, NP.pureCircuits)).toEqual({ registered: true, voted: false });
    expect(voterStatus({ pollId, nullifiers: setOf(nul), commitments: setOf(com) }, sk, NP.pureCircuits)).toEqual({ registered: true, voted: true });
    expect(voterStatus({ pollId, nullifiers: setOf(nul), commitments: setOf(com) }, other, NP.pureCircuits)).toEqual({ registered: false, voted: false });
    expect(voterStatus({ pollId, nullifiers: setOf(nul), commitments: setOf(com) }, null, NP.pureCircuits)).toEqual({ registered: false, voted: false });
  });
  it('never passes the secret to anything but the local hashers', () => {
    const seen: Uint8Array[] = [];
    const spy = { member: (x: Uint8Array) => { seen.push(x); return false; } };
    voterStatus({ pollId, nullifiers: spy, commitments: spy }, sk, NP.pureCircuits);
    expect(seen.map(hex)).not.toContain(hex(sk));
  });
  it('vote button disabled once voted, while busy, or outside VOTING', () => {
    expect(canVote('VOTING', { registered: true, voted: false }, false)).toBe(true);
    expect(canVote('VOTING', { registered: true, voted: true }, false)).toBe(false);
    expect(canVote('VOTING', null, true)).toBe(false);
    expect(canVote('CLOSED', null, false)).toBe(false);
  });
});

describe('connect: late Lace injection', () => {
  const lace = () => ({ name: 'lace', apiVersion: '4.0.1', icon: '', rdns: 'io.lace.wallet', connect: vi.fn(async () => ({ getConfiguration: async () => ({ networkId: 'preview' }) })) });
  const fakeSleep = () => vi.fn(async () => {});
  it('waits for window.midnight injected after page load', async () => {
    let w: Record<string, unknown> | undefined; let n = 0;
    const sleep = vi.fn(async () => { if (++n === 5) w = { 'uuid-1': lace() }; });
    const logs: string[] = [];
    const e = await waitForWallet(() => w as never, { sleep, log: (m) => logs.push(m) });
    expect(e.id).toBe('uuid-1');
    expect(logs[0]).toMatch(/waiting for Lace/);
    expect(logs.at(-1)).toMatch(/injected after ~500 ms/);
  });
  it('gives up with a clear error after the timeout', async () => {
    const sleep = fakeSleep();
    await expect(waitForWallet(() => undefined, { sleep, timeoutMs: 3000, intervalMs: 100 })).rejects.toThrow(/after 3000 ms.*undefined/);
    expect(sleep).toHaveBeenCalledTimes(30);
  });
  it('connectPreview reads the injected object lazily (first click works)', async () => {
    let w: Record<string, unknown> | undefined;
    const sleep = vi.fn(async () => { w = { k: lace() }; });
    await expect(connectPreview(() => w as never, () => {}, { sleep })).resolves.toMatchObject({ id: 'k', config: { networkId: 'preview' } });
  });
  it('a hanging connect() surfaces an error instead of silently doing nothing', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'Lace connect()')).rejects.toThrow(/Lace connect\(\) did not answer/);
    const hang = { ...lace(), connect: () => new Promise(() => {}) };
    await expect(connectPreview({ k: hang } as never, () => {}, { connectTimeoutMs: 20 })).rejects.toThrow(/did not answer/);
    await expect(withTimeout(Promise.resolve(1), 20, 'x')).resolves.toBe(1);
  });
});
