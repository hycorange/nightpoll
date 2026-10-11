#!/usr/bin/env bash
# Run the official midnightntwrk/proof-server:8.1.3 binary without docker.
# The image layer (verified by sha256 digest from Docker Hub) is unpacked under .tools/.
# Fetch it with scripts/fetch-proof-server.sh first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)/.tools/proof-server-8.1.3/rootfs/nix/store"
G="$ROOT/jms7zxzm7w1whczwny5m3gkgdjghmi2r-glibc-2.42-51/lib"
LP="$G:$ROOT/vpxblivamvic1p5r5zny934jvg33m50r-xgcc-15.2.0-libgcc/lib"
BIN="$ROOT/wxmbyzmaji4a0yf3bpn856av5gzc8zas-ledger-8.1.3/bin/midnight-proof-server"
exec nice -n 15 "$G/ld-linux-x86-64.so.2" --library-path "$LP" "$BIN" --num-workers "${NUM_WORKERS:-1}" "$@"
