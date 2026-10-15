#!/bin/bash
cd /workspace/nightpoll-public
say(){ echo -e "\n\033[1;36m# $*\033[0m"; sleep 2; }
say "NightPoll Wave 3 demo — LOCAL terminal recording (tests run live; Preview results REPLAYED from docs/WAVE3-RESULTS.md)"
say "Relayer config: jitter + mixing window"
echo 'NP_RELAYER_JITTER_MS=6000 NP_RELAYER_BATCH_MS=15000 NP_RELAYER_BATCH_MAX=8 npm run relayer -w @nightpoll/cli'; sleep 2
say "Mixing window + jitter + edge cases (local tests, live run)"
(cd cli && npx vitest run --reporter=verbose src/test/relayer-batch.test.ts src/test/relayer-batch-edge.test.ts src/test/relayer-privacy.test.ts 2>&1 | grep -E "✓|✗|×|Tests ")
sleep 3
say "REPLAY of live Preview rerun 2026-10-15 JST: 3 wallet-less members sent at t=0"
sed -n '/^| Step/,/^| vote retry/p' docs/WAVE3-RESULTS.md | cut -c1-150; sleep 6
say "On-chain order 1,0,2 != request order 0,1,2. Final tally [1, 0, 2]."
say "Stale proof (node error 104): relayer 409 STALE_PROOF -> UI re-proves + resends ONCE (local tests)"
(cd cli && npx vitest run --reporter=verbose src/test/relayer-stale.test.ts 2>&1 | grep -E "✓|×|Tests ")
(cd ui && npx vitest run --reporter=verbose src/vote/test/stale-proof.test.ts 2>&1 | grep -E "✓|×|Tests ")
sleep 3
say "All suites"
for p in contract cli ui; do echo "== $p"; (cd $p && npx vitest run 2>&1 | grep -E "Tests "); done
sleep 2
say "Limits: relayer can delay/censor (not forge/read); lone votes timing-linkable; ~20 s/tx serialized."
sleep 3
