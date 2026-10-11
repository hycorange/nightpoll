// Minimal NightPoll viewer: reads a deployed poll's public ledger from the Preview indexer
// and decodes it with the compiled contract's `ledger()` (compact-runtime WASM).
// Voting from the browser via the Lace DApp connector is the next step (see README).
import { useState } from 'react';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger, Phase } from '../../contract/src/managed/nightpoll/contract/index.js';

const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
setNetworkId('preview');
const pdp = indexerPublicDataProvider(INDEXER, INDEXER_WS, WebSocket as never);

type View = { question: string; phase: string; members: bigint; votes: bigint; tally: bigint[] };

export function App() {
  const [addr, setAddr] = useState(new URLSearchParams(location.search).get('contract') ?? '');
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setErr(''); setView(null);
    try {
      const st = await pdp.queryContractState(addr.trim() as never);
      if (!st) throw new Error('No contract state found at this address on Preview.');
      const l = ledger(st.data);
      const tally: bigint[] = [];
      for (let i = 0n; i < l.optionCount; i++) tally.push(l.tally.member(i) ? l.tally.lookup(i).read() : 0n);
      setView({ question: l.question, phase: Phase[l.phase], members: l.memberCount, votes: l.totalVotes, tally });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const max = view ? Math.max(1, ...view.tally.map(Number)) : 1;
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16, color: '#e8e8f0', background: '#0d0d1a', borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>🌙 NightPoll</h1>
      <p style={{ opacity: 0.8 }}>Anonymous polls on Midnight. Members prove membership in zero knowledge; a nullifier blocks double votes. Only totals are public.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="contract address (hex)" style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #444', background: '#1a1a2e', color: 'inherit' }} />
        <button onClick={load} disabled={busy || !addr} style={{ padding: '8px 14px', borderRadius: 6 }}>{busy ? 'Loading…' : 'Load poll'}</button>
      </div>
      {err && <p style={{ color: '#ff8080' }}>{err}</p>}
      {view && (
        <section style={{ marginTop: 24 }}>
          <h2>{view.question}</h2>
          <p>Phase: <b>{view.phase}</b> · Members: <b>{view.members.toString()}</b> · Votes: <b>{view.votes.toString()}</b></p>
          {view.tally.map((n, i) => (
            <div key={i} style={{ margin: '8px 0' }}>
              <div>Option {i}: {n.toString()}</div>
              <div style={{ height: 10, width: `${(Number(n) / max) * 100}%`, minWidth: 2, background: '#7b61ff', borderRadius: 4 }} />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
