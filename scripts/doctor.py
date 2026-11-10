import os
os.environ['YOLO_AUTOINSTALL']='False'
import json, sys, platform, importlib
result={'python':sys.executable,'python_version':sys.version,'machine':platform.machine(),'modules':{}}
for name in ('torch','torchvision','numpy','cv2','gi','tensorrt','ultralytics'):
    try:
        m=importlib.import_module(name); result['modules'][name]={'version':getattr(m,'__version__',None),'path':getattr(m,'__file__',None)}
    except Exception as e: result['modules'][name]={'error':str(e)}
print(json.dumps(result,indent=2))
