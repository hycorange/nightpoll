#!/usr/bin/env bash
# Local Midnight `undeployed` network WITHOUT docker: runs the binaries unpacked from the official images
#   midnightntwrk/midnight-node:0.22.3 (CFG_PRESET=dev), midnightntwrk/indexer-standalone:4.0.1,
#   midnightntwrk/proof-server:8.1.3
# (fetch first: scripts/fetch-image.sh ... / scripts/fetch-proof-server.sh, see README).
# Usage: scripts/localnet.sh start|proofs|stop|status|wipe   (proofs = proof server only, for Preview)
# Every process runs under nice 19 / ionice idle, a wall-clock timeout (LOCALNET_TTL, default 4h) and an RSS
# watchdog that kills it above LOCALNET_MAX_RSS_MB (default 2048). Ports: node 9944, indexer 8088, proofs 6300.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$ROOT/.tools"; RUN="$T/localnet"; mkdir -p "$RUN"
TTL=${LOCALNET_TTL:-4h}; MAX_MB=${LOCALNET_MAX_RSS_MB:-2048}; MIN_AVAIL_MB=${LOCALNET_MIN_AVAIL_MB:-3072}
NODE_ROOT="$T/midnight-node-0.22.3/rootfs"; IDX_ROOT="$T/indexer-standalone-4.0.1/rootfs"

avail_mb() { awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo; }
need_mem() {
  local a; a=$(avail_mb)
  if [ "$a" -lt "$MIN_AVAIL_MB" ]; then echo "MemAvailable ${a}MB < ${MIN_AVAIL_MB}MB; not starting $1 (retry later)" >&2; exit 75; fi
}
# launch NAME CWD CMD... : background, niced, time-limited, with an RSS watchdog
launch() {
  local name=$1 cwd=$2; shift 2
  if [ -f "$RUN/$name.pid" ] && kill -0 "$(cat "$RUN/$name.pid")" 2>/dev/null; then echo "$name already running"; return; fi
  need_mem "$name"
  ( cd "$cwd" && exec setsid timeout --signal=TERM --kill-after=30s "$TTL" nice -n 19 ionice -c3 "$@" ) >"$RUN/$name.log" 2>&1 &
  local pid=$!; echo $pid >"$RUN/$name.pid"
  # watchdog: sum RSS of the process group, kill it above the cap; exits when the process is gone
  ( while kill -0 $pid 2>/dev/null; do
      rss=$(ps -o rss= -g "$(ps -o pgid= -p $pid | tr -d ' ')" 2>/dev/null | awk '{s+=$1} END {print int(s/1024)}')
      if [ "${rss:-0}" -gt "$MAX_MB" ]; then echo "$(date '+%F %T') watchdog: $name RSS ${rss}MB > ${MAX_MB}MB, killing" >>"$RUN/$name.log"; kill -KILL -- -"$(ps -o pgid= -p $pid | tr -d ' ')" 2>/dev/null; fi
      sleep 3
    done ) >/dev/null 2>&1 &
  echo $! >"$RUN/$name.watchdog.pid"
  echo "started $name (pid $pid, log $RUN/$name.log)"
}
wait_http() { # NAME URL SECONDS
  for _ in $(seq "$3"); do curl -fs -o /dev/null "$2" && { echo "$1 up: $2"; return 0; }; sleep 1; done
  echo "$1 did not come up ($2); see $RUN/$1.log" >&2; return 1
}
stop_one() {
  local name=$1 f="$RUN/$1.pid"
  [ -f "$f" ] || return 0
  local pid; pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid"; for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done; kill -KILL -- -"$pid" 2>/dev/null || true; echo "stopped $name"; fi
  [ -f "$RUN/$name.watchdog.pid" ] && kill "$(cat "$RUN/$name.watchdog.pid")" 2>/dev/null || true
  rm -f "$f" "$RUN/$name.watchdog.pid"
}

case "${1:-}" in
  start)
    # 1. node: dev preset = `undeployed` chain, pre-funded genesis wallets (seed 0x..01 etc.), mocked Cardano follower
    launch node "$NODE_ROOT" env CFG_PRESET=dev BASE_PATH="$RUN/node-chain" \
      SIDECHAIN_BLOCK_BENEFICIARY=04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e \
      TRIE_CACHE_SIZE=${NODE_TRIE_CACHE:-268435456} "$NODE_ROOT/midnight-node"
    wait_http node http://127.0.0.1:9944/health 180
    # 2. indexer (standalone = sqlite)
    launch indexer "$IDX_ROOT/opt/indexer-standalone" env \
      APP__INFRA__SECRET=303132333435363738393031323334353637383930313233343536373839303132 \
      APP__INFRA__NODE__URL=ws://127.0.0.1:9944 \
      APP__INFRA__STORAGE__CNN_URL="$RUN/indexer.sqlite" APP__INFRA__LEDGER_DB__CNN_URL="$RUN/ledger-db.sqlite" \
      RUST_LOG=${INDEXER_LOG:-info} "$IDX_ROOT/usr/local/bin/indexer-standalone"
    wait_http indexer http://127.0.0.1:8088/ready 180 || true
    # 3. proof server
    launch proof-server "$ROOT" "$ROOT/scripts/proof-server.sh"
    wait_http proof-server http://127.0.0.1:6300/health 120
    ;;
  proofs) # proof server only (for Preview / Preprod, where node + indexer are remote)
    launch proof-server "$ROOT" "$ROOT/scripts/proof-server.sh"
    wait_http proof-server http://127.0.0.1:6300/health 120
    ;;
  stop) for n in proof-server indexer node; do stop_one $n; done ;;
  status) for n in node indexer proof-server; do
            if [ -f "$RUN/$n.pid" ] && kill -0 "$(cat "$RUN/$n.pid")" 2>/dev/null; then
              echo "$n: running pid $(cat "$RUN/$n.pid") rss=$(ps -o rss= -g "$(cat "$RUN/$n.pid")" | awk '{s+=$1} END {print int(s/1024)}')MB"
            else echo "$n: stopped"; fi; done ;;
  wipe) # fresh chain: also drop the CLI's cached wallet sync state + private state for `undeployed`
        "$0" stop; rm -rf "$RUN/node-chain" "$RUN"/*.sqlite* "$ROOT"/.secrets/state/wallet-undeployed-*.json.gz "$ROOT"/.secrets/state/level-undeployed ;;
  *) echo "usage: $0 start|proofs|stop|status|wipe" >&2; exit 2 ;;
esac
