# NightPoll threat model

Scope: the contract as deployed on the Midnight Preview testnet (contract
`03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a`), the reference CLI (`cli/`) and the
read-only viewer (`ui/`). Line numbers refer to the files at the commit that adds this document. The contract
source has not changed since the deployment.

Tests that back a statement are in `contract/src/test/nightpoll.test.ts` (original 19) and
`contract/src/test/nightpoll-edge.test.ts` (edge cases and documented limitations). Run them with `npm test`.

## Actors

- **Member**: holds a 32-byte secret key `sk`, kept in local private state and never put on the ledger.
- **Admin**: the deployer. Identified on chain only by `admin = H("nightpoll:admin:", pollId, sk_admin)`
  (`contract/src/nightpoll.compact` L48, L52-54).
- **Observer**: anyone who reads the public ledger, the indexer or the mempool, including the fee-paying wallet's history.

## What NightPoll protects

### 1. Ballot secrecy (which member cast which vote)
- Registration puts only `commitment = H("nightpoll:member:", pollId, sk)` on the ledger
  (`nightpoll.compact` L56-58, L78-81, L68-75).
- `vote(choice)` takes `sk` from a witness (L107) and recomputes the commitment inside the circuit (L108). It
  gets a Merkle path from a witness (L109) and discloses only the path's **root** (L111). The leaf, the path and
  `sk` stay private, so the proof does not say which registered commitment is voting.
- The vote publishes `nullifier = H("nightpoll:nullifier:", pollId, sk)` (L60-62, L114). The commitment and
  the nullifier use different domain tags, so nobody can link a nullifier to a commitment without `sk`. Both
  include `pollId`, so the same key looks unrelated across polls (tests "same key gives different
  commitments/nullifiers in different polls" and "a member's nullifier is independent across polls").
- No secret key is ever written to the ledger (test "ledger never contains secret keys").

### 2. One vote per member
- Each vote inserts its nullifier into `nullifiers` and fails if it is already there (L114-116,
  "NightPoll: already voted"). The same key always gives the same nullifier, so a second vote fails even for a
  different option. This was also shown on Preview, where alice's second vote was rejected before submission.
- A rejected call changes nothing in public state: an invalid option or a failed check does not use up the
  member's vote (edge tests "failed calls leave the ledger unchanged" and "an invalid-option attempt does not
  burn the member's vote").

### 3. Only members can vote
- The circuit re-checks what the untrusted witness returns: the path leaf must equal the recomputed commitment
  (L110), and the path root must be a root of the on-chain `members` tree (L111-112, `HistoricMerkleTree<10>`,
  L32). Tests cover a forged path from another tree, a path borrowed from another member and a non-member.
- The off-chain witness (`contract/src/witnesses.ts` L21-30) only looks up the path. Its honesty is not relied on.

### 4. A tally anyone can verify, and phase rules
- `tally` and `totalVotes` are public counters that only `vote()` changes, after all checks pass (L118-122).
  The edge tests check that the tally sums to totalVotes and to the number of nullifiers.
- Option range: `choice < optionCount` (L105). The option count is `Uint<8>`, at least 2 (L43), so at most 255
  options (boundary tests for 2 and 255 options).
- Phases only move REGISTRATION → VOTING → CLOSED (L89-100). Registration is only possible in REGISTRATION
  (L69), voting only in VOTING (L103). A poll can't be reopened, closed twice or closed from REGISTRATION (edge tests).
- Admin actions (`addMember`, `openVoting`, `closePoll`) require the caller's key to hash to `admin` (L64-66).
  A member key or another poll's admin key is rejected (edge tests).

## What NightPoll does NOT protect (known limitations)

1. **Fee-payer linkability.** Midnight fees are paid in DUST by a wallet. The reference CLI builds one wallet
   per run from one seed (`cli/src/main.ts` L49-50) and uses it as wallet and submitter for every identity
   (`cli/src/api.ts` L54-55). If the same wallet sends a member's `register` and that member's `vote`, an
   observer can link the two transactions. Because the choice is public (item 2), that reveals who voted for
   what. In the Preview demo one wallet paid for all identities, so **the demo shows the protocol, not
   real-world anonymity.**
2. **The choice in each vote is public.** `choice` is disclosed (L104), so the tally can be checked. Each vote
   tx shows which option it adds to. Only the voter is hidden.
3. **Timing correlation.** Transaction order and timing are public. A vote sent soon after a known
   registration, or from a known IP or wallet, can be correlated. The contract does not batch or delay anything.
4. **Small anonymity set.** A voter hides among the members registered at that point. With 3 members (as in the
   demo), or when results are lopsided (for example everyone picks the same option), anonymity is weak or none.
   The tree holds up to 1024 members (L32).
5. **Admin-curated membership is trusted.** In curated mode (`openRegistration = false`), `addMember` accepts
   any 32 bytes (L84-87). The circuit cannot tell a real member's commitment from one the admin made itself.
   The admin can:
   - add commitments for keys it controls and vote with each of them (edge test "LIMITATION: … admin can add
     commitments for keys it controls");
   - inflate `memberCount` with commitments nobody can open; this also satisfies the "no members" check in
     `openVoting` (L92) (edge test "LIMITATION: addMember accepts any 32 bytes");
   - refuse to add members, or open and close the poll whenever it wants (L89-100).

   The admin **cannot** vote with someone else's commitment, see ballots, change the tally or remove a
   nullifier. There is no admin-key recovery: if `sk_admin` is lost, the poll can't be opened or closed.
6. **No Sybil resistance with open registration.** With `openRegistration = true`, `register()` (L78-81) accepts
   any new key. One person with several keys gets several votes (edge test "LIMITATION: with open registration
   …"). Open registration fits only when anyone may vote and nobody needs to be stopped from voting more than once.
7. **Key custody on the device.** The member's `sk` is created at random (`cli/src/api.ts` L59). It is stored in
   the LevelDB private-state store, encrypted with a password kept in a file next to it under `.secrets/`
   (`cli/src/api.ts` L31-38, mode 600). This protects against casual copying of the database, not against
   someone who can read the user's files. Losing `sk` means losing the vote. Leaking it lets someone else vote
   instead, and with the commitment it links the person to their vote.
8. **The viewer is read-only.** `ui/` only reads public state from the indexer. It does not create keys or
   proofs and does not vote.

No contract bug was found while writing the edge tests: every safety check listed above held. The items above
are design limitations, not deviations from the intended behaviour.

## Mitigations and roadmap

| Limitation | Mitigation | Status |
|---|---|---|
| 1 Fee-payer linkability | **DUST fee sponsorship / relayer**: a sponsor pays the vote fee, so the voter's wallet never appears. Until then, use a different, unlinked wallet for voting than for registering | Wave 3 (planned) |
| 1, 7 Key handling | **Browser voting with Lace** (DApp connector): keys and proofs stay in the user's wallet and browser | Wave 3 (planned) |
| 3 Timing | Batched or delayed vote submission, and a registration cut-off well before voting opens | roadmap |
| 4 Small sets | Show the member count before voting. Use polls with large member sets only for sensitive questions | operational |
| 5, 6 Membership trust / Sybil | **Credential-gated registration** with selective disclosure (prove "member of X" instead of trusting an admin list) | Wave 3 (planned) |
| 2 Public choice | Commit-reveal tallies (results revealed after close) for multi-question surveys | roadmap |
