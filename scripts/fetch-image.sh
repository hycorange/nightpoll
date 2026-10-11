#!/usr/bin/env bash
# Pull a linux/amd64 image from Docker Hub WITHOUT docker and unpack its rootfs under .tools/<name>/rootfs.
# The manifest is fetched by pinned digest and verified; every layer blob is sha256-verified before unpacking.
# Usage: scripts/fetch-image.sh <repo> <amd64-manifest-digest> <dest-name>
set -euo pipefail
R=$1; MANIFEST=$2; NAME=$3
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools/$NAME"
rm -rf "$DIR/rootfs"; mkdir -p "$DIR/rootfs" "$DIR/blobs" && cd "$DIR"
tok() { curl -fs "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$R:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"; }
T=$(tok)
curl -fsL -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
  "https://registry-1.docker.io/v2/$R/manifests/$MANIFEST" -o manifest.json
echo "${MANIFEST#sha256:}  manifest.json" | sha256sum -c -
CFG=$(python3 -c "import json;print(json.load(open('manifest.json'))['config']['digest'])")
curl -fsL -H "Authorization: Bearer $T" "https://registry-1.docker.io/v2/$R/blobs/$CFG" -o config.json
echo "${CFG#sha256:}  config.json" | sha256sum -c -
for L in $(python3 -c "import json;[print(l['digest']) for l in json.load(open('manifest.json'))['layers']]"); do
  F="blobs/${L#sha256:}"
  if [ ! -f "$F" ] || ! echo "${L#sha256:}  $F" | sha256sum -c - >/dev/null 2>&1; then
    T=$(tok); curl -fsL -H "Authorization: Bearer $T" "https://registry-1.docker.io/v2/$R/blobs/$L" -o "$F"
  fi
  echo "${L#sha256:}  $F" | sha256sum -c -
  # unpack in order; skip device nodes, ignore ownership; whiteouts are irrelevant for running one binary
  tar -xzf "$F" -C rootfs --no-same-owner --delay-directory-restore --anchored --exclude='dev/*' --no-anchored --exclude='.wh.*'
  chmod -R u+rwX rootfs   # later layers must be able to overwrite files from earlier ones
done
python3 -c "import json;c=json.load(open('config.json'))['config'];print('Entrypoint',c.get('Entrypoint'),'Cmd',c.get('Cmd'),'Env',c.get('Env'),'WorkingDir',c.get('WorkingDir'))"
