#!/usr/bin/env node
// Render logs/e2e-summary-<network>.json (written by `npm run np -- e2e`) as a Markdown block.
// Usage: node scripts/summary.mjs <network> [--readme]   (--readme: replace the RESULTS block in README.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const net = process.argv[2] ?? 'preview';
const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', `e2e-summary-${net}.json`), 'utf8'));
const EXPLORER = { preview: 'https://preview.midnightexplorer.com', preprod: 'https://preprod.midnightexplorer.com' }[net];
const txLink = (h) => (EXPLORER && h ? `[\`${h.slice(0, 16)}…\`](${EXPLORER}/transactions/${h})` : h ? `\`${h}\`` : '');
const label = {
  'dust-registration': 'Register NIGHT for DUST (fees)', deploy: 'Deploy poll (3 options, open registration)',
  'register:alice': 'alice self-registers (commitment only)', 'register:bob': 'bob self-registers',
  'addMember:carol': 'admin adds carol\'s off-chain commitment', openVoting: 'admin opens voting',
  'vote:alice': 'anonymous vote #1 (option 0)', 'vote:bob': 'anonymous vote #2 (option 2)', 'vote:carol': 'anonymous vote #3 (option 2)',
  closePoll: 'admin closes poll',
};
const f = s.final;
const lines = [
  `**Network:** \`${s.network}\` · **run:** ${s.startedAt} → ${s.finishedAt} (UTC)`,
  '',
  `**Contract address:** ${EXPLORER ? `[\`${s.contractAddress}\`](${EXPLORER}/contracts/${s.contractAddress})` : `\`${s.contractAddress}\``}`,
  '',
  '| Step | Tx hash | Block |',
  '|---|---|---|',
  ...Object.entries(s.txs).map(([k, t]) => `| ${label[k] ?? k} | ${t.txHash ? txLink(t.txHash) : `id \`${t.txId}\``} | ${t.blockHeight ?? ''} |`),
  `| alice votes again (option 1) | **rejected before submission:** \`${s.doubleVote.replace(/^rejected: .*failed assert: /, '')}\` | — |`,
  '',
  `**Final on-chain state:** phase \`${f.phase}\`, ${f.members} members, ${f.totalVotes} votes, ${f.nullifiers} nullifiers, tally ${Object.entries(f.tally).map(([k, v]) => `#${k}=${v}`).join(' · ')}`,
];
const block = lines.join('\n');
console.log(block);
fs.writeFileSync(path.join(ROOT, 'logs', `SUMMARY-${net}.md`), block + '\n');
if (process.argv.includes('--readme')) {
  const rp = path.join(ROOT, 'README.md');
  const r = fs.readFileSync(rp, 'utf8');
  const A = `<!-- ${net.toUpperCase()}-RESULTS:START -->`, B = `<!-- ${net.toUpperCase()}-RESULTS:END -->`;
  if (!r.includes(A) || !r.includes(B)) { console.error(`README has no ${A} ... ${B} block`); process.exit(1); }
  fs.writeFileSync(rp, r.slice(0, r.indexOf(A) + A.length) + '\n' + block + '\n' + r.slice(r.indexOf(B)));
  console.error(`README.md ${net} results block updated`);
}
