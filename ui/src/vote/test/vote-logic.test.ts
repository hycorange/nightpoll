import { describe, expect, it, vi } from 'vitest';
import { MidnightBech32m, ShieldedCoinPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { checkNetwork, DEMO_CONTRACT, validateTarget } from '../guard';
import { decodeBech32m, fromHex, keyToHex, toHex } from '../bech32m';
import { exportKey, getOrCreateKey, importKey, kvPrivateStateProvider, type KV } from '../keystore';
import { httpRelayer, submitProven, type WalletLike } from '../submit';
import { connectPreview, pickWallet } from '../connector';

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
const A = 'ab'.repeat(32);

describe('guard', () => {
  it('rejects the submitted demo poll and malformed addresses', () => {
    expect(validateTarget(DEMO_CONTRACT).ok).toBe(false);
    expect(validateTarget('0x' + DEMO_CONTRACT.toUpperCase()).ok).toBe(false);
    expect(validateTarget('1234').ok).toBe(false);
    expect(validateTarget(` 0x${A.toUpperCase()} `)).toEqual({ ok: true, address: A });
  });
  it('requires Preview', () => {
    expect(() => checkNetwork('mainnet')).toThrow(/Preview/);
    expect(() => checkNetwork('preview')).not.toThrow();
  });
});

describe('bech32m / keys', () => {
  it('decodes a Midnight shielded coin key identical to the SDK encoder', () => {
    const hex = '11'.repeat(16) + 'fe'.repeat(16);
    const s = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString(hex)).asString();
    expect(s.startsWith('mn_')).toBe(true);
    expect(keyToHex(s)).toBe(hex);
    expect(MidnightBech32m.parse(s).data.toString('hex')).toBe(hex);
  });
  it('passes hex through and rejects corrupted strings', () => {
    expect(keyToHex(A.toUpperCase())).toBe(A);
    const s = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString(A)).asString();
    const bad = s.slice(0, -1) + (s.endsWith('q') ? 'p' : 'q');
    expect(() => decodeBech32m(bad)).toThrow(/checksum/);
    expect(() => keyToHex('nope')).toThrow();
  });
  it('hex roundtrip', () => { const b = Uint8Array.from([0, 1, 255]); expect(fromHex(toHex(b))).toEqual(b); expect(() => fromHex('zz')).toThrow(); });
});

describe('keystore', () => {
  it('creates one key per poll and keeps it', () => {
    const kv = mem(); const rand = vi.fn((n: number) => new Uint8Array(n).fill(7));
    const k1 = getOrCreateKey(kv, A, rand); const k2 = getOrCreateKey(kv, A, rand);
    expect(k1).toEqual(k2); expect(rand).toHaveBeenCalledTimes(1);
    expect(exportKey(kv, A)).toBe('07'.repeat(32));
    expect(exportKey(kv, 'cd'.repeat(32))).toBeNull();
  });
  it('import refuses to silently overwrite a different key', () => {
    const kv = mem(); importKey(kv, A, '01'.repeat(32));
    expect(() => importKey(kv, A, '02'.repeat(32))).toThrow(/export it first/);
    importKey(kv, A, '02'.repeat(32), true); expect(exportKey(kv, A)).toBe('02'.repeat(32));
    expect(() => importKey(kv, A, 'xyz')).toThrow();
  });
  it('private state provider maps to the same slot', async () => {
    const kv = mem(); const ps = kvPrivateStateProvider(kv);
    await expect(ps.get('x')).rejects.toThrow(/setContractAddress/);
    ps.setContractAddress(A);
    expect(await ps.get('x')).toBeNull();
    await ps.set('x', { secretKey: new Uint8Array(32).fill(9) });
    expect(exportKey(kv, A)).toBe('09'.repeat(32));
    expect((await ps.get('x'))?.secretKey).toEqual(new Uint8Array(32).fill(9));
  });
});

const fakeWallet = (opts: { noFeeFails?: boolean } = {}) => {
  const calls: string[] = [];
  const w: WalletLike = {
    balanceUnsealedTransaction: async (tx, o) => {
      calls.push(`balance:${o?.payFees}`);
      if (o?.payFees === false && opts.noFeeFails) throw new Error('payFees=false unsupported');
      return { tx: `${tx}:sealed:${o?.payFees}` };
    },
    submitTransaction: async (tx) => { calls.push(`submit:${tx}`); },
  };
  return { w, calls };
};

