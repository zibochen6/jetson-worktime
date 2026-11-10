"""Deterministic behavior/session timing. All time arguments are monotonic seconds."""
import math,uuid
from .detection import DETECTION_DEFAULTS, detection_settings
from .localization import reason as reason_text, reason_fields, LocalizedError
DEFAULTS=dict(start_seconds=10,short_away_seconds=60,stop_absent_seconds=300,missing_grace_seconds=3,max_observation_age=1.5,dedup_iou=.4,dedup_distance=.03,**DETECTION_DEFAULTS)
class SessionEngine:
 def __init__(self,config=None):
  self.cfg={**DEFAULTS,**(config or {})};self.current=None;self.completed=[];self.events=[];self.cursor=None;self.last_obs=None;self.stream=None;self.raw='UNKNOWN';self.seat_since=None;self.away_since=None;self.absent_since=None;self.missing_since=None;self.reason=reason_text('reason.waiting');self.mode='UNKNOWN';self.manual_hold=False
 def event(self,kind,t,**data):self.events.append(dict(event=kind,monotonic_seconds=t,config_revision=self.cfg.get('revision',0),detection=detection_settings(self.cfg),**data))
 def _segment(self,a,b,kind):
  if self.current and b>a:
   segments=self.current['segments']
   if segments and segments[-1]['kind']==kind and abs(segments[-1]['end']-a)<1e-6:segments[-1]['end']=b
   else:segments.append(dict(start=a,end=b,kind=kind))
 def _advance(self,t):
  if self.cursor is None:self.cursor=t;return
  if t<self.cursor:return
  if self.current:
   if self.raw=='SEATED':kind='work'
   elif self.raw in ('NEARBY','ABSENT'):
    kind='rest' if self.away_since is not None and t-self.away_since>self.cfg['short_away_seconds'] else 'pending'
   else:kind='unknown'
   self._segment(self.cursor,t,kind)
   if self.away_since is not None and t-self.away_since>self.cfg['short_away_seconds']:self._relabel(self.away_since,('pending',),'rest')
  self.cursor=t
 def _relabel(self,start,kinds,to):
  if not self.current:return
  for seg in self.current['segments']:
   if seg['start']>=start-1e-6 and seg['kind'] in kinds:seg['kind']=to
 def _start(self,t,manual=False):
  self.current=dict(session_id=uuid.uuid4().hex,start=t,end=None,segments=[],manual=manual,review=False,config_revision=self.cfg.get('revision',0),detection=detection_settings(self.cfg))
  self.event('session_start',t,session_id=self.current['session_id'],manual=manual)
 def _finish(self,t,reason):
  if not self.current:return
  s=self.current;s['end']=max(s['start'],t);s['end_reason']=reason
  s['segments']=[{**x,'end':min(x['end'],s['end'])} for x in s['segments'] if x['start']<s['end']]
  self.completed.append(s);self.event('session_end',s['end'],session_id=s['session_id'],reason=reason,summary=self.totals(s),intervals=s['segments']);self.current=None;self.seat_since=None;self.away_since=None;self.absent_since=None
 def observe(self,t,label,stream='default',now=None,reason=''):
  now=t if now is None else now
  if now-t>self.cfg['max_observation_age']:self.tick(now);return False
  if self.last_obs is not None and t<=self.last_obs:return False
  if self.stream is not None and stream!=self.stream:
   self._advance(self.last_obs);self._finish(self.last_obs,'stream_interrupted');self.raw='UNKNOWN';self.seat_since=None;self.missing_since=None
  if self.last_obs is not None and t-self.last_obs>self.cfg['max_observation_age']:
   self._advance(self.last_obs+self.cfg['max_observation_age']);self.raw='UNKNOWN';self.seat_since=None;self.missing_since=None
  self._advance(t);self.last_obs=t;self.stream=stream;self.reason=reason
  if label=='MISSING':
   if self.missing_since is None:self.missing_since=t;self.missing_previous=self.raw
   if t-self.missing_since<self.cfg['missing_grace_seconds']:label='UNKNOWN'
   else:
    label='ABSENT'
    if self.away_since is None:self.away_since=self.missing_since;self._relabel(self.missing_since,('unknown',),'pending')
    if self.absent_since is None:self.absent_since=self.missing_since
  else:
   if self.missing_since is not None and label=='SEATED' and t-self.missing_since<=self.cfg['missing_grace_seconds'] and self.missing_previous=='SEATED':self._relabel(self.missing_since,('unknown',),'work')
   self.missing_since=None
  if label=='SEATED':
   if self.current:
    if self.away_since is not None and t-self.away_since<=self.cfg['short_away_seconds']:self._relabel(self.away_since,('pending',),'work')
    self.away_since=None;self.absent_since=None
   else:
    if self.manual_hold:self.raw=label;return True
    if self.seat_since is None:self.seat_since=t
    if t-self.seat_since>=self.cfg['start_seconds']:
     self._start(self.seat_since);self._segment(self.seat_since,t,'work')
  elif label in ('NEARBY','ABSENT'):
   self.seat_since=None;self.manual_hold=False
   if self.current and self.away_since is None:self.away_since=t
   if label=='ABSENT':
    if self.absent_since is None:self.absent_since=t
    if self.current and t-self.absent_since>=self.cfg['stop_absent_seconds']:self._finish(self.absent_since,'long_not_observed')
   else:self.absent_since=None
  else:
   self.seat_since=None
   # Ambiguous data must not advance an existing absence/short-break deadline.
   self.absent_since=None
   if self.away_since is not None:self._relabel(self.away_since,('pending',),'unknown');self.away_since=None
  self.raw=label;return True
 def tick(self,now):
  if self.last_obs is None or now-self.last_obs>self.cfg['max_observation_age']:
   if self.last_obs is not None:self._advance(max(self.cursor or 0,self.last_obs+self.cfg['max_observation_age']))
   self.raw='UNKNOWN';self.seat_since=None;self.absent_since=None
   if self.away_since is not None:self._relabel(self.away_since,('pending',),'unknown');self.away_since=None
   self._advance(now);self.reason=reason_text('reason.stale', seconds=self.cfg['max_observation_age'])
 def interrupt(self,now,reason='stream_interrupted'):
  if self.last_obs is not None:self._advance(self.last_obs);self._finish(self.last_obs,reason)
  self.raw='UNKNOWN';self.seat_since=None;self.away_since=None;self.absent_since=None;self.missing_since=None;self.reason=reason_text('reason.interrupted')
 def manual(self,action,now):
  self.tick(now)
  if action=='start':
   if self.current or self.raw!='SEATED':raise LocalizedError('error.start')
   self._advance(now);self.manual_hold=False;self._start(now,True)
  elif action=='end':
   if not self.current:raise LocalizedError('error.end')
   self._advance(now);self._finish(now,'manual')
   self.seat_since=None;self.raw='UNKNOWN';self.manual_hold=True
  elif action=='review':
   s=self.current or (self.completed[-1] if self.completed else None)
   if not s:raise LocalizedError('error.review')
   s['review']=True;self.event('review_marker',now,session_id=s['session_id'])
  else:raise LocalizedError('error.ACTION_UNAVAILABLE')
 @staticmethod
 def totals(session):
  result=dict(work_seconds=0.,rest_seconds=0.,unknown_seconds=0.,pending_seconds=0.)
  if session:
   for seg in session['segments']:result[seg['kind']+'_seconds']+=max(0,seg['end']-seg['start'])
  return result
 def snapshot(self,now):
  self.tick(now)
  s=self.current or (self.completed[-1] if self.completed else None)
  totals=self.totals(s)
  # Project a fresh observation only up to now; unknown time is advanced by tick.
  if self.current and self.cursor is not None and now>self.cursor and self.raw!='UNKNOWN':
   delta=now-self.cursor;kind='work' if self.raw=='SEATED' else ('rest' if self.away_since is not None and now-self.away_since>self.cfg['short_away_seconds'] else 'pending')
   totals[kind+'_seconds']+=delta
  mode='NOT_STARTED'
  if self.raw=='UNKNOWN':mode='OBSERVATION_UNKNOWN'
  elif self.current:mode='WORKING' if self.raw=='SEATED' else ('REST' if self.away_since is not None and now-self.away_since>self.cfg['short_away_seconds'] else 'AWAY_PENDING')
  elif self.seat_since is not None:mode='START_PENDING'
  return dict(state=mode,behavior=self.raw,reason=self.reason,**reason_fields(self.reason),session_id=s['session_id'] if s else None,active=bool(self.current),session_start=s['start'] if s else None,session_end=s.get('end') if s else None,review=s.get('review',False) if s else False,**totals,start_pending_seconds=max(0,now-self.seat_since) if self.seat_since is not None and not self.current else 0,completed_sessions=len(self.completed),thresholds=self.cfg)

