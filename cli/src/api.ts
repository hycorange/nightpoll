// NightPoll DApp API (deploy / join / circuit calls), modeled on example-bboard/api.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract, findDeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import * as NP from '../../contract/src/managed/nightpoll/contract/index.js';
import { witnesses, type NightPollPrivateState } from '../../contract/src/witnesses.js';
import { SECRETS_DIR, STATE_DIR, ZK_PATH } from './config.js';
import type { NightPollWallet } from './wallet.js';

export type NightPollContract = NP.Contract<NightPollPrivateState, NP.Witnesses<NightPollPrivateState>>;
export type CircuitKeys = Exclude<keyof NightPollContract['provableCircuits'], number | symbol>;
export type NightPollProviders = MidnightProviders<CircuitKeys, string, NightPollPrivateState>;
export type DeployedNightPoll = FoundContract<NightPollContract>;

export const CompiledNightPoll = CompiledContract.make<NightPollContract>('NightPoll', NP.Contract<NightPollPrivateState>).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ZK_PATH),
);

/** Each local identity ("admin", "alice", ...) gets its own private-state slot = its own secret key. */
export const psId = (identity: string) => `nightpoll:${identity}`;

const storagePassword = (): string => {
  const f = path.join(SECRETS_DIR, 'private-state.password');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(f, `Np-${randomBytes(18).toString('base64url')}-9a!`, { mode: 0o600 });
  }
  return fs.readFileSync(f, 'utf8').trim();
};

export const buildProviders = (env: EnvironmentConfiguration, wallet: NightPollWallet): NightPollProviders => {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const zk = new NodeZkConfigProvider<CircuitKeys>(ZK_PATH);
  return {
    privateStateProvider: levelPrivateStateProvider<string, NightPollPrivateState>({
      midnightDbName: path.join(STATE_DIR, `level-${env.networkId}`),
      privateStateStoreName: 'nightpoll-private-state',
      signingKeyStoreName: 'nightpoll-signing-keys',
      privateStoragePasswordProvider: storagePassword,
      accountId: wallet.getCoinPublicKey().toString(),
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
};

export const newPrivateState = (): NightPollPrivateState => ({ secretKey: new Uint8Array(randomBytes(32)) });

export async function deployPoll(
  providers: NightPollProviders,
  admin: string,
  question: string,
  options: number,
  openRegistration: boolean,
): Promise<DeployedNightPoll> {
  const pollId = new Uint8Array(randomBytes(32));
  return deployContract(providers, {
    compiledContract: CompiledNightPoll,
    privateStateId: psId(admin),
    initialPrivateState: newPrivateState(),
    args: [pollId, question, BigInt(options), openRegistration],
  } as never) as unknown as Promise<DeployedNightPoll>;
}

export async function joinPoll(providers: NightPollProviders, contractAddress: string, identity: string): Promise<DeployedNightPoll> {
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(psId(identity));
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: CompiledNightPoll,
    privateStateId: psId(identity),
    initialPrivateState: existing ?? newPrivateState(),
  } as never) as unknown as Promise<DeployedNightPoll>;
}

export async function readLedger(providers: NightPollProviders, contractAddress: string): Promise<NP.Ledger | null> {
  const s = await providers.publicDataProvider.queryContractState(contractAddress as never);
  return s ? NP.ledger(s.data) : null;
}

export const phaseName = (p: NP.Phase) => NP.Phase[p];
