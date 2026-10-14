// SPDX-License-Identifier: Apache-2.0
// Mixing window for sponsored submissions ("batching").
//
// Why not one merged ledger tx? ledger-v8 `Transaction.merge` throws "if both transactions have contract
// interactions", so two members' vote() calls can never share one transaction. What the relayer CAN do is hold
// accepted votes for a short window, then submit them in a random order (each still a separate tx, one at a time
// so the sponsor never double-spends DUST). An observer then can't map "HTTP request k" to "on-chain tx k" by order.
//   NP_RELAYER_BATCH_MS  window length in ms (0 = off, submit as they come)   NP_RELAYER_BATCH_MAX  flush early at N (default 8)

export type Rand = () => number;

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(xs: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

type Pending<T> = { run: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

/**
 * Collects jobs for `windowMs` (or until `max` are waiting), then runs them one by one in shuffled order.
 * windowMs <= 0 disables the window: every job runs immediately (still serialized).
 */
export class SubmissionMixer<T> {
  private pending: Pending<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly windowMs: number, private readonly max = 8, private readonly rand: Rand = Math.random,
              private readonly setTimer: (f: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
              private readonly clearTimer: (t: ReturnType<typeof setTimeout>) => void = clearTimeout) {
    if (max < 1) throw new Error('batch max must be >= 1');
  }
  get waiting(): number { return this.pending.length; }
  submit(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ run, resolve, reject });
      if (this.windowMs <= 0 || this.pending.length >= this.max) this.flush();
      else if (!this.timer) this.timer = this.setTimer(() => this.flush(), this.windowMs);
    });
  }
  /** Run everything waiting now, in random order, after whatever is already running. */
  flush(): void {
    if (this.timer) { this.clearTimer(this.timer); this.timer = undefined; }
    const batch = shuffle(this.pending, this.rand);
    this.pending = [];
    for (const p of batch) {
      this.chain = this.chain.then(() => p.run()).then(p.resolve, p.reject);
    }
  }
}

export function batchFromEnv(env: Record<string, string | undefined>): { batchMs?: number; batchMax?: number } {
  const num = (v: string | undefined, name: string, min: number) => {
    if (v === undefined || v === '') return undefined;
    if (!/^\d+$/.test(v) || Number(v) < min) throw new Error(`${name} must be an integer >= ${min}`);
    return Number(v);
  };
  const o = { batchMs: num(env.NP_RELAYER_BATCH_MS, 'NP_RELAYER_BATCH_MS', 0), batchMax: num(env.NP_RELAYER_BATCH_MAX, 'NP_RELAYER_BATCH_MAX', 1) };
  if (o.batchMs === undefined) delete o.batchMs;
  if (o.batchMax === undefined) delete o.batchMax;
  return o;
}
