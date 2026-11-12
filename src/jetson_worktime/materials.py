"""Time-based, conservative product counting, independent of human identity."""
from copy import deepcopy
import math
import re
import time
from .studio_store import StudioError, uid

MATERIAL_DEFAULTS = dict(enabled=False, class_id=0, confidence=.25, stable_seconds=1.,
    missing_seconds=2., sample_hz=2., configured=False, regions={'pending':[], 'completed':[]},
    display={'pending':True, 'completed':True},
    colors={'pending':'#fbbf24', 'completed':'#38bdf8'}, opacity={'pending':.12,'completed':.12})
MODEL_DEFAULTS = {'person':'builtin-person', 'material':None}


def number(value, low, high):
    return isinstance(value, (float,int)) and not isinstance(value,bool) and math.isfinite(value) and low <= value <= high


def material_behavior_changed(old,new):
    keys=('enabled','class_id','confidence','stable_seconds','missing_seconds','sample_hz','configured','regions')
    return any(old.get(k)!=new.get(k) for k in keys)


def validate_materials(value, image_size):
    from .settings import validate_polygon, polygons_intersect
    if not isinstance(value,dict) or set(value) != set(MATERIAL_DEFAULTS):
        raise StudioError('materialsInvalid')
    if any(type(value[k]) is not bool for k in ('enabled','configured')) or type(value['class_id']) is not int or not 0 <= value['class_id'] <= 999:
        raise StudioError('materialsInvalid')
    for key, low, high in [('confidence',.01,1),('stable_seconds',.1,60),('missing_seconds',.1,60),('sample_hz',.2,10)]:
        if not number(value[key],low,high):
            raise StudioError('materialsInvalid')
    for key in ('regions','display','colors','opacity'):
        if not isinstance(value[key],dict) or set(value[key]) != {'pending','completed'}:
            raise StudioError('materialsInvalid')
    for region in ('pending','completed'):
        if type(value['display'][region]) is not bool or not re.fullmatch('#[0-9a-fA-F]{6}',str(value['colors'][region])) or not number(value['opacity'][region],0,1):
            raise StudioError('materialsInvalid')
        if value['configured']:
            validate_polygon(value['regions'][region],image_size,region)
        elif value['regions'][region]:
            validate_polygon(value['regions'][region],image_size,region)
    if value['configured'] and polygons_intersect(*value['regions'].values()):
        raise StudioError('materialsOverlap')
    if value['enabled'] and not value['configured']:
        raise StudioError('materialsRoi')
    return deepcopy(value)


