import { describe, it, expect } from 'vitest';
import { SubmissionMixer } from '../relayer/batch.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
// Controllable fake timer: records arm/clear calls, fires on demand.
function fakeTimer() {
  const st = { armed: 0, cleared: 0, fns: [] as (() => void)[] };
  const set = ((f: () => void) => { st.armed++; st.fns.push(f); return st.armed as never; }) as never;
  const clear = (() => { st.cleared++; }) as never;
  return { st, set, clear, fire: () => st.fns.shift()!() };
}

describe('mixing window edge cases', () => {
  it('rejects batchMax < 1', () => {
    expect(() => new SubmissionMixer(1000, 0)).toThrow(/>= 1/);
  });
  it('flush on an empty queue is a no-op', async () => {
    const m = new SubmissionMixer<number>(1000);
    expect(() => m.flush()).not.toThrow();
    expect(m.waiting).toBe(0);
  });
  it('arms only one timer per window, even with many submissions', () => {
    const t = fakeTimer();
    const m = new SubmissionMixer<number>(1000, 99, Math.random, t.set, t.clear);
    for (let i = 0; i < 5; i++) void m.submit(async () => i);
    expect(t.st.armed).toBe(1);
    expect(m.waiting).toBe(5);
  });
  it('early flush at batchMax clears the pending timer; the next job opens a fresh window', async () => {
    const t = fakeTimer();
    const m = new SubmissionMixer<number>(1000, 2, Math.random, t.set, t.clear);
    const a = m.submit(async () => 1); const b = m.submit(async () => 2);
    expect(t.st.cleared).toBe(1);
    expect(await Promise.all([a, b]).then((v) => v.sort())).toEqual([1, 2]);
    const c = m.submit(async () => 3);
    expect(t.st.armed).toBe(2);
    expect(m.waiting).toBe(1);
    t.st.fns.length = 0; m.flush();
    expect(await c).toBe(3);
  });
  it('batchMax = 1 behaves like window off (no timer, arrival order)', async () => {
    const t = fakeTimer();
    const m = new SubmissionMixer<number>(1000, 1, Math.random, t.set, t.clear);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => m.submit(async () => { order.push(n); return n; })));
    expect(order).toEqual([1, 2, 3]);
    expect(t.st.armed).toBe(0);
  });
  it('jobs arriving while a batch is running wait for it (never concurrent) and form the next batch', async () => {
    const t = fakeTimer();
    const m = new SubmissionMixer<string>(1000, 99, () => 0.99, t.set, t.clear);
    let running = 0; let maxRunning = 0; const log: string[] = [];
    const job = (s: string) => async () => { running++; maxRunning = Math.max(maxRunning, running); await tick(); log.push(s); running--; return s; };
    const first = [m.submit(job('a1')), m.submit(job('a2'))];
    t.fire();
    const second = m.submit(job('b1'));   // arrives mid-batch
    expect(m.waiting).toBe(1);
    t.fire();
    await Promise.all([...first, second]);
    expect(maxRunning).toBe(1);
    expect(log.indexOf('b1')).toBe(2);
  });
  it('a failing job does not break the chain for later batches', async () => {
    const m = new SubmissionMixer<string>(0);
    await expect(m.submit(async () => { throw new Error('104'); })).rejects.toThrow('104');
    await expect(m.submit(async () => 'after')).resolves.toBe('after');
  });
});
