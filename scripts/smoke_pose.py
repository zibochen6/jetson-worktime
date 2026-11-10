import collections, json, subprocess, sys
from pathlib import Path
subprocess.run([sys.executable,'scripts/run.py','--config','configs/smoke.yaml'],check=True)
rows=[json.loads(line) for line in Path('outputs/observations.jsonl').read_text().splitlines()]
counts=collections.Counter()
for row in rows:
 for person in row['persons']:
  assert len(person['keypoints'])==17
  assert person['bbox_xyxy'][2]>person['bbox_xyxy'][0]
  assert person['bbox_xyxy'][3]>person['bbox_xyxy'][1]
  for p in person['keypoints']:
   assert p['confidence'] is None or 0<=p['confidence']<=1
   assert (p['x'] is None)==(p['y'] is None)
  counts[person['person_track_id']]+=1
assert rows and counts and max(counts.values())>=2, 'no persistent person track'
assert Path('outputs/annotated.jpg').is_file() and Path('outputs/annotated.mp4').stat().st_size>0
report={'status':'PASS','frames':len(rows),'track_counts':dict(counts),'scope':'static image encoded into consecutive frames; ID persistence only'}
Path('reports/pose-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
