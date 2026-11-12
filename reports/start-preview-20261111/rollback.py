"""Hash-protected source rollback. Defaults to a read-only check."""
from pathlib import Path
import argparse,json,hashlib,shutil,os,signal,time,subprocess
r=Path(__file__).resolve().parent;root=Path('/home/seeed/workspace/jetson-worktime')
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--check',action='store_true');args=p.parse_args()
m=json.loads((r/'release-manifest.json').read_text())['files']
def verify():
 for n,d in m.items():
  f=root/n
  if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest()!=d['after']:
   raise SystemExit('Refusing rollback over later edits: '+n)
verify()
if not args.apply:print('PASS: rollback is available; use --apply to stop, restore and restart');raise SystemExit(0)
for proc in Path('/proc').iterdir():
 if not proc.name.isdigit():continue
 try:
  command=(proc/'cmdline').read_bytes().split(b'\0')
  if (proc/'cwd').resolve()!=root or not any(a.endswith(b'scripts/preview.py') for a in command):continue
  os.kill(int(proc.name),signal.SIGTERM)
  for _ in range(120):
   if not proc.exists() or (proc/'stat').read_text().split()[2]=='Z':break
   time.sleep(.1)
  else:raise SystemExit('Service did not stop; no source restored')
 except (PermissionError,FileNotFoundError,ProcessLookupError):continue
verify()
for n,d in m.items():
 f=root/n;old=r/'release-before'/n
 if old.exists():shutil.copy2(old,f)
 else:f.unlink()
subprocess.run([str(root/'start.sh')],cwd=root,check=True)
print('Rollback completed')
