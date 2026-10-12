// SPDX-License-Identifier: Apache-2.0
// Relayer acceptance policy for sponsored NightPoll votes.
// Pure functions over a minimal structural view of a ledger Transaction, so they are unit-testable without
// building real proven transactions. `summarize` works on a real `Transaction<SignatureEnabled, Proof, Binding>`
// from @midnight-ntwrk/ledger-v8 (fields: intents, guaranteedOffer, fallibleOffer, rewards).

/** The parts of a ledger transaction the policy looks at. */
export type TxLike = {
  readonly rewards?: unknown;
  readonly guaranteedOffer?: unknown;
  readonly fallibleOffer?: Map<number, unknown> | undefined;
  readonly intents?: Map<number, IntentLike> | undefined;
};
export type IntentLike = {
  readonly guaranteedUnshieldedOffer?: unknown;
  readonly fallibleUnshieldedOffer?: unknown;
  readonly dustActions?: unknown;
  readonly actions: ReadonlyArray<ActionLike>;
};
/** ContractCall has `address` + `entryPoint`; ContractDeploy / MaintenanceUpdate do not have `entryPoint`. */
export type ActionLike = { readonly address?: string; readonly entryPoint?: string | Uint8Array };

export type TxSummary = {
  isRewardsClaim: boolean;
  hasZswapOffers: boolean;
  intentCount: number;
  calls: { address: string; entryPoint: string }[];
  otherActions: number;
  hasUnshieldedOffers: boolean;
  hasDustActions: boolean;
};

const ep = (e: string | Uint8Array): string => (typeof e === 'string' ? e : new TextDecoder().decode(e));
const normAddr = (a: string): string => a.toLowerCase().replace(/^0x/, '');

export function summarize(tx: TxLike): TxSummary {
  const intents = [...(tx.intents?.values() ?? [])];
  const calls: TxSummary['calls'] = [];
  let otherActions = 0;
  for (const it of intents) {
    for (const a of it.actions) {
      if (a.entryPoint !== undefined && a.address !== undefined) calls.push({ address: normAddr(String(a.address)), entryPoint: ep(a.entryPoint) });
      else otherActions++;
    }
  }
  return {
    isRewardsClaim: tx.rewards !== undefined,
    hasZswapOffers: tx.guaranteedOffer !== undefined || (tx.fallibleOffer?.size ?? 0) > 0,
    intentCount: intents.length,
    calls,
    otherActions,
    hasUnshieldedOffers: intents.some((i) => i.guaranteedUnshieldedOffer !== undefined || i.fallibleUnshieldedOffer !== undefined),
    hasDustActions: intents.some((i) => i.dustActions !== undefined),
  };
}

export type PolicyConfig = {
  /** NightPoll contract addresses the relayer is willing to pay for (hex, no 0x). */
  allowedContracts: string[];
  /** Circuits the relayer pays for. Default: only `vote` (register can be added for full unlinkability). */
  allowedEntryPoints?: string[];
  /** Max serialized size in bytes (proven txs are large; the vote tx is ~10 kB). */
  maxTxBytes?: number;
};
export type PolicyDecision = { ok: true } | { ok: false; reason: string };

export function checkPolicy(s: TxSummary, sizeBytes: number, cfg: PolicyConfig): PolicyDecision {
  const allowedEp = cfg.allowedEntryPoints ?? ['vote'];
  const allowedAddr = cfg.allowedContracts.map(normAddr);
  const max = cfg.maxTxBytes ?? 200_000;
  if (sizeBytes > max) return { ok: false, reason: `tx too large (${sizeBytes} > ${max} bytes)` };
  if (s.isRewardsClaim) return { ok: false, reason: 'rewards claims are not sponsored' };
  if (s.intentCount !== 1) return { ok: false, reason: `expected exactly 1 intent, got ${s.intentCount}` };
  if (s.otherActions > 0) return { ok: false, reason: 'deploys / maintenance updates are not sponsored' };
  if (s.calls.length !== 1) return { ok: false, reason: `expected exactly 1 contract call, got ${s.calls.length}` };
  const [c] = s.calls;
  if (!allowedAddr.includes(c.address)) return { ok: false, reason: `contract ${c.address} is not sponsored` };
  if (!allowedEp.includes(c.entryPoint)) return { ok: false, reason: `circuit ${c.entryPoint} is not sponsored` };
  // A NightPoll vote moves no value: anything else means the sponsor would be balancing someone's transfer.
  if (s.hasZswapOffers || s.hasUnshieldedOffers) return { ok: false, reason: 'transactions that move tokens are not sponsored' };
  // The sponsor adds the DUST fee itself; a tx that already carries DUST actions is not what the user side produces.
  if (s.hasDustActions) return { ok: false, reason: 'tx already contains DUST actions' };
  return { ok: true };
}

/** Fixed-window rate limiter per key (e.g. client IP), plus a global per-window budget. */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  private global = { start: 0, n: 0 };
  constructor(private readonly perKey: number, private readonly globalMax: number, private readonly windowMs: number,
              private readonly now: () => number = Date.now) {}
  take(key: string): boolean {
    const t = this.now();
    if (t - this.global.start >= this.windowMs) this.global = { start: t, n: 0 };
    const h = this.hits.get(key);
    const cur = !h || t - h.start >= this.windowMs ? { start: t, n: 0 } : h;
    if (cur.n >= this.perKey || this.global.n >= this.globalMax) { this.hits.set(key, cur); return false; }
    cur.n++; this.global.n++; this.hits.set(key, cur);
    return true;
  }
}
