// Headless smoke test of vote.html with a FAKE connector (no Lace, no wallet, nothing submitted).
// Needs: proof server :6300, 'npm run relayer:dry' and 'npm run dev -w @nightpoll/ui' running; npm i puppeteer-core; CHROME=/path/to/chrome node ui/scripts/headless-smoke.mjs
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/opt/google/chrome/chrome', headless: true, userDataDir: '/tmp/nightpoll-smoke-profile', args: ['--no-first-run'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.evaluateOnNewDocument(() => {
  window.midnight = { mnLace: { name: 'FakeLace', apiVersion: '4.0.1', icon: '', rdns: 'fake', connect: async (n) => ({
    getConfiguration: async () => ({ networkId: n, indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql', indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws', substrateNodeUri: '' }),
    getShieldedAddresses: async () => ({ shieldedAddress: '', shieldedCoinPublicKey: '11'.repeat(32), shieldedEncryptionPublicKey: '22'.repeat(32) }),
    getDustBalance: async () => ({ balance: 0n, cap: 0n }),
    balanceUnsealedTransaction: async (tx, o) => { window.__seen = (window.__seen||[]).concat([{len: tx.length, payFees: o && o.payFees}]); throw new Error('fake wallet: cannot balance'); },
    submitTransaction: async () => { throw new Error('fake wallet: no submit'); },
  }) } };
});
await p.goto('http://127.0.0.1:5173/vote.html', { waitUntil: 'networkidle0', timeout: 120000 });
const click = async (t) => { const [h] = await p.$$(`xpath/.//button[contains(., "${t}")]`); await h.click(); };
await click('Connect Lace'); await new Promise((r) => setTimeout(r, 5000));
await p.type('input[placeholder^="NEW poll"]', 'a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c');
await click('Load poll'); await new Promise((r) => setTimeout(r, 6000));
p.on('dialog', async (d) => { console.log('DIALOG', d.message().replace(/\n/g,' | ')); await d.dismiss(); });
await click('Register');
for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 5000)); const t = await p.$eval('pre', (e) => e.textContent); if (/register: (sponsored|submitted)|ERROR/.test(t)) break; }
console.log('SEEN', JSON.stringify(await p.evaluate(() => window.__seen)));
console.log(await p.$eval('pre', (e) => e.textContent));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
