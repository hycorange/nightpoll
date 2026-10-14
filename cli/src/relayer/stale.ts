// SPDX-License-Identifier: Apache-2.0
// "Stale proof" detection. A NightPoll vote proves a Merkle path / contract state as of proving time. If other
// votes land between proving and submission, the node rejects the tx with
//   1010: Invalid Transaction: Custom error: 104
// (seen live on Preview in the M5 rerun, see docs/WAVE3-RESULTS.md). Nothing is spent; the fix is to rebuild +
// re-prove against the current state and resend. The relayer reports this as a distinct, retryable error.
export const STALE_PROOF_CODE = 'STALE_PROOF' as const;
export const STALE_PROOF_MESSAGE = 'proof is stale (node error 104): re-prove against the current contract state and resend';

const STALE_RE = /custom\s+error:?\s*104\b/i;

/** True when an error (or anything with a message / string form) is the node's "Custom error: 104". */
export function isStaleProofError(e: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): boolean => {
    if (x == null || depth > 4 || seen.has(x)) return false;
    seen.add(x);
    if (typeof x === 'string') return STALE_RE.test(x);
    if (x instanceof Error) return STALE_RE.test(x.message) || STALE_RE.test(String(x)) || walk((x as { cause?: unknown }).cause, depth + 1);
    if (typeof x === 'object') {
      const o = x as { message?: unknown; cause?: unknown };
      if (walk(o.message, depth + 1) || walk(o.cause, depth + 1)) return true;
      try { return STALE_RE.test(JSON.stringify(x)); } catch { return false; }
    }
    return STALE_RE.test(String(x));
  };
  return walk(e, 0);
}
