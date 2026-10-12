# Wave 3 results: sponsored voting with real Lace on Midnight Preview

Date: 2026-10-13 (JST). Network: Midnight **Preview**. Wallet: a throwaway Lace wallet with **0 DUST**.
Poll: `a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c` (the Wave 2 demo poll `03aa4564…` was not touched).

## What happened
1. **Register (sponsored).** The page proved `register` through the local proof server. Lace sealed it with
   `balanceUnsealedTransaction(…, {payFees:false})`, and the live relayer added DUST fees and submitted it.
   Tx `003834870040feb389a944c1cc163ce87e1dd6c15284c6b2bc5b6a93221a844bb8`, block 1266245.
2. **openVoting (admin, CLI).** Tx `0060623adcd64483a68a7dc52c8d07100390b364414f2150be4627ca08a9716415`, block 1266664.
3. **Vote option 0 (sponsored).** Lace's "Prove transaction" popup showed `network_id: "preview"`, entry point
   `vote` and the poll contract. Proof: 5379 B. The relayer submitted it.
   Tx `00c903265519aaf7696c189416b3b53aca2b982e1da0822f6069c8668c9fe441f0`. Tally afterwards: `[1, 0, 0]`.
4. **Duplicate vote.** It failed while proving, with `failed assert: NightPoll: already voted`. No Lace popup
   appeared and nothing was submitted.

![vote success](media/wave3/vote-success.png)
![Lace prove popup](media/wave3/popup-vote-prove.webp)

## Fixes after the run
- **Vote button stays enabled after voting.** The page now computes `voteNullifier(pollId, sk)` locally (with the
  contract's pure circuit) and checks it against the public `nullifiers` set. It does this on connect, on load,
  before proving a vote, and after a successful vote. If the nullifier is there, the Vote button is disabled and
  an "already voted" note is shown. The secret is used only as an input to the local hash.
- **First Connect click after a hard refresh does nothing.** On a hard refresh, Lace's content script can inject
  `window.midnight` after the page has rendered. A wallet `connect()` that never settles also left no trace in the
  page log. Connect now reads `window.midnight` lazily and polls for it for up to 3 s. It logs each step, and a
  `connect()` / `getConfiguration()` call that doesn't answer becomes a visible error.