describe('submitProven', () => {
  it('wallet mode: Lace pays and submits', async () => {
    const { w, calls } = fakeWallet(); const relayer = vi.fn();
    expect(await submitProven('wallet', 'T', { wallet: w, relayer, confirmFallback: async () => true })).toEqual({ via: 'wallet', fellBack: false });
    expect(calls).toEqual(['balance:true', 'submit:T:sealed:true']); expect(relayer).not.toHaveBeenCalled();
  });
  it('sponsored: Lace seals without fees, relayer submits, wallet never submits', async () => {
    const { w, calls } = fakeWallet(); const relayer = vi.fn(async () => ({ ok: true as const, txId: 'id1' }));
    expect(await submitProven('sponsored', 'T', { wallet: w, relayer, confirmFallback: async () => true })).toEqual({ via: 'relayer', txId: 'id1', sealedBy: 'lace' });
    expect(relayer).toHaveBeenCalledWith('T:sealed:false'); expect(calls).toEqual(['balance:false']);
  });
  it('sponsored: Lace refuses payFees:false -> local bind -> relayer', async () => {
    const { w } = fakeWallet({ noFeeFails: true }); const relayer = vi.fn(async () => ({ ok: true as const, txId: 'id2' }));
    const r = await submitProven('sponsored', 'T', { wallet: w, relayer, localBind: (h) => `${h}:bound`, confirmFallback: async () => true });
    expect(r).toEqual({ via: 'relayer', txId: 'id2', sealedBy: 'local-bind' }); expect(relayer).toHaveBeenCalledWith('T:bound');
  });
  it('sponsored: relayer refuses -> fallback to wallet after confirm', async () => {
    const { w, calls } = fakeWallet(); const confirm = vi.fn(async (_r: string) => true);
    const r = await submitProven('sponsored', 'T', { wallet: w, relayer: async () => ({ ok: false, status: 403, error: 'contract not allowed' }), confirmFallback: confirm });
    expect(r).toMatchObject({ via: 'wallet', fellBack: true }); expect(confirm.mock.calls[0][0]).toMatch(/403/);
    expect(calls).toEqual(['balance:false', 'balance:true', 'submit:T:sealed:true']);
  });
  it('sponsored: declined fallback submits nothing', async () => {
    const { w, calls } = fakeWallet({ noFeeFails: true });
    await expect(submitProven('sponsored', 'T', { wallet: w, relayer: vi.fn(), confirmFallback: async () => false })).rejects.toThrow(/declined/);
    expect(calls.some((c) => c.startsWith('submit'))).toBe(false);
  });
  it('sponsored: relayer unreachable -> fallback', async () => {
    const { w } = fakeWallet();
    const r = await submitProven('sponsored', 'T', { wallet: w, relayer: async () => { throw new Error('ECONNREFUSED'); }, confirmFallback: async () => true });
    expect(r).toMatchObject({ via: 'wallet', fellBack: true, note: expect.stringMatching(/unreachable/) });
  });
});

describe('httpRelayer', () => {
  const res = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: 'x', json: async () => body }) as unknown as Response;
  it('posts JSON and parses success / errors', async () => {
    const f = vi.fn(async () => res(200, { ok: true, txId: 'abc' }));
    expect(await httpRelayer('/relayer', f as never)('DEAD')).toEqual({ ok: true, txId: 'abc' });
    expect(f).toHaveBeenCalledWith('/relayer/sponsor/vote', expect.objectContaining({ method: 'POST', body: JSON.stringify({ tx: 'DEAD' }) }));
    expect(await httpRelayer('', (async () => res(429, { ok: false, error: 'rate limited' })) as never)('x')).toEqual({ ok: false, status: 429, error: 'rate limited' });
    expect(await httpRelayer('', (async () => ({ ok: false, status: 502, statusText: 'Bad Gateway', json: async () => { throw new Error(); } })) as never)('x')).toEqual({ ok: false, status: 502, error: 'Bad Gateway' });
  });
});

describe('connector', () => {
  const initial = (networkId: string, apiVersion = '4.0.1') => ({ name: 'Lace', apiVersion, icon: '', rdns: '', connect: vi.fn(async () => ({ getConfiguration: async () => ({ networkId, indexerUri: '', indexerWsUri: '', substrateNodeUri: '' }) })) });
  it('prefers mnLace, errors when none', () => {
    const l = initial('preview'), o = initial('preview');
    expect(pickWallet({ other: o, mnLace: l } as never).id).toBe('mnLace');
    expect(pickWallet({ other: o } as never).id).toBe('other');
    expect(() => pickWallet(undefined)).toThrow(/Install Lace/);
    expect(() => pickWallet({ a: o, b: o } as never)).toThrow(/several/);
  });
  it('connects to preview only, and needs API 4.x', async () => {
    const l = initial('preview');
    await expect(connectPreview({ mnLace: l } as never)).resolves.toMatchObject({ id: 'mnLace' });
    expect(l.connect).toHaveBeenCalledWith('preview');
    await expect(connectPreview({ mnLace: initial('mainnet') } as never)).rejects.toThrow(/Preview/);
    await expect(connectPreview({ mnLace: initial('preview', '3.1.0') } as never)).rejects.toThrow(/4\.x/);
  });
});
