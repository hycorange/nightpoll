// Create (once) a throwaway relayer seed at .secrets/<network>-relayer.seed (chmod 600, gitignored) and print
// its unshielded address (the faucet target). Never prints the seed.
import fs from 'node:fs';
import path from 'node:path';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { SECRETS_DIR } from '../config.js';

const network = process.env.NP_NETWORK ?? 'preview';
if (network === 'mainnet') throw new Error('refusing mainnet');
const f = path.join(SECRETS_DIR, `${network}-relayer.seed`);
if (!fs.existsSync(f)) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, Buffer.from(generateRandomSeed()).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
}
const seed = fs.readFileSync(f, 'utf8').trim();
const r = HDWallet.fromSeed(Buffer.from(seed, 'hex')) as { type: 'seedOk'; hdWallet: HDWallet };
const d = r.hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
if (d.type === 'keyOutOfBounds') throw new Error('derivation failed');
const ks = createKeystore(d.key, network as never) as unknown as { getBech32Address(): { asString(): string } | string };
const a = ks.getBech32Address();
console.log(JSON.stringify({ network, seedFile: f, unshieldedAddress: typeof a === 'string' ? a : a.asString() }));
