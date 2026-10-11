#!/usr/bin/env bash
# One-shot NightPoll demo: start what's needed, run the full e2e, print the summary to paste.
#   scripts/demo.sh preview [--readme]      # Preview testnet (public node/indexer, local proof server)
#   scripts/demo.sh undeployed [--readme]   # local dev chain (scripts/localnet.sh), no faucet needed
# Resource rules: refuses to start under 3 GB MemAvailable; everything nice 19 / ionice idle, time-limited,
# 2 GB RSS watchdog (scripts/capped.sh, scripts/localnet.sh). Services started here are stopped on exit.
set -euo pipefail
NET=${1:-preview}; shift || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
source scripts/env.sh
MIN=${DEMO_MIN_AVAIL_MB:-3072}
AVAIL=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "$AVAIL" -lt "$MIN" ]; then echo "MemAvailable ${AVAIL}MB < ${MIN}MB - try again later" >&2; exit 75; fi
[ -f contract/src/managed/nightpoll/contract/index.js ] || { echo "compiling contract..."; TTL=20m scripts/capped.sh npm run -s compact; }

STARTED=0
cleanup() { [ "$STARTED" = 1 ] && scripts/localnet.sh stop || true; }
trap cleanup EXIT
case "$NET" in
  preview|preprod) curl -fs -o /dev/null http://127.0.0.1:6300/health || { scripts/localnet.sh proofs; STARTED=1; } ;;
  undeployed) curl -fs -o /dev/null http://127.0.0.1:8088/ready || { scripts/localnet.sh start; STARTED=1; } ;;
  *) echo "unknown network $NET" >&2; exit 2 ;;
esac

mkdir -p logs; LOG="logs/demo-$NET-$(date +%Y%m%d-%H%M).log"
echo "running e2e on $NET (log: $LOG) ..."
set +e
NP_NETWORK=$NET TTL=${DEMO_TTL:-3h} scripts/capped.sh npm run -s np -- e2e ${DEMO_E2E_ARGS:-} 2>&1 | tee "$LOG" | grep --line-buffered -E 'INFO|WARN|ERROR|RESULT' | grep -v RPC-CORE | cut -c1-220
RC=${PIPESTATUS[0]}
set -e
if [ "$RC" != 0 ]; then echo "e2e FAILED (exit $RC); see $LOG" >&2; exit "$RC"; fi
echo; echo "================ SUMMARY (paste into README / AKINDO) ================"
node scripts/summary.mjs "$NET" "$@"