def iou(a,b):
 area=lambda r:max(0,r[2]-r[0])*max(0,r[3]-r[1])
 inter=area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])]);return inter/max(1,area(a)+area(b)-inter)
def deduplicate(persons,width,height,cfg):
 kept=[]
 for p in sorted(persons,key=lambda p:p.get('confidence',0),reverse=True):
  duplicate=False
  for q in kept:
   shared=[(a,b) for j,(a,b) in enumerate(zip(p['keypoints'],q['keypoints'])) if j in (0,5,6,7,8,9,10,11,12) and a.get('confidence',0)>=cfg['keypoint_confidence'] and b.get('confidence',0)>=cfg['keypoint_confidence'] and a.get('x') is not None and b.get('x') is not None]
   if iou(p['bbox_xyxy'],q['bbox_xyxy'])>=cfg['dedup_iou'] and len(shared)>=3 and sum(math.hypot(a['x']-b['x'],a['y']-b['y']) for a,b in shared)/len(shared)<math.hypot(width,height)*cfg['dedup_distance']:duplicate=True;break
  if not duplicate:kept.append(p)
 return kept

def point_in_polygon(point,polygon):
 x,y=point;inside=False
 for (a,b),(c,d) in zip(polygon,polygon[1:]+polygon[:1]):
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:inside=not inside
 return inside

