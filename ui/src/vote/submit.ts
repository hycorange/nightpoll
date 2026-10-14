// SPDX-License-Identifier: Apache-2.0
// How a proven NightPoll call reaches the chain. Two modes:
//  (a) "wallet": Lace balances + pays DUST, then submits.
//  (b) "sponsored": Lace seals WITHOUT fees (payFees:false; UNVERIFIED with real Lace), the page POSTs the
//      sealed tx to the relayer, the relayer adds DUST and submits. If any step of (b) fails, the page falls
//      back to (a) after the user confirms (a) costs their own DUST and links register/vote via fee payer.
export type Mode = 'wallet' | 'sponsored';

export interface WalletLike {
  balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
}
export type RelayerPost = (txHex: string) => Promise<{ ok: true; txId: string } | { ok: false; status: number; error: string; code?: string }>;

// Stale proof: the node rejects a tx proven against an older contract state (other votes landed in between) with
// "1010: Invalid Transaction: Custom error: 104". Nothing is spent; rebuild + re-prove and resend. The relayer
// reports it as 409 { code: 'STALE_PROOF', retryable: true } (cli/src/relayer/stale.ts); Lace surfaces the node text.
export const STALE_PROOF_NOTICE = '证明已过期，请重新生成';
const STALE_RE = /custom\s+error:?\s*104\b/i;
export class StaleProofError extends Error {
  readonly stale = true;
  constructor(detail: string) { super(`${STALE_PROOF_NOTICE} (${detail})`); this.name = 'StaleProofError'; }
}
export const isStaleProof = (e: unknown): boolean =>
  e instanceof StaleProofError || STALE_RE.test(msg(e)) || STALE_RE.test(msg((e as { cause?: unknown } | null)?.cause ?? ''));

export type Outcome =
  | { via: 'wallet'; fellBack: boolean; note?: string }
  | { via: 'relayer'; txId: string; sealedBy: 'lace' | 'local-bind' };

export interface SubmitDeps {
  wallet: WalletLike;
  relayer: RelayerPost;
  /** Optional local bind of the proven tx (no wallet); used if Lace refuses payFees:false. */
  localBind?: (unsealedHex: string) => string;
  /** Ask the user before falling back to wallet-pays. Return false to abort. */
  confirmFallback: (reason: string) => Promise<boolean>;
  log?: (m: string) => void;
}

export async function submitWalletPays(w: WalletLike, unsealedHex: string): Promise<void> {
  const { tx } = await w.balanceUnsealedTransaction(unsealedHex, { payFees: true });
  try { await w.submitTransaction(tx); }
  catch (e) { if (isStaleProof(e)) throw new StaleProofError(`node: ${msg(e)}`); throw e; }
}

export async function submitProven(mode: Mode, unsealedHex: string, d: SubmitDeps): Promise<Outcome> {
  const log = d.log ?? (() => {});
  if (mode === 'wallet') { await submitWalletPays(d.wallet, unsealedHex); return { via: 'wallet', fellBack: false }; }

  let sealed: string | undefined; let sealedBy: 'lace' | 'local-bind' = 'lace'; let reason = '';
  try {
    sealed = (await d.wallet.balanceUnsealedTransaction(unsealedHex, { payFees: false })).tx;
  } catch (e) {
    reason = `Lace could not seal without fees: ${msg(e)}`; log(reason);
    if (d.localBind) {
      try { sealed = d.localBind(unsealedHex); sealedBy = 'local-bind'; log('sealed locally with tx.bind()'); }
      catch (e2) { reason += `; local bind failed: ${msg(e2)}`; log(reason); }
    }
  }
  if (sealed) {
    try {
      const r = await d.relayer(sealed);
      if (r.ok) return { via: 'relayer', txId: r.txId, sealedBy };
      // Stale proof: paying from the wallet would hit the same 104, so don't offer the fallback; re-prove instead.
      if (r.code === 'STALE_PROOF' || isStaleProof(r.error)) throw new StaleProofError(`relayer ${r.status}: ${r.error}`);
      reason = `relayer refused (${r.status}): ${r.error}`;
    } catch (e) { if (e instanceof StaleProofError) throw e; reason = `relayer unreachable: ${msg(e)}`; }
    log(reason);
  }
  if (!(await d.confirmFallback(reason))) throw new Error(`sponsored submit failed and fallback was declined: ${reason}`);
  await submitWalletPays(d.wallet, unsealedHex);
  return { via: 'wallet', fellBack: true, note: reason };
}

/**
 * Prove + submit, and if the proof turns out stale (104) tell the user and automatically rebuild + re-prove +
 * resend exactly once. A second stale rejection is thrown so the user can try again later.
 */
export async function submitWithReprove<T>(prove: () => Promise<string>, submit: (hex: string) => Promise<T>,
  hooks: { onStale?: (notice: string, e: StaleProofError) => void; beforeRetry?: () => Promise<void> } = {}): Promise<{ out: T; retried: boolean }> {
  try { return { out: await submit(await prove()), retried: false }; }
  catch (e) {
    if (!(e instanceof StaleProofError)) throw e;
    hooks.onStale?.(STALE_PROOF_NOTICE, e);
    await hooks.beforeRetry?.();
    try { return { out: await submit(await prove()), retried: true }; }
    catch (e2) {
      if (e2 instanceof StaleProofError) throw new StaleProofError('自动重新生成并重试 1 次后仍过期，请稍后再试');
      throw e2;
    }
  }
}

/** Relayer client (same-origin `/relayer` proxy in the dev server). */
export const httpRelayer = (base: string, fetchFn: typeof fetch = fetch): RelayerPost => async (tx) => {
  const res = await fetchFn(`${base}/sponsor/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx }) });
  let body: { ok?: boolean; txId?: string; error?: string; code?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (res.ok && body.ok && typeof body.txId === 'string') return { ok: true, txId: body.txId };
  const err = { ok: false as const, status: res.status, error: body.error ?? res.statusText ?? 'unknown error' };
  return typeof body.code === 'string' ? { ...err, code: body.code } : err;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
