#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."
test "$(uname -m)" = aarch64
if [ ! -e .venv ]; then uv venv --python /usr/bin/python3.10 --system-site-packages --no-python-downloads .venv; fi
exec bash scripts/sync_env.sh
