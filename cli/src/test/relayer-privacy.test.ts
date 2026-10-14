import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRelayerServer, type Sponsor } from '../relayer/server.js';
import { summarize } from '../relayer/policy.js';
import { limitsFromEnv } from '../relayer/limits.js';
import { hashClient, jitterDelay, jitterFromEnv, redactIps } from '../relayer/privacy.js';

const A = 'aa'.repeat(32);
const wire = (s: string) => Buffer.from(s).toString('hex');
let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe('no-IP logging', () => {
  it('redacts IPv4, IPv6 and mapped addresses', () => {
    expect(redactIps('from 203.0.113.7 ok')).toBe('from [ip] ok');
    expect(redactIps('from ::ffff:10.0.0.1')).toBe('from [ip]');
    expect(redactIps('peer 2001:db8::1 and ::1')).not.toMatch(/2001|::1/);
    expect(redactIps('sponsored vote tx 00ab12')).toBe('sponsored vote tx 00ab12');
  });
  it('hashes client keys with a salt', () => {
    const k = hashClient('203.0.113.7');
    expect(k).toMatch(/^[0-9a-f]{16}$/); expect(k).not.toContain('203');
    expect(hashClient('1.2.3.4', Buffer.from('a'))).not.toBe(hashClient('1.2.3.4', Buffer.from('b')));
  });
  it('server logs never contain client IPs, even in error messages', async () => {
    const lines: string[] = [];
    const sponsor: Sponsor = {
      network: 'undeployed',
      inspect: (hex) => { const [a, e] = Buffer.from(hex, 'hex').toString().split(':'); return summarize({ intents: new Map([[1, { actions: [{ address: a, entryPoint: e }] }]]) }); },
      sponsorAndSubmit: async () => { throw new Error('ECONNREFUSED 127.0.0.1:9944 from client 127.0.0.1'); },
      dustBalance: async () => 10n ** 20n,
    };
    server = createRelayerServer(sponsor, { allowedContracts: [A], log: (m) => lines.push(m) });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const st = await fetch(`${base}/sponsor/vote`, { method: 'POST', body: JSON.stringify({ tx: wire(`${A}:vote:0`) }) }).then((r) => r.status);
    expect(st).toBe(502);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/127\.0\.0\.1|::ffff/);
  });
});

describe('submission jitter', () => {
  it('env parsing: default off, validated', () => {
    expect(jitterFromEnv({})).toBe(0);
    expect(jitterFromEnv({ NP_RELAYER_JITTER_MS: '2500' })).toBe(2500);
    expect(() => jitterFromEnv({ NP_RELAYER_JITTER_MS: '-1' })).toThrow();
    expect(limitsFromEnv({ NP_RELAYER_JITTER_MS: '500' }).jitterMs).toBe(500);
    expect('jitterMs' in limitsFromEnv({})).toBe(false);
  });
  it('delay is within [0, max] and skipped when off', async () => {
    const slept: number[] = []; const sleep = async (ms: number) => { slept.push(ms); };
    expect(await jitterDelay(0, () => 0.9, sleep)).toBe(0); expect(slept).toEqual([]);
    expect(await jitterDelay(1000, () => 0.9999, sleep)).toBe(1000);
    expect(await jitterDelay(1000, () => 0, sleep)).toBe(0);
    expect(slept).toEqual([1000, 0]);
  });
  it('server applies the jitter before submitting', async () => {
    const slept: number[] = []; const order: string[] = [];
    const sponsor: Sponsor = {
      network: 'undeployed',
      inspect: (hex) => { const [a, e] = Buffer.from(hex, 'hex').toString().split(':'); return summarize({ intents: new Map([[1, { actions: [{ address: a, entryPoint: e }] }]]) }); },
      sponsorAndSubmit: async () => { order.push('submit'); return 'tx1'; },
      dustBalance: async () => 10n ** 20n,
    };
    server = createRelayerServer(sponsor, { allowedContracts: [A], jitterMs: 300, sleep: async (ms) => { slept.push(ms); order.push('sleep'); } });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const st = await fetch(`${base}/sponsor/vote`, { method: 'POST', body: JSON.stringify({ tx: wire(`${A}:vote:0`) }) }).then((r) => r.status);
    expect(st).toBe(200); expect(order).toEqual(['sleep', 'submit']);
    expect(slept[0]).toBeGreaterThanOrEqual(0); expect(slept[0]).toBeLessThanOrEqual(300);
  });
});