def classify(persons,width,height,config):
 cfg={**DEFAULTS,**config};roi=cfg['regions']
 if cfg['image_size']!=[width,height]:return 'UNKNOWN',reason_text('reason.size'),[]
 persons=deduplicate(persons,width,height,cfg);candidates=[];uncertain=False
 for p in persons:
  k=p['keypoints'];valid=lambda j:len(k)>j and k[j].get('confidence',0)>=cfg['keypoint_confidence'] and k[j].get('x') is not None
  if valid(5) and valid(6):anchor=((k[5]['x']+k[6]['x'])/2,(k[5]['y']+k[6]['y'])/2)
  elif valid(0) and (valid(5) or valid(6)):
   j=5 if valid(5) else 6;anchor=((k[0]['x']+k[j]['x'])/2,(k[0]['y']+k[j]['y'])/2)
  else:
   if iou(p['bbox_xyxy'],[min(x[0] for x in roi['station']),min(x[1] for x in roi['station']),max(x[0] for x in roi['station']),max(x[1] for x in roi['station'])])>.05:uncertain=True
   continue
  p['upper_body_anchor']=list(anchor)
  if point_in_polygon(anchor,roi['station']):candidates.append(p)
 if uncertain or len(candidates)>1:return 'UNKNOWN',reason_text('reason.ambiguous'),persons
 if not candidates:return 'MISSING',reason_text('reason.missing'),persons
 return ('SEATED',reason_text('reason.seated'),persons) if point_in_polygon(candidates[0]['upper_body_anchor'],roi['seat']) else ('NEARBY',reason_text('reason.nearby'),persons)
