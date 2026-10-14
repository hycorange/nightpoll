// SPDX-License-Identifier: Apache-2.0
// No-IP logging policy and submission jitter for the relayer.
//   NP_RELAYER_JITTER_MS: max random delay (ms) before each submission; 0 (default) = off.
//   Delays decorrelate the HTTP request time from the on-chain submission time.
import { createHash, randomBytes } from 'node:crypto';

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// any token with 2+ colons made only of hex digits, colons and dots (covers ::1, ::ffff:a.b.c.d, 2001:db8::1)
const IPV6 = /(?<![\w.:])[0-9a-f.]*:[0-9a-f.]*:[0-9a-f.:]*(?![\w.:])/gi;

/** Strip anything that looks like an IPv4/IPv6 address from a log line. */
export function redactIps(msg: string): string {
  return msg.replace(IPV6, '[ip]').replace(IPV4, '[ip]');
}

/** Wrap a logger so no client IP can ever reach it. */
export const safeLog = (log: (m: string) => void) => (m: string) => log(redactIps(m));

/** Salted, non-reversible client key for in-memory rate limiting (salt is per process, never logged). */
export function hashClient(ip: string, salt: Buffer = PROCESS_SALT): string {
  return createHash('sha256').update(salt).update(ip).digest('hex').slice(0, 16);
}
const PROCESS_SALT = randomBytes(32);

export function jitterFromEnv(env: Record<string, string | undefined>): number {
  const v = env.NP_RELAYER_JITTER_MS;
  if (v === undefined || v === '') return 0;
  if (!/^\d+$/.test(v)) throw new Error('NP_RELAYER_JITTER_MS must be a non-negative integer');
  return Number(v);
}

/** Random delay in [0, maxMs]; 0 resolves immediately. */
export function jitterDelay(maxMs: number, rand: () => number = Math.random,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<number> {
  if (maxMs <= 0) return Promise.resolve(0);
  const ms = Math.floor(rand() * (maxMs + 1));
  return sleep(ms).then(() => ms);
}

/**
 * Client key for rate limiting. Behind a reverse proxy every request comes from the proxy's address, so the
 * per-client limit would collapse into one shared bucket. With NP_RELAYER_TRUST_PROXY=1 the key is taken from the
 * right-most X-Forwarded-For hop (the one your own proxy appended; left-most hops are client-controlled).
 * Only enable this when the relayer is reachable solely through that proxy. The value is hashed like a socket IP
 * and never logged.
 */
export function clientKeyFor(trustProxy: boolean, salt: Buffer = PROCESS_SALT) {
  return (req: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): string => {
    let ip = req.socket.remoteAddress ?? 'unknown';
    if (trustProxy) {
      const h = req.headers['x-forwarded-for'];
      const hops = (Array.isArray(h) ? h.join(',') : h ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (hops.length > 0) ip = hops[hops.length - 1];
    }
    return hashClient(ip, salt);
  };
}

export const trustProxyFromEnv = (env: Record<string, string | undefined>): boolean => env.NP_RELAYER_TRUST_PROXY === '1';
