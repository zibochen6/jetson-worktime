"""Replay recorded algorithm observations without sleeping; never substitutes for accuracy validation."""
import argparse,json,sys,yaml
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from jetson_worktime.behavior import SessionEngine,classify
ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--config',default='configs/behavior.yaml');ap.add_argument('--output',required=True);args=ap.parse_args()
cfg=yaml.safe_load(Path(args.config).read_text());engine=SessionEngine(cfg);out=Path(args.output)
if out.exists():raise SystemExit('output already exists')
out.parent.mkdir(parents=True,exist_ok=True)
with out.open('w') as f:
 for line in Path(args.input).open():
  r=json.loads(line);t=r['receive_monotonic_ns']/1e9;behavior,reason,_=classify(r['persons'],r['width'],r['height'],cfg)
  engine.observe(t,behavior,r['session_id'],reason=reason)
  f.write(json.dumps({'frame_ref':r.get('receive_sequence'),'status':engine.snapshot(t)},ensure_ascii=False)+'\n')
print(json.dumps(engine.snapshot(engine.last_obs),ensure_ascii=False))
