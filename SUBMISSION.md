# NightPoll — Midnight Buildathon Wave 3 submission (DRAFT, not submitted)

**One line:** private one-member-one-vote polls on Midnight. Ballots stay secret (ZK proof + nullifier), and in Wave 3
members can vote **without a wallet**: a sponsor relayer pays the DUST fee.

## What's new in Wave 3
- **Wallet-less relayer voting.** Prove `register`/`vote` locally, seal without fees, POST to a relayer that only accepts
  allow-listed contracts/entry points, pays DUST and submits. Works with Lace (`payFees:false`) or with no wallet at all.
- **Jitter + mixing window** (`NP_RELAYER_JITTER_MS`, `NP_RELAYER_BATCH_MS/MAX`): random delay and shuffled submission.
  Live Preview rerun: 3 simultaneous requests landed as 1, 0, 2; tally `[1, 0, 2]`.
- **Stale-proof recovery.** Node `Custom error: 104` → relayer `409 STALE_PROOF` (slot + budget refunded) → UI shows
  证明已过期，请重新生成, re-proves and resends once.
- No-IP relayer logging, salted client keys, opt-in trusted proxy.
- Tests: contract 38 · cli 51 · ui 38.

## Links
- Repo: `<PLACEHOLDER: public GitHub URL — wave3 not yet pushed>`
- Demo video (≤3 min): `<PLACEHOLDER: upload URL>`; local file `media/wave3/demo.mp4` (2:01). Terminal parts are a **local**
  recording (tests run live); Preview results are **replayed** from `docs/WAVE3-RESULTS.md`; UI shots are from the
  2026-10-13 JST live Preview run.
- Slides: `media/wave3/slides.pdf` · Live results: `docs/WAVE3-RESULTS.md` · Threat model: `docs/THREAT-MODEL.md`
- Hosted page (gh-pages): `<PLACEHOLDER>`

## Limitations
Relayer can delay/censor (not forge or read votes); lone votes stay timing-linkable; submits are serialized (~20 s/tx);
Preview testnet only; not audited.

## Payout
Payout address (EVM): `0x2e75d927b3f475e95445cd9a33e49083a460d573`
(Grants go to the address registered on the AKINDO team page; must be set there before the deadline — not done yet.)

## Deadline / eligibility (UNVERIFIED)
- Wave 3 build Oct 27 – **Nov 16, 2026**; judging Nov 16 – 27 (https://midnight.network/hackathon/buildathon).
  **Exact time and timezone unverified**; plan to submit by Nov 15 JST.
- KYC: **unverified.** Program text mentions eligibility/compliance checks; if KYC applies it is likely at payout, not submission.
