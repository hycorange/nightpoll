// SPDX-License-Identifier: Apache-2.0
import type { WitnessContext, MerkleTreePath } from "@midnight-ntwrk/compact-runtime";
import type { Ledger, Witnesses } from "./managed/nightpoll/contract/index.js";

/** Private state kept only on the member's device. */
export type NightPollPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createNightPollPrivateState = (secretKey: Uint8Array): NightPollPrivateState => ({
  secretKey,
});

export const witnesses: Witnesses<NightPollPrivateState> = {
  localSecretKey: ({ privateState }: WitnessContext<Ledger, NightPollPrivateState>) => [
    privateState,
    privateState.secretKey,
  ],
  // Looks the member's commitment up in the public members tree and returns its
  // Merkle path. The path stays private; the circuit only discloses the root.
  findMembershipPath: (
    { privateState, ledger }: WitnessContext<Ledger, NightPollPrivateState>,
    commitment: Uint8Array,
  ): [NightPollPrivateState, MerkleTreePath<Uint8Array>] => {
    const path = ledger.members.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error("NightPoll: this key is not registered in the poll");
    }
    return [privateState, path];
  },
};
