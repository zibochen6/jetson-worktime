#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."
test "$(uname -m)" = aarch64
test -x .venv/bin/python
test -f uv.lock
test -f vendor/wheels/SHA256SUMS
.venv/bin/python - <<'PY'
import re,sys
from pathlib import Path
assert sys.version_info[:2]==(3,10) and sys.base_prefix=='/usr'
assert 'include-system-site-packages = true' in Path('.venv/pyvenv.cfg').read_text().lower()
s=Path('uv.lock').read_text()
for name,version in [('torch','2.7.0'),('torchvision','0.22.0')]:
 block=next(b for b in s.split('[[package]]') if re.search(r'^name = "'+name+r'"$',b,re.M))
 assert f'version = "{version}"' in block
 assert f'source = {{ path = "vendor/wheels/{name}-{version}-cp310-cp310-linux_aarch64.whl" }}' in block
PY
(cd vendor/wheels && sha256sum --check SHA256SUMS)
uv lock --check
plan=$(uv sync --locked --dry-run 2>&1)
printf '%s\n' "$plan"
if printf '%s\n' "$plan" | grep -E '^ *- (torch|torchvision)=='; then
  echo 'Refusing to replace installed GPU packages' >&2; exit 1
fi
uv sync --locked
.venv/bin/python scripts/smoke_gpu.py