class MaterialCounter:
    def __init__(self, store):
        self.store = store
        self.reset()

    def reset(self):
        self.tracks = {}
        self.last_time = None
        self.session_id = None
        self.initialized = False
        self.departed = False
        self.counts = {'pending':0, 'completed':0}
        self.last_meta = {}

    def _session(self, session_id):
        if self.session_id != session_id:
            self.session_id = session_id
            self.initialized = False
            self.departed = False
            for track in self.tracks.values():
                track['counted'] = False
                track['reviewed'] = False

    def observe(self, detections, t, config, session_id=None, **meta):
        from .behavior import iou, point_in_polygon
        if self.last_time is not None and t <= self.last_time:
            return
        self._session(session_id)
        material = config['materials']
        # Lost tracks are retired in seconds, not nominal video frames.
        for key in list(self.tracks):
            tr = self.tracks[key]
            if t-tr['last_seen'] > material['missing_seconds']:
                if tr['counted'] or tr['reviewed']:
                    self.departed = True
                del self.tracks[key]
        used = set()
        for det in sorted(detections,key=lambda d:d['confidence'],reverse=True):
            if det.get('class_id') != material['class_id'] or det['confidence'] < material['confidence']:
                continue
            box = det['bbox_xyxy']
            center = [(box[0]+box[2])/2,(box[1]+box[3])/2]
            region = next((r for r,p in material['regions'].items() if point_in_polygon(center,p)),None)
            candidates = [(iou(box,tr['bbox']),key) for key,tr in self.tracks.items() if key not in used]
            best = max(candidates,default=(0,None))
            key = best[1] if best[0] >= .25 else uid()
            tr = self.tracks.setdefault(key, dict(bbox=box, region=region, since=t,last_seen=t,stable=False,counted=False,reviewed=False,pending_confirmed=False,observations=0))
            if tr['region'] != region:
                tr.update(region=region,since=t,stable=False,observations=0)
            tr.update(bbox=box,last_seen=t,observations=tr['observations']+1)
            tr['stable'] = tr['observations'] >= 2 and t-tr['since'] >= material['stable_seconds']
            if tr['stable'] and region=='pending': tr['pending_confirmed']=True
            used.add(key)
        if any((tr['counted'] or tr['reviewed']) and tr['last_seen']<t for tr in self.tracks.values()):
            self.departed=True
        self.last_time, self.last_meta = t, dict(config_revision=config['revision'], **meta)
        self.counts = {r:sum(tr['stable'] and tr['region']==r for tr in self.tracks.values()) for r in ('pending','completed')}
        if not session_id:
            return
        if not self.initialized:
            # Do not treat an unsettled first observation as zero initial inventory.
            if any(tr['region']=='completed' and not tr['stable'] for tr in self.tracks.values()):
                return
            if not self.tracks and t-self.last_meta.get('session_started',t) < material['stable_seconds']:
                return
            initial = [key for key,tr in self.tracks.items() if tr['region']=='completed' and tr['stable']]
            self.store.event(session_id,'initial','initial',len(initial),tracks=initial,**self.last_meta)
            for key in initial:
                self.tracks[key]['counted'] = True
            self.initialized = True
        for key,tr in self.tracks.items():
            if tr['stable'] and tr['region']=='completed' and not tr['counted'] and not tr['reviewed']:
                if self.departed and not tr['pending_confirmed']:
                    self.store.event(session_id,'review',key,0,track_id=key,**self.last_meta)
                    tr['reviewed'] = True
                else:
                    self.store.event(session_id,'completed',key,1,track_id=key,**self.last_meta)
                    tr['counted'] = True

    def snapshot(self, now, config, available=True, session_id=None):
        mat = config['materials']
        fresh = (available and mat['enabled'] and mat['configured'] and self.last_time is not None
                 and now-self.last_time <= max(2.,3/mat['sample_hz'])
                 and self.last_meta.get('config_revision') == config['revision'])
        events = self.store.events(session_id) if session_id else []
        resolved = {e.get('event_id') for e in events if e['kind']=='resolution'}
        return dict(enabled=mat['enabled'], available=bool(fresh), initialized=self.initialized,
                    pending=self.counts['pending'] if fresh else None, completed=self.counts['completed'] if fresh else None,
                    cumulative=sum(e['delta'] for e in events), session_id=session_id,
                    age_ms=max(0,(now-self.last_time)*1000) if self.last_time is not None else None,
                    reviews=[e for e in events if e['kind']=='review' and e['id'] not in resolved], **self.last_meta)

    def adjust(self, session_id, request):
        reason = request.get('reason','').strip()
        delta = request.get('delta')
        if not reason or len(reason)>500 or type(delta) is not int:
            raise StudioError('adjustment')
        def apply(db):
            events=self.store.events(session_id,db)
            if not events:
                raise StudioError('notFound',404)
            if request.get('expected_total') != sum(e['delta'] for e in events):
                raise StudioError('conflict',409)
            event_id=request.get('event_id')
            if event_id:
                if not any(e['id']==event_id and e['kind']=='review' for e in events) or any(e.get('event_id')==event_id and e['kind']=='resolution' for e in events):
                    raise StudioError('conflict',409)
                if delta not in (0,1): raise StudioError('adjustment')
            total=sum(e['delta'] for e in events)+delta
            if total<0: raise StudioError('adjustment')
            result=self.store.event(session_id,'resolution' if event_id else 'adjustment',request['token'],delta,db,
                reason=reason,event_id=event_id,before=total-delta,after=total)
            return dict(event=result,cumulative=total)
        return self.store.operation('adjust:'+session_id,request.get('token'),apply)
