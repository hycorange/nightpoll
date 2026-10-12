import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRelayerServer, type Sponsor } from '../relayer/server.js';
import { summarize } from '../relayer/policy.js';

const POLL = '03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a';
// Fake sponsor: the "tx hex" encodes which entry point/contract it calls; no wallet, no network.
const fake = (calls: string[]): Sponsor => ({
  network: 'undeployed',
  inspect: (hex) => {
    const [addr, ep] = Buffer.from(hex, 'hex').toString('utf8').split(':');
    if (!ep) throw new Error('malformed');
    return summarize({ intents: new Map([[1, { actions: [{ address: addr, entryPoint: ep }] }]]) });
  },
  sponsorAndSubmit: async (hex) => { calls.push(hex); if (hex.endsWith(Buffer.from(':vote!').toString('hex'))) throw new Error('node rejected'); return `tx${calls.length}`; },
  dustBalance: async () => 123n,
});
const wire = (s: string) => Buffer.from(s).toString('hex');

describe('relayer HTTP service', () => {
  let server: Server; let base: string; let calls: string[];
  beforeEach(async () => {
    calls = [];
    server = createRelayerServer(fake(calls), { allowedContracts: [POLL], allowedEntryPoints: ['vote', 'vote!'], perClientPerWindow: 2, maxBodyBytes: 10_000 });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));
  const post = (body: unknown, raw = false) => fetch(`${base}/sponsor/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });

  it('health reports network and DUST', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok', network: 'undeployed', dust: '123' });
  });
  it('sponsors an allowed vote and returns the tx id', async () => {
    const r = await post({ tx: wire(`${POLL}:vote`) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, txId: 'tx1' });
    expect(calls).toHaveLength(1);
  });
  it('rejects malformed bodies and non-hex / undecodable txs without spending', async () => {
    expect((await post('not json', true)).status).toBe(400);
    expect((await post({ tx: 'zz' })).status).toBe(400);
    expect((await post({ tx: wire('garbage') })).status).toBe(400);
    expect((await post({ tx: 'ab'.repeat(6000) })).status).toBe(413);
    expect(calls).toHaveLength(0);
  });
  it('enforces the policy before paying (other contract / other circuit -> 403)', async () => {
    expect((await post({ tx: wire(`${'ff'.repeat(32)}:vote`) })).status).toBe(403);
    expect((await post({ tx: wire(`${POLL}:closePoll`) })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('rate-limits per client (429) and only counts policy-accepted requests', async () => {
    await post({ tx: wire(`${POLL}:closePoll`) }); // rejected by policy, not counted
    expect((await post({ tx: wire(`${POLL}:vote`) })).status).toBe(200);
    expect((await post({ tx: wire(`${POLL}:vote`) })).status).toBe(200);
    expect((await post({ tx: wire(`${POLL}:vote`) })).status).toBe(429);
    expect(calls).toHaveLength(2);
  });
  it('maps a failed submission to 502 and keeps serving', async () => {
    expect((await post({ tx: wire(`${POLL}:vote!`) })).status).toBe(502);
    expect((await post({ tx: wire(`${POLL}:vote`) })).status).toBe(200);
  });
  it('unknown routes are 404', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
