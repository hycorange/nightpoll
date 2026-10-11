#!/usr/bin/env bash
# Download midnightntwrk/proof-server:8.1.3 (linux/amd64) from Docker Hub without docker,
# verify the layer digest, and unpack the nix store under .tools/.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools/proof-server-8.1.3"
R=midnightntwrk/proof-server
MANIFEST=sha256:97143a11c72d1b4a1878ca929e43317332bf4c09808dfa735e9ef96ee7c2fe18   # 8.1.3 linux/amd64
LAYER=sha256:ef43e72cac7aec8e040a64640641f89418cb169c5940d3d42eea3e6180b4ff33
mkdir -p "$DIR/rootfs" && cd "$DIR"
T=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$R:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -sL -H "Authorization: Bearer $T" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  "https://registry-1.docker.io/v2/$R/manifests/$MANIFEST" -o m.json
curl -sL -H "Authorization: Bearer $T" "https://registry-1.docker.io/v2/$R/blobs/$LAYER" -o layer.tgz
echo "${LAYER#sha256:}  layer.tgz" | sha256sum -c -
tar -xzf layer.tgz -C rootfs --delay-directory-restore --no-same-permissions --wildcards 'nix/*'
chmod -R u+w rootfs
