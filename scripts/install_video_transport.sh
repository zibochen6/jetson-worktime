#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -m)" == aarch64 ]] || { echo 'This installer requires Linux ARM64.' >&2; exit 1; }
sudo apt-get install -y gstreamer1.0-rtsp
version=1.21.3
archive="mediamtx_v${version}_linux_arm64.tar.gz"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
curl --fail --location --retry 3 --connect-timeout 20 --max-time 900 \
  "https://github.com/bluenviron/mediamtx/releases/download/v${version}/${archive}" -o "$work_dir/$archive"
(cd "$work_dir" && printf '%s  %s\n' \
  27f038237cb5f77a724f6afc58eca2798f2bc4edf9989895631a80eeb41a4fe2 "$archive" | sha256sum -c -)
mkdir -p "$root/vendor/mediamtx"
tar xzf "$work_dir/$archive" -C "$root/vendor/mediamtx"
printf '%s\n' 'MediaMTX v1.21.3, SHA256 27f038237cb5f77a724f6afc58eca2798f2bc4edf9989895631a80eeb41a4fe2' > "$root/vendor/mediamtx/installation.txt"
"$root/vendor/mediamtx/mediamtx" --version
