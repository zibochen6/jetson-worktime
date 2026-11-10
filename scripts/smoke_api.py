"""Read-only HTTP acceptance checks; writes no work actions and needs no GPU imports."""
import argparse,json,time,urllib.request,urllib.error
from pathlib import Path

def run(base,output):
    output.mkdir(parents=True,exist_ok=True)
    checks={}
    def get(path,method='GET',body=None,headers=None):
        request=urllib.request.Request(base+path,data=body,method=method,headers=headers or {})
        try:
            with urllib.request.urlopen(request,timeout=8) as r:return r.status,dict(r.headers),r.read()
        except urllib.error.HTTPError as r:return r.code,dict(r.headers),r.read()
    def check(name,value):
        checks[name]='PASS' if value else 'FAIL'
        if not value:raise AssertionError(name)
    try:
        code,_,home=get('/')
        canonical=Path(__file__).resolve().parents[1]/'frontend/public/index.html'
        check('canonical_home_with_settings',code==200 and home==canonical.read_bytes() and b'id="settingsToggle"' in home and b'id="settingsDialog"' in home and b'id="help"' in home)
        check('pipeline_language_brand_in_actual_home', b'id="pipeline"' in home and b'data-language="en"' in home and '工时统计系统'.encode() in home)
        for locale in ('zh-CN','en'):
            code,headers,body=get('/api/frame.jpg?lang='+locale)
            check('localized_snapshot_'+locale, code==200 and headers.get('Content-Language')==locale and body[:2]==b'\xff\xd8')
        code,_,body=get('/api/frame.jpg?lang=invalid')
        check('invalid_language_400',code==400 and json.loads(body)['error']['message_key']=='error.language')
        camera=json.loads(get('/api/v1/camera')[2]);check('real_camera_online',camera['status']=='online' and camera['decoder']=='nvv4l2decoder')
        (output/'camera.json').write_text(json.dumps(camera,indent=2))
        e=json.loads(get('/api/v1/observations/latest')[2]);o=e['observation']
        check('fresh_gpu_observation',e['available'] and e['fresh'] and e['algorithm_error'] is None)
        check('lossless_timestamp',isinstance(o['frame']['receive_monotonic_ns'],str) and (o['frame']['pts_ns'] is None or isinstance(o['frame']['pts_ns'],str)))
        check('persons_keypoints',all(len(p['keypoints'])==17 and len(p['bbox_xyxy'])==4 for p in o['persons']))
        (output/'observations.json').write_text(json.dumps(e,ensure_ascii=False,indent=2))
        code,h,image=get(o['matching_frame_url']);check('exact_observation_image',code==200 and h['X-Observation-ID']==o['observation_id'] and image[:2]==b'\xff\xd8')
        (output/'matching.jpg').write_bytes(image)
        code,h,image=get('/api/v1/video.jpg');check('raw_jpeg',code==200 and h['Content-Type']=='image/jpeg' and image[:2]==b'\xff\xd8')
        (output/'raw.jpg').write_bytes(image)
        code,h,body=get('/api/v1/work/status');work=json.loads(body)
        check('versioned_work_status',code==200 and work['schema_version']=='1.0' and isinstance(work['work_seconds'],(int,float)))
        check('stable_reason_metadata', isinstance(work.get('reason_code'),str) and isinstance(work.get('reason_params'),dict) and isinstance(o['inference'].get('reason_code'),str))
        (output/'work-status.json').write_text(json.dumps(work,ensure_ascii=False,indent=2))
        check('legacy_compatibility',all(get(p)[0]==200 for p in ['/','/api/status','/api/frame.jpg','/api/work-status']))
        code,h,body=get('/api/v1/work/actions','POST',b'{"action":"invalid"}',{'Content-Type':'application/json'})
        check('invalid_action_400_without_mutation',code==400 and json.loads(body)['error']['code']=='BAD_REQUEST')
        code,h,body=get('/api/v1/work/actions','POST',b'{"action":"end"}',{'Content-Type':'application/json','Origin':'http://example.invalid'})
        check('cross_origin_write_403',code==403 and json.loads(body)['error']['code']=='ORIGIN_REJECTED')
        code,_,body=get('/api/v1/observations/frame.jpg');check('missing_id_400',code==400)
        code,_,body=get('/api/v1/observations/frame.jpg?observation_id=expired');check('unknown_frame_410',code==410 and json.loads(body)['error']['code']=='FRAME_EXPIRED')
        seq=[]
        with urllib.request.urlopen(base+'/api/v1/video.mjpg',timeout=8) as stream:
            for _ in range(3):
                line=stream.readline();check('multipart_boundary',line==b'--frame\r\n')
                headers={}
                while True:
                    line=stream.readline()
                    if line==b'\r\n':break
                    k,v=line.decode().strip().split(':',1);headers[k]=v.strip()
                seq.append((headers['X-Stream-Session-ID'],int(headers['X-Frame-Sequence'])))
                image=stream.read(int(headers['Content-Length']));assert image[:2]==b'\xff\xd8';assert stream.read(2)==b'\r\n'
        check('mjpeg_new_frames_only',len(set(seq))==3 and all(a[0]!=b[0] or b[1]>a[1] for a,b in zip(seq,seq[1:])))
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            if get(o['matching_frame_url'])[0]==410:break
            time.sleep(.25)
        else:raise AssertionError('cache eviction')
        check('bounded_cache_eviction_410',True)
        check('no_rtsp_credentials',all(b'rtsp://' not in get(p)[2] for p in ['/api/v1/camera','/api/v1/observations/latest','/api/v1/work/status']))
    except Exception:
        checks['execution']='FAIL'
        raise
    finally:
        report=dict(checks=checks,status='PASS' if checks and all(v=='PASS' for v in checks.values()) else 'FAIL',note='Real camera read-only API checks. No behavior accuracy or forced camera disconnect assessment.')
        (output/'acceptance.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8088');p.add_argument('--output',default='reports/api-v1')
    a=p.parse_args();run(a.base.rstrip('/'),Path(a.output))
