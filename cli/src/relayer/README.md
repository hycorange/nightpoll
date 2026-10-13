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
