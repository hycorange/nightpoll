// SPDX-License-Identifier: Apache-2.0
// Wave 3 (M4) browser vote page: Lace connects + pays/approves; proving via local proof server proxy;
// the member's NightPoll key stays in this browser; optional DUST sponsorship through the relayer.
import { useState } from 'react';
import { connectPreview } from './connector';
import { validateTarget } from './guard';
import { exportKey, getOrCreateKey, importKey } from './keystore';
import { httpRelayer, submitProven, type Mode } from './submit';
import { makeChain, type PollView } from './chain';

type Chain = Awaited<ReturnType<typeof makeChain>>;
type Conn = Awaited<ReturnType<typeof connectPreview>>;
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const btn = { padding: '8px 14px', borderRadius: 6, marginRight: 8 } as const;

export function VoteApp() {
  const [conn, setConn] = useState<Conn | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [addr, setAddr] = useState(new URLSearchParams(location.search).get('contract') ?? '');
  const [poll, setPoll] = useState<PollView | null>(null);
  const [mode, setMode] = useState<Mode>('sponsored');
  const [choice, setChoice] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (m: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${m}`]);

  const run = (f: () => Promise<void>) => async () => {
    setBusy(true);
    try { await f(); } catch (e) { say(`ERROR: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const target = () => { const t = validateTarget(addr); if (!t.ok) throw new Error(t.reason); return t.address; };

  const connect = run(async () => {
    const c = await connectPreview(window.midnight);
    setConn(c);
    setChain(await makeChain(c.connected, c.config, localStorage));
    say(`connected ${c.name} on ${c.config.networkId}; DUST ${(await c.connected.getDustBalance()).balance}`);
  });
  const load = run(async () => {
    const a = target(); if (!chain) throw new Error('connect first');
    const p = await chain.read(a); if (!p) throw new Error('no poll at this address on Preview');
    getOrCreateKey(localStorage, a, rand); setPoll(p); say(`loaded poll: ${p.question} (${p.phase})`);
  });
  const send = (circuit: 'register' | 'vote') => run(async () => {
    const a = target(); if (!chain || !conn) throw new Error('connect first');
    say(`${circuit}: proving via /proof-server (can take ~1 min)…`);
    const hex = await chain.prove(a, circuit, circuit === 'vote' ? [BigInt(choice)] : []);
    say(`${circuit}: proven (${hex.length / 2} bytes); submitting in mode "${mode}"`);
    const out = await submitProven(mode, hex, {
      wallet: conn.connected,
      relayer: httpRelayer(`${location.origin}/relayer`),
      localBind: chain.localBind,
      confirmFallback: async (r) => window.confirm(`Sponsored submit failed:\n${r}\n\nPay the fee from your own Lace wallet instead? (your wallet then appears as the fee payer)`),
      log: say,
    });
    say(out.via === 'relayer' ? `${circuit}: sponsored ✔ tx ${out.txId} (sealed by ${out.sealedBy})` : `${circuit}: submitted by Lace (wallet paid${out.fellBack ? ', FALLBACK' : ''})`);
    const p = await chain.read(a); if (p) setPoll(p);
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16, color: '#e8e8f0', background: '#0d0d1a', borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>🌙 NightPoll — vote (Wave 3, Preview only)</h1>
      <p style={{ opacity: 0.8 }}>Use a throwaway Lace wallet on Midnight Preview. Your vote key is stored only in this browser.</p>
      <button style={btn} onClick={connect} disabled={busy}>{conn ? `Connected (${conn.config.networkId})` : '1. Connect Lace'}</button>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="NEW poll contract address (hex)" style={{ flex: 1, padding: 8 }} />
        <button style={btn} onClick={load} disabled={busy || !chain}>2. Load poll</button>
      </div>
      <p>
        Fees: <label><input type="radio" checked={mode === 'sponsored'} onChange={() => setMode('sponsored')} /> relayer pays (sponsored)</label>{' '}
        <label><input type="radio" checked={mode === 'wallet'} onChange={() => setMode('wallet')} /> my Lace wallet pays</label>
      </p>
      {poll && (
        <section>
          <h2>{poll.question}</h2>
          <p>Phase <b>{poll.phase}</b> · members {poll.members.toString()} · votes {poll.votes.toString()} · tally [{poll.tally.join(', ')}]</p>
          <button style={btn} onClick={send('register')} disabled={busy || poll.phase !== 'REGISTRATION'}>3. Register</button>
          <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>{poll.tally.map((_, i) => <option key={i} value={i}>Option {i}</option>)}</select>{' '}
          <button style={btn} onClick={send('vote')} disabled={busy || poll.phase !== 'VOTING'}>4. Vote</button>
          <p style={{ fontSize: 13 }}>
            <button onClick={() => { const k = exportKey(localStorage, target()); if (k) { void navigator.clipboard.writeText(k); say('vote key copied to clipboard — keep it private'); } }}>Copy my vote key (backup)</button>{' '}
            <button onClick={() => { const k = window.prompt('Paste a 64-hex vote key for this poll'); if (k) { try { importKey(localStorage, target(), k); say('key imported'); } catch (e) { say(`ERROR: ${String(e)}`); } } }}>Import key</button>
          </p>
        </section>
      )}
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#1a1a2e', padding: 8, borderRadius: 6 }}>{log.join('\n') || 'log…'}</pre>
    </main>
  );
}
