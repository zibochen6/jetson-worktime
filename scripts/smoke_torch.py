import json, torch, numpy as np
from pathlib import Path
assert torch.cuda.is_available()
x=torch.arange(16,dtype=torch.float32,device='cuda').reshape(4,4); y=x@x.T
torch.cuda.synchronize()
a=x.cpu().numpy()
assert np.isfinite(y.cpu().numpy()).all() and torch.allclose(y.cpu(),torch.from_numpy(a)@torch.from_numpy(a).T)
r={'status':'PASS','torch':torch.__version__,'cuda':torch.version.cuda,'gpu':torch.cuda.get_device_name(0),'torch_path':torch.__file__,'numpy':np.__version__,'numpy_path':np.__file__}
Path('reports').mkdir(exist_ok=True);Path('reports/torch-smoke.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
