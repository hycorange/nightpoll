import { describe, expect, it, vi } from 'vitest';
import { httpRelayer, isStaleProof, STALE_PROOF_NOTICE, StaleProofError, submitProven, submitWithReprove, type WalletLike } from '../submit';

const NODE_104 = '1010: Invalid Transaction: Custom error: 104';
const wallet = (submitErr?: Error): { w: WalletLike; calls: string[] } => {
  const calls: string[] = [];
  return { calls, w: {
    balanceUnsealedTransaction: async (tx, o) => { calls.push(`balance:${o?.payFees}`); return { tx: `${tx}:sealed` }; },
    submitTransaction: async (tx) => { calls.push(`submit:${tx}`); if (submitErr) throw submitErr; },
  } };
};

describe('stale proof detection', () => {
  it('recognises the node 104 text but not other codes', () => {
    expect(isStaleProof(new Error(NODE_104))).toBe(true);
    expect(isStaleProof(new Error('wrapped', { cause: new Error(NODE_104) }))).toBe(true);
    expect(isStaleProof(new StaleProofError('x'))).toBe(true);
    expect(isStaleProof(new Error('Custom error: 196'))).toBe(false);
    expect(isStaleProof(new Error('Custom error: 1040'))).toBe(false);
  });
  it('StaleProofError message starts with the Chinese notice', () => {
    expect(new StaleProofError('d').message.startsWith(STALE_PROOF_NOTICE)).toBe(true);
    expect(STALE_PROOF_NOTICE).toBe('证明已过期，请重新生成');
  });
});

describe('submitProven with a stale proof', () => {
  it('sponsored: relayer 409 STALE_PROOF -> StaleProofError, no wallet fallback offered', async () => {
    const { w, calls } = wallet(); const confirm = vi.fn(async () => true);
    const relayer = async () => ({ ok: false as const, status: 409, error: 'proof is stale (node error 104)', code: 'STALE_PROOF' });
    await expect(submitProven('sponsored', 'T', { wallet: w, relayer, confirmFallback: confirm })).rejects.toBeInstanceOf(StaleProofError);
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(['balance:false']);
  });
  it('wallet mode: Lace submit rejected with 104 -> StaleProofError', async () => {
    const { w } = wallet(new Error(NODE_104));
    await expect(submitProven('wallet', 'T', { wallet: w, relayer: vi.fn(), confirmFallback: async () => true })).rejects.toBeInstanceOf(StaleProofError);
  });
  it('wallet mode: other Lace errors pass through unchanged', async () => {
    const { w } = wallet(new Error('user rejected'));
    await expect(submitProven('wallet', 'T', { wallet: w, relayer: vi.fn(), confirmFallback: async () => true })).rejects.toThrow(/^user rejected$/);
  });
});

describe('submitWithReprove', () => {
  it('no stale: proves once, no notice', async () => {
    const prove = vi.fn(async () => 'P1'); const onStale = vi.fn();
    expect(await submitWithReprove(prove, async (h) => `ok:${h}`, { onStale })).toEqual({ out: 'ok:P1', retried: false });
    expect(prove).toHaveBeenCalledTimes(1); expect(onStale).not.toHaveBeenCalled();
  });
  it('stale once: shows the notice, re-proves, resends once and succeeds', async () => {
    let n = 0; const prove = vi.fn(async () => `P${++n}`);
    const submit = vi.fn(async (h: string) => { if (h === 'P1') throw new StaleProofError('relayer 409'); return `ok:${h}`; });
    const order: string[] = [];
    const r = await submitWithReprove(prove, submit, { onStale: (m) => order.push(`notice:${m}`), beforeRetry: async () => { order.push('refresh'); } });
    expect(r).toEqual({ out: 'ok:P2', retried: true });
    expect(prove).toHaveBeenCalledTimes(2); expect(submit.mock.calls.map((c) => c[0])).toEqual(['P1', 'P2']);
    expect(order).toEqual([`notice:${STALE_PROOF_NOTICE}`, 'refresh']);
  });
  it('stale twice: retries only once, then throws a StaleProofError carrying the notice', async () => {
    const prove = vi.fn(async () => 'P'); const submit = vi.fn(async () => { throw new StaleProofError('again'); });
    const e = await submitWithReprove(prove, submit).catch((x) => x);
    expect(e).toBeInstanceOf(StaleProofError); expect((e as Error).message.startsWith(STALE_PROOF_NOTICE)).toBe(true);
    expect(prove).toHaveBeenCalledTimes(2); expect(submit).toHaveBeenCalledTimes(2);
  });
  it('non-stale errors are not retried', async () => {
    const prove = vi.fn(async () => 'P');
    await expect(submitWithReprove(prove, async () => { throw new Error('rate limit exceeded'); })).rejects.toThrow(/rate limit/);
    expect(prove).toHaveBeenCalledTimes(1);
  });
  it('beforeRetry can abort the retry (e.g. the vote already landed)', async () => {
    const prove = vi.fn(async () => 'P'); const submit = vi.fn(async () => { throw new StaleProofError('x'); });
    await expect(submitWithReprove(prove, submit, { beforeRetry: async () => { throw new Error('already voted'); } })).rejects.toThrow(/already voted/);
    expect(prove).toHaveBeenCalledTimes(1);
  });
  it('end to end through httpRelayer: 409 then 200', async () => {
    let calls = 0;
    const fetchFn = (async () => { calls++; return calls === 1
      ? ({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({ ok: false, error: 'proof is stale', code: 'STALE_PROOF', retryable: true }) })
      : ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true, txId: 'tx2' }) }); }) as unknown as typeof fetch;
    const { w } = wallet(); const relayer = httpRelayer('', fetchFn);
    let n = 0;
    const r = await submitWithReprove(async () => `P${++n}`, (h) => submitProven('sponsored', h, { wallet: w, relayer, confirmFallback: async () => false }));
    expect(r).toEqual({ out: { via: 'relayer', txId: 'tx2', sealedBy: 'lace' }, retried: true });
  });
});
