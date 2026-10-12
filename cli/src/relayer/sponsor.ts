// SPDX-License-Identifier: Apache-2.0
// Chain-facing halves of the sponsored vote, following the pattern of midnightntwrk/example-private-party
// (src/sponsor.ts, Apache-2.0) and https://docs.midnight.network/guides/dust-sponsorship :
//   user side:    build vote() call -> prove locally -> balance own value only (no DUST) -> sign -> bind -> hex
//   sponsor side: deserialize bound tx -> policy -> add DUST fee offer (tokenKindsToBalance ['dust']) -> submit
// The user's secret key and Merkle path never leave the user's machine; the sponsor only sees the proof.
import { Transaction, type Binding, type Proof, type SignatureEnabled } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import type { NightPollWallet } from '../wallet.js';
import { summarize, type TxLike, type TxSummary } from './policy.js';
import type { Sponsor } from './server.js';

export const deserializeBound = (hex: string) =>
  Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature', 'proof', 'binding', fromHex(hex));

/** Sponsor backed by a NightPollWallet that holds NIGHT registered for DUST generation (throwaway wallet only). */
export function walletSponsor(wallet: NightPollWallet, network: string): Sponsor {
  return {
    network,
    inspect: (hex: string): TxSummary => summarize(deserializeBound(hex) as unknown as TxLike),
    async sponsorAndSubmit(hex: string) {
      const sponsored = await wallet.addDustFeesAndFinalize(deserializeBound(hex));
      return wallet.submitTx(sponsored);
    },
    dustBalance: () => wallet.dustBalance(),
  };
}

/** Serialize the user's bound transaction for the relayer. */
export const toWire = (tx: { serialize(): Uint8Array }): string => toHex(tx.serialize());
