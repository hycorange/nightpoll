# NightPoll vote relayer

Pays the DUST fee for members' already-proven, bound `vote` / `register` txs. See `docs/WAVE3-PLAN.md`.

## Spend limits (M5 hardening, chunk 1)

Checked in this order before any DUST is spent: policy (allowlist, circuit, shape, size) → max fee → daily
per-contract cap → per-client-IP rate limit → DUST floor. All configurable by env; unset means the safe default.
DUST amounts are in specks (the wallet's smallest DUST unit).

| Limit | Env | Default | Rejection |
|---|---|---|---|
| Contract allowlist | `NP_RELAYER_CONTRACTS` (required) | none; the Wave 2 demo poll is always refused | 403 |
| Circuits | `NP_RELAYER_ENTRYPOINTS` | `vote,register` | 403 |
| Requests per client IP per window | `NP_RELAYER_PER_CLIENT` | 3 | 429 |
| Requests per window (all clients) | `NP_RELAYER_GLOBAL` | 60 | 429 |
| Window length | `NP_RELAYER_WINDOW_MS` | 600000 (10 min) | |
| Max estimated fee per tx | `NP_RELAYER_MAX_FEE` | 10^18 | 403 |
| Sponsored txs per contract per UTC day | `NP_RELAYER_DAILY_TX` | 500 | 429 |
| Estimated DUST fees per contract per UTC day | `NP_RELAYER_DAILY_DUST` | 5×10^19 | 429 |
| DUST floor: refuse sponsorship below | `NP_RELAYER_MIN_DUST` | 10^18 | 503 |
| `/health` reports `degraded` below | `NP_RELAYER_WARN_DUST` | 2 × floor | |

Notes:
- The fee is estimated from the user's bound tx with `LedgerParameters.initialParameters()`. The sponsor's own
  DUST spend adds a little on top, so treat the caps as approximate. The defaults are guesses. Tune them against measured Preview fees.
- Daily counters are in memory and reset on restart and at 00:00 UTC. A budget slot is reserved before
  submission, and failed submissions still count toward it (conservative).
- Unit tests: `cli/src/test/relayer-limits.test.ts`.

## Privacy: no-IP logging and submission jitter (M5 hardening, chunk 2)

**No-IP logging policy.** Relayer logs must never contain client IP addresses.
- Every log line goes through `safeLog` (`privacy.ts`), which replaces anything that looks like an IPv4 or IPv6 address (including `::ffff:` mapped addresses) with `[ip]`. This also covers IPs inside error messages.
- The rate limiter keys on a salted SHA-256 hash of the client IP. The salt is random per process and is never logged or saved, so the keys can't be reversed or linked across restarts. Keys only live in memory.
- The server binds to `127.0.0.1`. If you put a reverse proxy in front, turn off its access logs or strip IPs from them too (see below).

**Submission jitter.** `NP_RELAYER_JITTER_MS` (default `0`, which means off) adds a random delay between 0 and N ms before each submission. This weakens the link between an HTTP request's timing and when the tx shows up on chain. Submissions stay serialized, so jitter also adds to queue latency. Keep it well below client timeouts.

**Behind a reverse proxy (nginx / Caddy).** Two things change when the relayer sits behind a proxy:
- *Logs.* The proxy, not the relayer, now sees client IPs. Turn its access log off for the relayer route (nginx `access_log off;`, Caddy: no `log` directive on that site) or log a fixed placeholder instead of `$remote_addr`. Error logs can also include client IPs; set them to `crit` or send them to `/dev/null` on this route.
- *Rate limits.* Every request now arrives from the proxy's address, so the per-client limit would turn into one shared bucket. Set `NP_RELAYER_TRUST_PROXY=1` and the relayer keys on the right-most `X-Forwarded-For` hop, which is the one your own proxy appended (hops further left are client-controlled and are ignored). The hop is hashed with the per-process salt and is never logged. Only turn this on when the relayer can be reached solely through that proxy; otherwise a client could send its own header. With it off (the default), the global per-window cap and daily caps still apply.

## Batching: mixing window (M5 hardening, chunk 3)

Merging several members' votes into one ledger transaction is not possible: ledger-v8 `Transaction.merge` throws when both transactions have contract interactions, and every vote is a contract call. So the relayer batches at the submission level instead.
- `NP_RELAYER_BATCH_MS` (default `0`, which means off) holds accepted votes for up to N ms, then submits them in random order (Fisher-Yates shuffle, `batch.ts`). `NP_RELAYER_BATCH_MAX` (default `8`) flushes the window early once that many are waiting.
- Each vote is still its own transaction, and submissions stay one at a time, so the sponsor never double-spends DUST. Jitter, if set, still applies before each submission.
- Each HTTP caller waits until its own vote is submitted and gets its own tx id back, so keep `BATCH_MS + BATCH_MAX x (proof submit time + JITTER_MS)` well below the UI's request timeout.
- What it buys: an observer can no longer match "request k" to "tx k" by order within a window. What it doesn't: with very few voters per window, timing still leaks. Policy, rate limits, and caps are all checked before a vote enters the window.

Unit tests: `cli/src/test/relayer-privacy.test.ts`, `cli/src/test/relayer-batch.test.ts`. Rerun guide for the Preview flow: `scripts/e2e-rerun.sh --dry-run`.
