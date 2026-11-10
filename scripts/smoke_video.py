import sys, json, cv2
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from jetson_worktime.video import VideoReader
from jetson_worktime.settings import SettingsStore
from jetson_worktime.media import write_image
store=SettingsStore(Path(__file__).resolve().parents[1]/'configs/behavior.yaml')
count=0
with VideoReader(sys.argv[1]) as reader:
    while True:
        result=reader.read()
        if result is None: break
        frame, pts, received = result
        assert frame.ndim==3 and frame.shape[2]==3
        if count==0:
            write_image('outputs/decoded.png',frame,store)
            first={'shape':list(frame.shape),'pts_ns':pts,'receive_monotonic_ns':received}
        count += 1
assert count > 0
report={'status':'PASS','decoder':'nvv4l2decoder','frames':count,'first':first}
Path('reports').mkdir(exist_ok=True)
Path('reports/video-smoke.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
