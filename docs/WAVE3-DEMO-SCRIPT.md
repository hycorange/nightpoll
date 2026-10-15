# NightPoll Wave 3 — demo script (≤ 3 min)

Target length 2:45. Record at 1280×720. Use a throwaway test poll on Preview (never the Wave 2 poll `03aa4564…`).

| # | Time | Shot (screen) | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:15 | Title slide (`media/wave3/slides.pdf` p1) | "NightPoll: private one-member-one-vote polls on Midnight. In Wave 3 members can vote without a wallet." |
| 2 | 0:15–0:35 | Slide 2, then README "Privacy caveats" | "In Wave 2 the ballot was secret, but whoever paid the fee was visible on chain. That linked a wallet to a vote." |
| 3 | 0:35–1:00 | Terminal: start relayer with `NP_RELAYER_JITTER_MS=6000 NP_RELAYER_BATCH_MS=15000` | "The relayer only accepts NightPoll calls to allow-listed contracts, pays DUST from a sponsor, and holds votes in a mixing window." |
| 4 | 1:00–1:35 | Second terminal: `npm run rerun:voters -w @nightpoll/cli` — 3 members, no wallet, POST at once; relayer log shows submit order 1, 0, 2 | "Three members prove locally and send at the same moment. The relayer submits them shuffled, after a random delay. Its log has tx ids, no IPs." |
| 5 | 1:35–2:00 | Browser vote page with Lace (`docs/LACE-TEST-STEPS.md`): Lace prove popup → success; then Vote button disabled ("already voted") | "Lace users can do the same: the wallet seals, the sponsor pays. A second vote fails inside the prover, nothing is sent." |
| 6 | 2:00–2:25 | Vote page showing 证明已过期，请重新生成 then success (or the stale-proof test run `npx vitest run src/vote/test/stale-proof.test.ts`) | "If other votes land first, the node rejects the proof as stale. The relayer returns a retryable 409, and the page re-proves and resends once." |
| 7 | 2:25–2:40 | Explorer/indexer: tally `[1, 0, 2]`; `npm test` summary 38/51/38 | "Final tally on Preview, and all test suites green." |
| 8 | 2:40–2:50 | Slide 7 (limits & next) | "Limits: the relayer can delay votes and lone votes are timing-linkable. Next: credential-gated registration." |

Notes: pre-start the proof server and relayer so waits are cut; speed up the ~70 s mixing wait 4× in editing and say so on screen.
