---
marp: true
paginate: true
---
# NightPoll · Wave 3
Private one-member-one-vote polls on Midnight — now **without a wallet**

---
## Problem
- Wave 2: ballots secret (ZK + nullifier), but the **fee payer** links a wallet to each vote
- Voters need DUST and a wallet just to vote

---
## Wave 3: relayer voting
- Prove `register`/`vote` locally → seal without fees → POST to relayer
- Relayer: allow-listed contract + entry points, sponsor pays DUST, submits
- Works with Lace (`payFees:false`) or with **no wallet at all**

---
## Breaking timing links
- `NP_RELAYER_JITTER_MS`: random delay per submit
- `NP_RELAYER_BATCH_MS/MAX`: mixing window, shuffled submission
- Live Preview: 3 simultaneous requests landed as **1, 0, 2**

---
## Stale-proof recovery
- Node `Custom error: 104` when state moved after proving
- Relayer → `409 STALE_PROOF` (retryable, slot + budget refunded)
- UI: 证明已过期，请重新生成 → auto re-prove + resend **once**

---
## Evidence
- Preview tally `[1, 0, 2]`, 3 wallet-less members, tx ids in `docs/WAVE3-RESULTS.md`
- Duplicate vote fails in the prover (`already voted`)
- Tests: contract 38 · cli 51 · ui 38 · no IPs in relayer logs

---
## Limits & next
- Relayer can delay/censor (not forge/read); lone votes still timing-linkable
- Serialized submits (~20 s/tx)
- Next: credential-gated registration, multi-relayer, hosted poll page
