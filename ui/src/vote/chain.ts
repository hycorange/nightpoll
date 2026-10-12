// SPDX-License-Identifier: Apache-2.0
// Browser-side midnight-js plumbing: build + prove a NightPoll call with the member's local key.
// Proving goes to the same-origin `/proof-server` proxy (Lace has no in-browser prover); ZK artifacts are
// served by the dev server under `/zk`.
import type { ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import * as NP from '../../../contract/src/managed/nightpoll/contract/index.js';
import { witnesses } from '../../../contract/src/witnesses';
import { fromHex, keyToHex, toHex } from './bech32m';
import { kvPrivateStateProvider, type KV } from './keystore';

export const PS_ID = 'nightpoll:browser';
const Compiled = CompiledContract.make('NightPoll', NP.Contract as never).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('/zk' as never),
);

export type PollView = { question: string; phase: string; options: number; members: bigint; votes: bigint; tally: bigint[]; selfRegistration: boolean };

export async function makeChain(wallet: ConnectedAPI, config: Configuration, kv: KV, origin = location.origin) {
  setNetworkId(config.networkId);
  const zk = new FetchZkConfigProvider<string>(`${origin}/zk`, fetch.bind(window));
  const pdp = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, WebSocket as never);
  const addrs = await wallet.getShieldedAddresses();
  const ps = kvPrivateStateProvider(kv);
  const providers = {
    zkConfigProvider: zk,
    publicDataProvider: pdp,
    privateStateProvider: ps,
    walletProvider: {
      getCoinPublicKey: () => keyToHex(addrs.shieldedCoinPublicKey),
      getEncryptionPublicKey: () => keyToHex(addrs.shieldedEncryptionPublicKey),
      balanceTx: () => { throw new Error('balancing is done by the connector, not here'); },
    },
  };
  const proof = httpClientProofProvider(`${origin}/proof-server`, zk);

  async function read(contract: string): Promise<PollView | null> {
    const st = await pdp.queryContractState(contract as never);
    if (!st) return null;
    const l = NP.ledger(st.data);
    const tally: bigint[] = [];
    for (let i = 0n; i < l.optionCount; i++) tally.push(l.tally.member(i) ? l.tally.lookup(i).read() : 0n);
    return { question: l.question, phase: NP.Phase[l.phase], options: Number(l.optionCount), members: l.memberCount, votes: l.totalVotes, tally, selfRegistration: l.selfRegistration };
  }

  /** Build + prove; returns hex of Transaction<SignatureEnabled, Proof, PreBinding> (what the connector expects). */
  async function prove(contract: string, circuitId: 'register' | 'vote', args: unknown[]): Promise<string> {
    ps.setContractAddress(contract);
    const u = await createUnprovenCallTx(providers as never, { compiledContract: Compiled, contractAddress: contract, circuitId, args, privateStateId: PS_ID } as never);
    const proven = await proof.proveTx((u as unknown as { private: { unprovenTx: never } }).private.unprovenTx);
    return toHex((proven as unknown as { serialize(): Uint8Array }).serialize());
  }

  /** Fallback seal without any wallet (a NightPoll call moves no value). */
  function localBind(unsealedHex: string): string {
    const t = Transaction.deserialize('signature', 'proof', 'pre-binding', fromHex(unsealedHex));
    return toHex(t.bind().serialize());
  }

  return { read, prove, localBind };
}
