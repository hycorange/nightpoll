#!/usr/bin/env bash
# Rerun guide for the Preview sponsored-vote flow (Wave 3 M3/M4). This script NEVER touches Preview or
# docker: it only prints the steps and the env vars you need. Usage:
#   scripts/e2e-rerun.sh            # print steps + env check
#   scripts/e2e-rerun.sh --dry-run  # also print the exact commands that would be run, still executing nothing
#   scripts/e2e-rerun.sh --help
set -euo pipefail
DRY=0
case "${1:-}" in
  --dry-run|-n) DRY=1 ;;
  -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
  "") ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

req=(NP_NETWORK NP_RELAYER_CONTRACTS)
opt=(NP_RELAYER_SEED_FILE NP_RELAYER_ENTRYPOINTS NP_RELAYER_PORT NP_RELAYER_JITTER_MS NP_RELAYER_BATCH_MS NP_RELAYER_BATCH_MAX NP_RELAYER_TRUST_PROXY NP_RELAYER_PER_CLIENT NP_RELAYER_GLOBAL NP_RELAYER_MAX_FEE NP_RELAYER_DAILY_TX NP_RELAYER_DAILY_DUST NP_RELAYER_MIN_DUST LOG_LEVEL)
echo "== Required env (values are never printed)"
for v in "${req[@]}"; do if [ -n "${!v:-}" ]; then echo "  [set]     $v"; else echo "  [missing] $v"; fi; done
echo "  (one of NP_RELAYER_SEED_FILE or NP_RELAYER_SEED is also required on preview)"
echo "== Optional env"
for v in "${opt[@]}"; do if [ -n "${!v:-}" ]; then echo "  [set]     $v"; else echo "  [default] $v"; fi; done

cat <<'STEPS'
== Steps (run manually)
 1. export PATH=~/.local/node24/bin:$PATH; npm ci
 2. Start the proof server:            scripts/proof-server.sh      (docker)
 3. export NP_NETWORK=preview NP_RELAYER_CONTRACTS=<poll address, see docs/WAVE3-RESULTS.md>
 4. export NP_RELAYER_SEED_FILE=.secrets/preview-relayer.seed  (throwaway wallet; never commit, never echo)
 5. Start the relayer:                 npm run relayer -w @nightpoll/cli
 6. Check health:                      curl -s http://127.0.0.1:${NP_RELAYER_PORT:-8790}/health
 7. Serve the UI, switch Lace to Preview, connect, vote with "sponsored" enabled
 8. Confirm the tx id in the relayer log and on the Preview explorer; record it in docs/WAVE3-RESULTS.md
STEPS

if [ "$DRY" = 1 ]; then
  echo "== Dry run: commands that would run (nothing executed)"
  for c in "npm ci" "scripts/proof-server.sh" "npm run relayer -w @nightpoll/cli" "curl -s http://127.0.0.1:\${NP_RELAYER_PORT:-8790}/health"; do
    echo "  + $c"
  done
fi
