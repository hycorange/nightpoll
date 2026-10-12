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
export type RelayerPost = (txHex: string) => Promise<{ ok: true; txId: string } | { ok: false; status: number; error: string }>;

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
  await w.submitTransaction(tx);
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
      reason = `relayer refused (${r.status}): ${r.error}`;
    } catch (e) { reason = `relayer unreachable: ${msg(e)}`; }
    log(reason);
  }
  if (!(await d.confirmFallback(reason))) throw new Error(`sponsored submit failed and fallback was declined: ${reason}`);
  await submitWalletPays(d.wallet, unsealedHex);
  return { via: 'wallet', fellBack: true, note: reason };
}

/** Relayer client (same-origin `/relayer` proxy in the dev server). */
export const httpRelayer = (base: string, fetchFn: typeof fetch = fetch): RelayerPost => async (tx) => {
  const res = await fetchFn(`${base}/sponsor/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx }) });
  let body: { ok?: boolean; txId?: string; error?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (res.ok && body.ok && typeof body.txId === 'string') return { ok: true, txId: body.txId };
  return { ok: false, status: res.status, error: body.error ?? res.statusText ?? 'unknown error' };
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
