"""Refresh portable contract copies after changing the canonical docs."""
from pathlib import Path
from shutil import copyfile
root=Path(__file__).resolve().parents[1]
for name in ('api-v1.md','openapi-v1.json'):
    copyfile(root/'docs'/name,root/'frontend/contracts'/name)
print('Frontend contract copies refreshed; update api.ts and run frontend tests for field changes.')
