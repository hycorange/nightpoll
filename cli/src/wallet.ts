// Wallet plumbing adapted from midnightntwrk/example-bboard (bboard-cli), Apache-2.0/MIT.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import type { FacadeState, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { type DustWalletOptions, type EnvironmentConfiguration, FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';
import { SECRETS_DIR, STATE_DIR } from './config.js';
import zlib from 'node:zlib';
import {
  ShieldedWallet, UnshieldedWallet, DustWallet, WalletFacade as Facade,
  InMemoryTransactionHistoryStorage, WalletEntrySchema, mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';

type UnshieldedKeystore = { getPublicKey(): unknown; signData(payload: Uint8Array): string };

export const seedFile = (network: string) => path.join(SECRETS_DIR, `${network}-wallet.seed`);

/** Create (once) a throwaway testnet seed with the official HD SDK; stored chmod 600. */
export const loadOrCreateSeed = (network: string, logger: Logger): string => {
  const f = seedFile(network);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const seed = Buffer.from(generateRandomSeed()).toString('hex');
  fs.writeFileSync(f, seed + '\n', { mode: 0o600 });
  fs.chmodSync(f, 0o600);
  logger.info(`Created new testnet-only wallet seed at ${f} (chmod 600)`);
  return seed;
};

const unshieldedSeed = (seed: string): Uint8Array => {
  const r = HDWallet.fromSeed(Buffer.from(seed, 'hex')) as { type: 'seedOk'; hdWallet: HDWallet };
  const d = r.hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (d.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return d.key;
};

const strictlyComplete = (p: unknown): boolean =>
  !!p && typeof (p as { isStrictlyComplete?: unknown }).isStrictlyComplete === 'function' &&
  (p as { isStrictlyComplete: () => boolean }).isStrictlyComplete();
export const isSynced = (s: FacadeState) =>
  strictlyComplete(s.shielded.state.progress) && strictlyComplete(s.dust.state.progress) && strictlyComplete(s.unshielded.progress);

export class NightPollWallet implements MidnightProvider, WalletProvider {
  private constructor(
    readonly logger: Logger,
    readonly env: EnvironmentConfiguration,
    readonly seed: string,
    public wallet: WalletFacade,
    readonly zswapSecretKeys: ZswapSecretKeys,
    readonly dustSecretKey: DustSecretKey,
    readonly keystore: UnshieldedKeystore,
  ) {}

  /** Wallet sync-state cache (gzip JSON, chmod 600) so we don't resync from genesis each run. */
  static stateFile(network: string, seed: string): string {
    const tag = createHash('sha256').update(seed).digest('hex').slice(0, 12);
    return path.join(STATE_DIR, `wallet-${network}-${tag}.json.gz`);
  }

  static async build(logger: Logger, env: EnvironmentConfiguration, seed: string): Promise<NightPollWallet> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      // same as example-bboard: the local dev chain needs a much larger fee overhead
      additionalFeeOverhead: env.walletNetworkId === 'undeployed' ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    const builder = FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions).withSeed(seed);
    const seeds = WalletSeeds.fromMasterSeed(seed);
    const keystore = createKeystore(seeds.unshielded, env.walletNetworkId as never) as unknown as UnshieldedKeystore;
    const file = NightPollWallet.stateFile(env.networkId, seed);
    let wallet: WalletFacade | undefined;
    if (fs.existsSync(file) && !process.env.NP_FRESH_SYNC) {
      try {
        const saved = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')) as { shielded: string; unshielded: string; dust: string };
        // Same configuration the testkit builder uses (mapEnvironmentToConfiguration), read from the builder.
        const config = (builder as unknown as { config: Record<string, unknown> }).config;
        const dustConfig = { ...config, costParameters: { ...dustOptions } };
        const unshieldedConfig = { ...config, txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries) };
        const shielded = (ShieldedWallet as unknown as (c: unknown) => { restore(s: string): unknown })(config).restore(saved.shielded);
        const unshielded = (UnshieldedWallet as unknown as (c: unknown) => { restore(s: string): unknown })(unshieldedConfig).restore(saved.unshielded);
        const dust = (DustWallet as unknown as (c: unknown) => { restore(s: string): unknown })(dustConfig).restore(saved.dust);
        wallet = (await (Facade as unknown as { init(o: unknown): Promise<WalletFacade> }).init({
          configuration: config, shielded: () => shielded, unshielded: () => unshielded, dust: () => dust,
        }));
        logger.info(`Restored wallet sync state from ${path.basename(file)}`);
      } catch (e) {
        logger.warn(`Could not restore wallet state (${e instanceof Error ? e.message : e}); doing a full sync`);
        wallet = undefined;
      }
    }
    if (!wallet) {
      const res = (await builder.buildWithoutStarting()) as unknown as { wallet: WalletFacade };
      wallet = res.wallet;
    }
    return new NightPollWallet(logger, env, seed, wallet, ZswapSecretKeys.fromSeed(seeds.shielded), DustSecretKey.fromSeed(seeds.dust), keystore);
  }

  async saveState(): Promise<void> {
    const file = NightPollWallet.stateFile(this.env.networkId, this.seed);
    const w = this.wallet as unknown as Record<'shielded' | 'unshielded' | 'dust', { serializeState(): Promise<string> }>;
    const data = { shielded: await w.shielded.serializeState(), unshielded: await w.unshielded.serializeState(), dust: await w.dust.serializeState() };
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(data)), { mode: 0o600 });
    fs.renameSync(tmp, file);
    this.logger.debug(`wallet state saved (${path.basename(file)})`);
  }

  getCoinPublicKey(): CoinPublicKey { return this.zswapSecretKeys.coinPublicKey; }
  getEncryptionPublicKey(): EncPublicKey { return this.zswapSecretKeys.encryptionPublicKey; }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx, { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey }, { ttl });
    const signed = await this.wallet.signRecipe(recipe, (p) => this.keystore.signData(p));
    return this.wallet.finalizeRecipe(signed);
  }
  /**
   * Submit, then wait until the dust wallet has applied the resulting dust event. Otherwise the next tx in the
   * same process is balanced against a stale dust tree/UTXO and the node rejects it (InvalidDustSpendProof).
   */
  async submitTx(tx: FinalizedTransaction): Promise<string> {
    const dustIdx = (s: FacadeState) => BigInt((s.dust.state.progress as unknown as { appliedIndex: bigint }).appliedIndex ?? 0n);
    const before = dustIdx(await Rx.firstValueFrom(this.wallet.state()));
    const id = await this.wallet.submitTransaction(tx);
    try {
      await Rx.firstValueFrom(this.wallet.state().pipe(
        Rx.tap((s) => this.logger.debug(`dust progress ${JSON.stringify(s.dust.state.progress, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`)),
        Rx.filter((s) => isSynced(s) && dustIdx(s) > before), Rx.timeout(Number(process.env.NP_DUST_WAIT_MS ?? 20_000))));
    } catch {
      // Observed on the local dev chain: after the wallet submits its own tx, its dust-event subscription
      // can stall silently, leaving a stale dust tree. Re-open the wallet from its serialized state (which
      // keeps the pending dust spend) so it resubscribes and catches up before the next tx.
      this.logger.warn(`dust wallet did not observe tx ${id} in time; re-opening wallet from saved state to resync`);
      await this.reopen(before);
    }
    return id;
  }

  async reopen(dustIndexBefore = -1n): Promise<void> {
    await this.saveState();
    await this.wallet.stop();
    const fresh = await NightPollWallet.build(this.logger, this.env, this.seed);
    this.wallet = fresh.wallet;
    await this.start();
    await this.sync(5 * 60_000);
    const idx = (st: FacadeState) => BigInt((st.dust.state.progress as unknown as { appliedIndex: bigint }).appliedIndex ?? 0n);
    try {
      const st = await Rx.firstValueFrom(this.wallet.state().pipe(Rx.filter((st) => idx(st) > dustIndexBefore), Rx.timeout(120_000)));
      this.logger.info(`wallet re-opened; dust events applied up to ${idx(st)}`);
    } catch {
      this.logger.warn('wallet re-opened but dust index did not advance');
    }
  }

  async start() {
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
    if (process.env.NP_DEBUG_DUST) {
      (this.wallet.dust as unknown as { state: Rx.Observable<{ progress: unknown }> }).state.subscribe({
        next: (d) => this.logger.info(`[dust] ${JSON.stringify(d.progress, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`),
        error: (e) => this.logger.error(`[dust] stream error ${e}`),
        complete: () => this.logger.warn('[dust] stream completed'),
      });
    }
  }
  async stop() {
    try { await this.saveState(); } catch (e) { this.logger.warn(`state save on stop failed: ${e}`); }
    await this.wallet.stop();
  }

  async addresses() {
    const u = await Rx.firstValueFrom(this.wallet.unshielded.state);
    const s = await Rx.firstValueFrom(this.wallet.shielded.state);
    return {
      unshielded: UnshieldedAddress.codec.encode(getNetworkId(), u.address).toString(),
      shieldedCoinPublicKey: s.address.coinPublicKeyString(),
    };
  }

  async sync(timeoutMs = 15 * 60_000): Promise<FacadeState> {
    this.logger.info('Syncing wallet...');
    let last = 0;
    return Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.tap((s) => {
          if (Date.now() - last > 30_000) {
            last = Date.now();
            this.saveState().catch((e) => this.logger.warn(`state save failed: ${e}`));
            this.logger.info(`sync progress: ${JSON.stringify({ shielded: s.shielded.state.progress, dust: s.dust.state.progress, unshielded: s.unshielded.progress }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
          }
        }),
        Rx.filter(isSynced),
        Rx.timeout(timeoutMs),
      ),
    ).then(async (st) => { await this.saveState(); return st; });
  }

  /** Register unregistered NIGHT UTXOs for DUST generation (fees on Midnight are paid in DUST). */
  async ensureDust(state: FacadeState): Promise<string | undefined> {
    if (state.dust.balance(new Date()) > 0n) return undefined;
    const utxos = state.unshielded.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
    if (utxos.length === 0) return undefined;
    const ks = createKeystore(unshieldedSeed(this.seed), getNetworkId());
    const dustState = await this.wallet.dust.waitForSyncedState();
    // Per docs (guides/acquire-tokens): the first registration pays its own fee from DUST the NIGHT
    // has generated since it arrived, so wait until enough has accrued.
    const { fee } = await this.wallet.estimateRegistration(utxos);
    this.logger.info(`Registration fee estimate: ${fee}; waiting for generated DUST to cover it...`);
    await this.wallet.waitForGeneratedDust(utxos, fee);
    this.logger.info(`Registering ${utxos.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await this.wallet.registerNightUtxosForDustGeneration(utxos, ks.getPublicKey(), (p) => ks.signData(p), dustState.address);
    const txId = await this.wallet.submitTransaction(await this.wallet.finalizeRecipe(recipe));
    this.logger.info(`DUST registration tx: ${txId}; waiting for DUST balance...`);
    await Rx.firstValueFrom(this.wallet.state().pipe(Rx.filter((s) => s.dust.balance(new Date()) > 0n), Rx.timeout(15 * 60_000)));
    return txId;
  }
}
