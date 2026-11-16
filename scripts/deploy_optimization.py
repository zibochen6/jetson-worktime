"""Install a validated single-station release without replacing history or PT fallback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--workspace',type=Path,required=True)
    ap.add_argument('--production',type=Path,required=True);ap.add_argument('--backup',type=Path,required=True)
    ap.add_argument('--benchmark',default='benchmark-after/report.json')
    args=ap.parse_args();work=args.workspace;prod=args.production;source=work/'source'
    if not (args.backup/'code-config.tar.gz').is_file() or not (args.backup/'worktime.sqlite').is_file():raise RuntimeError('Missing rollback backup')
    selection=json.loads((work/'selection.json').read_text())
    if not selection.get('test_evaluated'):raise RuntimeError('Candidate evaluation incomplete')
    benchmark=json.loads((work/args.benchmark).read_text())
    if (benchmark['errors'] or benchmark['evidence_error'] or benchmark['video']['error']
            or benchmark['completed_events']!=0 or benchmark['production_total']!=0
            or benchmark['initial_inventory']!=benchmark['expected_initial_inventory']
            or benchmark['measured_seconds']<60):raise RuntimeError('Backend benchmark failed')
    caches=[]
    for path in (work/'acceleration').glob('*.json'):
        manifest=json.loads(path.read_text());engine=path.parent/manifest['engine']
        if not manifest['validated'] or hashlib.sha256(engine.read_bytes()).hexdigest()!=manifest['engine_sha256']:raise RuntimeError('Invalid engine cache')
        caches.append((path,engine))
    if len(caches)<2:raise RuntimeError('Both model caches are required')
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():continue
        try:
            cwd=(entry/'cwd').resolve();cmd=(entry/'cmdline').read_bytes().split(b'\0')
            if any(arg and (cwd/os.fsdecode(arg)).resolve()==prod/'scripts/preview.py' for arg in cmd[1:]):raise RuntimeError('Stop the production preview before deployment')
        except OSError:pass
    # Install source only. Original datasets, weights and event history stay in place.
    for folder in ('src','scripts','frontend','docs','tests'):
        shutil.copytree(source/folder,prod/folder,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    sys.path.insert(0,str(prod/'src'))
    from jetson_worktime.behavior_service import BehaviorService
    from jetson_worktime.studio_store import atomic
    service=BehaviorService(prod,start_workers=False)
    try:
        previous=service.settings()
        atomic(args.backup/'pre-deploy-settings.json',json.dumps(previous,indent=2).encode())
        model=service.studio.import_model(selection['model'],'material','YOLO11n '+selection['selected']+' grouped-v2',source='trained')
        cache=prod/'data/acceleration';cache.mkdir(parents=True,exist_ok=True)
        for path,engine in caches:
            atomic(cache/engine.name,engine.read_bytes());atomic(cache/path.name,path.read_bytes())
        cfg=service.config;materials={**cfg['materials'],'binding':{'model_id':model['id'],'sha256':model['sha256']},
            'inference_region':'workbench' if selection['selected']=='crop' else 'full','production_policy':'verified',
            'confidence':selection['confidence'],'confidence_by_class':selection.get('confidence_by_class',{}),'show_confidence':False}
        result=service.apply_settings({'expected_revision':cfg['revision'],'models':{**cfg['models'],'material':model['id']},
            'materials':materials,'display':{**cfg['display'],'keypoints':False}}, {})
        report=dict(model_id=model['id'],model_sha256=model['sha256'],previous_model=previous['models']['material'],
            previous_revision=previous['revision'],revision=result['revision'],production=str(prod),backup=str(args.backup),
            inference_region=materials['inference_region'],confidence=materials['confidence'],
            confidence_by_class=materials['confidence_by_class'],benchmark=args.benchmark,field_validated=False)
        atomic(work/'deployment.json',json.dumps(report,indent=2).encode());print(json.dumps(report),flush=True)
    finally:service.close()


if __name__=='__main__':main()
