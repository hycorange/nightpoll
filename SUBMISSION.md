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
- Repo: https://github.com/hycorange/nightpoll/tree/wave3 (branch `wave3`)
- Demo video (≤3 min, 2:01): https://github.com/hycorange/nightpoll/releases/download/wave3-demo/nightpoll-wave3-demo.mp4 (release [`wave3-demo`](https://github.com/hycorange/nightpoll/releases/tag/wave3-demo)); same file in repo at `media/wave3/demo.mp4`. Terminal parts are a **local**
  recording (tests run live); Preview results are **replayed** from `docs/WAVE3-RESULTS.md`; UI shots are from the
  2026-10-13 JST live Preview run.
- Slides: `media/wave3/slides.pdf` · Live results: `docs/WAVE3-RESULTS.md` · Threat model: `docs/THREAT-MODEL.md`
- Hosted page (gh-pages, Wave 2 build, unchanged): https://hycorange.github.io/nightpoll/?contract=03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a — the Wave 3 relayer flow runs from branch `wave3` (see README).

## Limitations
Relayer can delay/censor (not forge or read votes); lone votes stay timing-linkable; submits are serialized (~20 s/tx);
Preview testnet only; not audited.

## Payout
Payout address (EVM): `0x2e75d927b3f475e95445cd9a33e49083a460d573`
(Set as the Wallet Address in the AKINDO user profile.)

## Changes since the Wave 2 submission
Wave 2 (submitted 2026-10-12, Preview contract `03aa4564…a90a`, unchanged) shipped private register/vote/tally with a
CLI and a GitHub Pages page. Everything in "What's new in Wave 3" above was built in the Wave 3 window on branch
`wave3`; `main`, `gh-pages` and the deployed contract were not modified.

## AKINDO required items (checked 2026-11-01 against the AKINDO Wave-hack page)
| Required | Where | Status |
| --- | --- | --- |
| Public GitHub repo | `hycorange/nightpoll`, branch `wave3` | pushed |
| README: project, setup, architecture, Midnight integration, how to test | `README.md` Wave 3 section | done |
| Slide deck | `media/wave3/slides.pdf` | done |
| Demo / video pitch | [demo video (2:01)](https://github.com/hycorange/nightpoll/releases/download/wave3-demo/nightpoll-wave3-demo.mp4) · `media/wave3/demo.mp4` | done |
| Progress during this Wave | "What's new in Wave 3" | done |
| Changes since previous submission | section above | done |

## Deadline / eligibility
- Wave 3 build Oct 27 – **Nov 16, 2026**; judging Nov 16 – 27. AKINDO: "The end of each Build Period is the applicable
  Submission Deadline"; the exact time is shown on the AKINDO submission page — **re-check there**; plan to submit by
  Nov 15 JST.
- KYC: not stated in the public program text; if a check applies it is at payout, not submission.
