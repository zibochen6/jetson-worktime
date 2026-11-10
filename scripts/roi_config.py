"""Configure raw-image pixel polygons, retaining explicit calibration state."""
import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import cv2,yaml
from jetson_worktime.roi import observe_and_draw
from jetson_worktime.settings import SettingsStore
from jetson_worktime.media import protect_frame
ap=argparse.ArgumentParser();ap.add_argument('--image',required=True);ap.add_argument('--output',required=True);ap.add_argument('--region',action='append',default=[],help='station=10,20;100,20;100,90');ap.add_argument('--confirm-calibrated',action='store_true');args=ap.parse_args()
image=cv2.imread(args.image)
if image is None:raise SystemExit('image cannot be read')
regions={}
for entry in args.region:
 name,points=entry.split('=',1)
 if name not in ('station','operation','infeed','outfeed'):raise SystemExit('unsupported region name')
 polygon=[[int(n) for n in pair.split(',')] for pair in points.split(';')]
 if len(polygon)<3 or any(len(p)!=2 or not (0<=p[0]<image.shape[1] and 0<=p[1]<image.shape[0]) for p in polygon):raise SystemExit('invalid polygon')
 regions[name]=polygon
roi={'coordinate_system':'original_image_pixels','image_size':[image.shape[1],image.shape[0]],'calibrated':args.confirm_calibrated,'regions':regions}
path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(yaml.safe_dump({'roi':roi},sort_keys=False))
with SettingsStore(Path(__file__).resolve().parents[1]/'configs/behavior.yaml').output_policy() as policy:
 image=protect_frame(image,None,policy,reliable=False)
 cv2.imwrite(str(path.with_suffix('.jpg')),observe_and_draw(image,[],roi))
