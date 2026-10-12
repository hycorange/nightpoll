// SPDX-License-Identifier: Apache-2.0
// Local-only "have I already voted?" check. The vote nullifier H("nightpoll:nullifier:", pollId, sk) is computed
// in this page from the locally stored key and looked up in the public ledger's used-nullifier set. Nothing is
// sent anywhere: the indexer query is the same public contract-state read the page already does.
export type SetLike = { member(x: Uint8Array): boolean };
export type VoterLedger = { pollId: Uint8Array; nullifiers: SetLike; commitments: SetLike };
export type Hashers = {
  voteNullifier(id: Uint8Array, sk: Uint8Array): Uint8Array;
  memberCommitment(id: Uint8Array, sk: Uint8Array): Uint8Array;
};
export type VoterStatus = { registered: boolean; voted: boolean };

export function voterStatus(l: VoterLedger, sk: Uint8Array | null, h: Hashers): VoterStatus {
  if (!sk) return { registered: false, voted: false };
  return {
    registered: l.commitments.member(h.memberCommitment(l.pollId, sk)),
    voted: l.nullifiers.member(h.voteNullifier(l.pollId, sk)),
  };
}

/** Whether the Vote button may be pressed. */
export function canVote(phase: string | undefined, st: VoterStatus | null, busy: boolean): boolean {
  return !busy && phase === 'VOTING' && !st?.voted;
}
