import {studioMock,materialDefaults} from './studio-mock.mjs';
import {overlayStyle,visualizationDefaults} from './public/overlay.js';
import {readFile} from 'node:fs/promises';
import {validateRegions} from './public/roi-editor.js';
const scenarios=['idle','start','working','away','rest','done','unknown','offline','algorithm','moved','owner_return'];
let scenario='idle';let review=false;let ownerConfirmed=false;
let cameraTest=null;
let streamSession='mock-stream';
const mockDevices=[{device:'/dev/v4l/by-id/mock-usb-camera',name:'Mock USB camera',formats:['yuyv','mjpeg','h264']}];
const defaultDetection = {person_confidence:.10,keypoint_confidence:.40};
const defaultTiming = {start_seconds:10, short_away_seconds:60, stop_absent_seconds:300, missing_grace_seconds:3, max_observation_age:1.5};
const deviceSettings = {
  camera_source:{type:'rtsp',url:'rtsp://192.168.1.100:554/stream',username:'admin',password_set:true,codec:'h265'},
  models:{person:'builtin-person',material:null},materials:structuredClone(materialDefaults),
  revision:0, privacy:{enabled:true}, display:{...overlayStyle.defaults,station:true,seat:true},
  detection:{...defaultDetection}, visualization:visualizationDefaults(),
  timing:{...defaultTiming}, image_size:[2560,1440], roi_configured:false,
  regions:{station:[[1664,0],[2559,0],[2559,1439],[1664,1439]],seat:[[2125,331],[2559,331],[2559,893],[2125,893]]}
};
export function settingsFixture() {
  return {schema_version:'1.0', ...structuredClone(deviceSettings), defaults:{...defaultTiming}, detection_defaults:{...defaultDetection}, visualization_defaults:visualizationDefaults(), camera:fixtures().camera};
}

export function systemMetricsFixture() {
  return {
    schema_version:'1.0', sampled_at_ms:Date.now(), age_ms:0,
    cpu_percent:21.3, gpu_percent:32.1,
    memory_used_bytes:3*1024**3, memory_total_bytes:Math.round(15.3*1024**3),
    temperature_celsius:55.2, temperature_sensor:'cpu-thermal',
    uptime_seconds:process.uptime(),
  };
}

export function fixtures(name=scenario){
  const now=process.uptime(),ns=String(Math.round(now*1e9)),regions=structuredClone(deviceSettings.regions);
  const mode={idle:'NOT_STARTED',start:'START_PENDING',working:'WORKING',away:'AWAY_PENDING',rest:'REST',done:'NOT_STARTED',unknown:'OBSERVATION_UNKNOWN',offline:'OBSERVATION_UNKNOWN',algorithm:'OBSERVATION_UNKNOWN',moved:'OBSERVATION_UNKNOWN',owner_return:'AWAY_PENDING'}[name];
  const behavior=['unknown','offline','algorithm','moved'].includes(name)?'UNKNOWN':['idle','done'].includes(name)?'MISSING':name==='owner_return'?'MISSING':['away','rest'].includes(name)?'NEARBY':'SEATED';
  const person={person_track_id:7,bbox_xyxy:[2020,250,2540,1400],confidence:.93,valid:true,
    upper_body_anchor:[2300,570],keypoints:[[2300,380],[2260,360],[2340,360],[2220,380],[2380,380],[2150,570],[2450,570],[2120,800],[2470,800],[2200,980],[2400,980],[2200,1080],[2400,1080],null,null,null,null].map(p=>({x:p?.[0]??null,y:p?.[1]??null,confidence:p?.[0]!==undefined?.94:.1}))};
  const active=['working','away','rest','unknown','algorithm','moved','owner_return'].includes(name),has=active||name==='done';
  const reason_code={SEATED:'reason.seated',NEARBY:'reason.nearby',MISSING:'reason.missing',UNKNOWN:'reason.ambiguous'}[behavior];
  const work={schema_version:'1.0',config_revision:deviceSettings.revision,privacy_applied:deviceSettings.privacy.enabled,state:mode,behavior,reason:'MOCK 模拟情景：'+name,reason_code,reason_params:{},run_id:'mock-run',session_id:has?'mock-work-session':null,active,session_start:has?0:null,session_end:name==='done'?now:null,review,
    materials:{enabled:deviceSettings.materials.enabled,available:deviceSettings.materials.configured,pending:3,completed:5,cumulative:5,reviews:[]},
    work_seconds:has?1115:0,rest_seconds:has?85:0,unknown_seconds:name==='unknown'?12:0,pending_seconds:name==='away'?25:0,start_pending_seconds:name==='start'?5:0,completed_sessions:name==='done'?1:0,
    thresholds:{...deviceSettings.timing},frame_ref:{session_id:streamSession,receive_sequence:1,pts_ns:ns,receive_monotonic_ns:ns},algorithm_error:name==='algorithm'?'RuntimeError':null,roi_provisional:!deviceSettings.roi_configured,camera_changed:name==='moved',regions,image_size:[2560,1440],last_observation_monotonic_seconds:now,server_monotonic_seconds:now,server_wall_time_ms:Date.now()};
  work.start_confirmation={state:name==='moved'?'BLOCKED':active?'ACTIVE':name==='start'?'CONFIRMING':'WAITING',elapsed_seconds:work.start_pending_seconds,required_seconds:deviceSettings.timing.start_seconds,candidate_track_id:name==='start'?7:null,blocker_code:name==='moved'?'reason.moved':null,blocker_params:{},last_reset:null};
  const observation={visualization:structuredClone(deviceSettings.visualization),detection:{...deviceSettings.detection},config_revision:deviceSettings.revision,privacy_applied:deviceSettings.privacy.enabled,display:{...deviceSettings.display},observation_id:'mock-observation',run_id:'mock-run',frame:{stream_session_id:streamSession,receive_sequence:1,pts_ns:null,receive_monotonic_ns:ns,source_width:2560,source_height:1440,jpeg_width:1280,jpeg_height:720,color_format:'BGR'},inference:{started_monotonic_ns:ns,completed_monotonic_ns:ns,local_processing_ms:20,local_receive_to_result_ms:25,accepted:true,observation_valid:behavior!=='UNKNOWN',behavior,reason:work.reason,reason_code,reason_params:{}},persons:['idle','done'].includes(name)||person.confidence<deviceSettings.detection.person_confidence?[]:[person],regions,roi_provisional:!deviceSettings.roi_configured,camera_changed:name==='moved',matching_frame_url:'/api/v1/observations/frame.jpg?observation_id=mock-observation'};
  if(name==='owner_return' || (name==='working' && ownerConfirmed)) {
    const waiting=name==='owner_return';
    work.ownership={operator_id:'mock-operator',track_id:waiting?1:7,run_id:'mock-run',stream_session_id:streamSession,
      state:waiting?'CONFIRMATION_REQUIRED':'TRACKED',needs_confirmation:waiting,
      candidates:[{track_id:7,bbox_xyxy:person.bbox_xyxy,zone:'SEATED'}],ignored_track_ids:waiting?[7]:[],
      away_since:waiting?0:null,absent_since:waiting?0:null,away_seconds:waiting?25:0,absent_seconds:waiting?25:0,
      end_remaining_seconds:waiting?275:null};
    work.reason_code=waiting?'ownership.confirmRequired':'ownership.confirmed';
    observation.ownership=structuredClone(work.ownership);
    observation.persons[0].is_session_operator=!waiting;
    observation.persons[0].ownership_zone='SEATED';
  }
  return {work,camera:{video:{webrtc_available:false,streams:['zh-CN','en','raw']},schema_version:'1.0',config_revision:deviceSettings.revision,privacy_applied:deviceSettings.privacy.enabled,output_fps:name==='algorithm'?0:5,algorithm_error:name==='algorithm'?'RuntimeError':null,regions_match:true,camera_changed:name==='moved',status:name==='offline'?'reconnecting':'online',sequence:1,width:2560,height:1440,jpeg_width:1280,jpeg_height:720,source_fps:20,stream_session_id:streamSession,receive_sequence:1,pts_ns:ns,age_ms:name==='offline'?6000:0,source_type:deviceSettings.camera_source.type,device_name:deviceSettings.camera_source.device||'RTSP',connection_error:null,codec:deviceSettings.camera_source.codec||deviceSettings.camera_source.format,decoder:['yuyv','mjpeg'].includes(deviceSettings.camera_source.format)?'software':'nvv4l2decoder',preview_max_fps:12,preview_has_project_overlay:false},envelope:{schema_version:'1.0',config_revision:deviceSettings.revision,privacy_applied:deviceSettings.privacy.enabled,available:!['offline','algorithm'].includes(name),fresh:!['offline','algorithm'].includes(name),age_ms:name==='offline'?null:0,algorithm_error:name==='algorithm'?'RuntimeError':null,observation:['offline','algorithm'].includes(name)?null:observation}};
}
export async function mockReply(req,res,url){
  res.setHeader('Cache-Control','no-store');
  if(await studioMock(req,res,url,deviceSettings))return;
  const json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const error=(code,message,status,details={})=>json({schema_version:'1.0',error:{code,message,message_key:details.message_key||'error.'+code,message_params:details.message_params||{}}},status);
  if(url.pathname==='/api/v1/system/metrics') {
    if(req.method!=='GET') return error('METHOD_NOT_ALLOWED','Unsupported method',405);
    return json(systemMetricsFixture());
  }
  const languages=url.searchParams.getAll('lang');
  const locale=languages[0]||'zh-CN';
  if(['/stream.mjpg','/api/frame.jpg'].includes(url.pathname)&&(languages.length>1||!['zh-CN','en'].includes(locale)||languages[0]===''))return error('BAD_REQUEST','Unsupported language',400,{message_key:'error.language'});
  if(url.pathname==='/mock/scenario') {const name=url.searchParams.get('name');if(!scenarios.includes(name))return error('BAD_REQUEST','Unknown mock scenario',400);scenario=name;ownerConfirmed=false;return json({scenario});}
  if(url.pathname==='/api/v1/camera/devices') return json({schema_version:'1.0',devices:mockDevices});
  if(url.pathname==='/api/v1/camera/test') {
    if(req.method!=='POST') return error('METHOD_NOT_ALLOWED','Unsupported method',405);
    if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return error('ORIGIN_REJECTED','Use same origin',403);
    let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return error('BAD_REQUEST','Body too large',400);}
    let request;try{request=JSON.parse(body);}catch{return error('BAD_REQUEST','Invalid JSON',400);}
    if(request.expected_revision!==deviceSettings.revision)return error('SETTINGS_CONFLICT','Configuration changed',409);
    const source=request.camera_source;
    if(!source || (source.type==='rtsp' ? !/^rtsps?:\/\//.test(source.url) || !['h264','h265'].includes(source.codec) : source.type!=='usb' || !mockDevices.some(d=>d.device===source.device && d.formats.includes(source.format))))return error('CAMERA_TEST_FAILED','Invalid source',400,{message_key:'source.invalid'});
    cameraTest={source:JSON.stringify(source),revision:request.expected_revision,expires:Date.now()+90000,token:'mock-camera-test-'+Date.now()};
    return json({schema_version:'1.0',test_token:cameraTest.token,expires_in_seconds:90,width:2560,height:1440});
  }
  if(url.pathname==='/api/v1/settings') {
    if(req.method==='GET') return json(settingsFixture());
    if(req.method!=='PUT') return error('METHOD_NOT_ALLOWED','Unsupported method',405);
    const origin=req.headers.origin;
    if(origin && new URL(origin).host!==req.headers.host) return error('ORIGIN_REJECTED','Use same origin',403);
    let body='';
    for await(const chunk of req){body+=chunk;if(body.length>32768)return error('BAD_REQUEST','Body too large',400);}
    let request;
    try {request=JSON.parse(body);} catch {return error('BAD_REQUEST','Invalid JSON',400);}
    if(!request || typeof request!=='object' || Array.isArray(request) || !Number.isInteger(request.expected_revision)) return error('BAD_REQUEST','expected_revision required',400);
    if(request.expected_revision!==deviceSettings.revision) return error('SETTINGS_CONFLICT','配置已更新，请重新加载。',409);
    if('camera_source' in request) {
      if(Object.keys(request).some(k=>!['expected_revision','camera_source','test_token'].includes(k)))return error('BAD_REQUEST','Save separately',400,{message_key:'source.separateSave'});
      if(!cameraTest || cameraTest.token!==request.test_token || cameraTest.revision!==request.expected_revision || cameraTest.source!==JSON.stringify(request.camera_source) || cameraTest.expires<=Date.now())return error('BAD_REQUEST','Test again',400,{message_key:'source.testExpired'});
      const source={...request.camera_source};
      if(source.type==='rtsp') {
        const parsed=new URL(source.url);
        source.username=source.username||decodeURIComponent(parsed.username);
        source.password_set=Boolean(source.password||parsed.password || (source.url===deviceSettings.camera_source.url && source.username===deviceSettings.camera_source.username && deviceSettings.camera_source.password_set));
        parsed.username='';parsed.password='';source.url=parsed.href;
        delete source.password;
      }
      deviceSettings.camera_source=source;deviceSettings.roi_configured=false;deviceSettings.revision++;scenario='idle';cameraTest=null;streamSession='mock-stream-'+deviceSettings.revision;
      return json(settingsFixture());
    }
    const allowed=['expected_revision','privacy','display','timing','regions','image_size','reference_frame','detection','visualization','models','materials'];
    if(Object.keys(request).some(key=>!allowed.includes(key)))return error('BAD_REQUEST','Unknown field',400);
    const next=structuredClone(deviceSettings);
    try {
      for(const key of ['privacy','display','timing','regions','image_size','detection','visualization','models','materials']) if(key in request) next[key]=request[key];
      if(!next.privacy || Object.keys(next.privacy).join(',')!=='enabled' || typeof next.privacy.enabled!=='boolean') throw new Error('privacy.enabled 必须为布尔值');
      if(!next.visualization || Object.keys(next.visualization).length!==3 || !next.visualization.colors || Object.keys(next.visualization.colors).length!==6 || Object.keys(visualizationDefaults().colors).some(key=>!/^#[0-9a-f]{6}$/i.test(next.visualization.colors[key]??'')) || ['station_fill_alpha','seat_fill_alpha'].some(key=>!Number.isFinite(next.visualization[key])||next.visualization[key]<0||next.visualization[key]>1))return error('BAD_REQUEST','Invalid palette',400,{message_key:'visualization.invalid'});
      if(!next.display || ![3,5].includes(Object.keys(next.display).length) || ['boxes','regions','keypoints'].some(key=>typeof next.display[key]!=='boolean') || Object.keys(next.display).some(key=>!['boxes','regions','keypoints','station','seat'].includes(key)))throw new Error('显示开关无效');
      next.display.station ??= next.display.regions;next.display.seat ??= next.display.regions;
      if(typeof next.display.station!=='boolean'||typeof next.display.seat!=='boolean')throw new Error('显示开关无效');
      next.display.regions=next.display.station||next.display.seat;
      if(!next.detection || Object.keys(next.detection).length!==2 || Object.keys(next.detection).some(k=>!(k in defaultDetection)))return error('BAD_REQUEST','Both detection fields required',400,{message_key:'detection.allFields'});
      for(const [key,min] of [['person_confidence',.1],['keypoint_confidence',.25]]) {
        if(!Number.isFinite(next.detection[key]) || next.detection[key]<min || next.detection[key]>1)return error('BAD_REQUEST','Invalid confidence',400,{message_key:'detection.invalid',message_params:{field:key,minimum:min}});
      }
      if(!next.timing || Object.keys(next.timing).length!==5) throw new Error('需要五项时长');
      for(const key of Object.keys(defaultTiming)) {
        const minimum=['short_away_seconds','missing_grace_seconds'].includes(key)?0:.1;
        if(!Number.isFinite(next.timing[key]) || next.timing[key]<minimum || next.timing[key]>86400) throw new Error('时长范围无效');
      }
      if(next.timing.stop_absent_seconds<=Math.max(next.timing.short_away_seconds,next.timing.missing_grace_seconds)) throw new Error('结束等待时间必须大于暂离确认时间和漏检缓冲时间');
      if(!Array.isArray(next.image_size) || next.image_size.length!==2 || next.image_size.some(v=>!Number.isInteger(v)||v<2)) throw new Error('原图尺寸无效');
      validateRegions(next.regions,next.image_size);
      if('regions' in request || 'image_size' in request) {
        if(scenario==='offline' || request.reference_frame?.stream_session_id!==streamSession || JSON.stringify(request.reference_frame?.image_size)!==JSON.stringify(next.image_size)) return error('SETTINGS_CONFLICT','请重新取图',409);
        next.roi_configured=true;
      }
    } catch(e) {return error('BAD_REQUEST',e.message,400,e);}
    if(JSON.stringify(next)!==JSON.stringify(deviceSettings) || 'regions' in request) {
      next.revision++;
      if('regions' in request || JSON.stringify(next.timing)!==JSON.stringify(deviceSettings.timing) || JSON.stringify(next.detection)!==JSON.stringify(deviceSettings.detection))scenario='idle';
      Object.assign(deviceSettings,next);
    }
    return json(settingsFixture());
  }
  const data=fixtures();
  if(url.pathname==='/api/v1/camera')return json(data.camera);
  if(url.pathname==='/api/v1/work/status')return json(data.work);
  if(url.pathname==='/api/v1/observations/latest')return json(data.envelope);
  if(url.pathname==='/api/v1/work/actions'&&req.method==='POST') {
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return error('BAD_REQUEST','Body too large',400);}
    let request,action;try{request=JSON.parse(body);action=request.action;}catch{return error('BAD_REQUEST','Invalid JSON',400);}
    if(!['start','end','review','confirm_camera','confirm_return'].includes(action))return error('BAD_REQUEST','Unknown action',400);
    if(action==='confirm_return') {
      if(scenario!=='owner_return' || request.session_id!==data.work.session_id || request.observation_id!=='mock-observation'
          || request.stream_session_id!==streamSession || request.config_revision!==deviceSettings.revision || request.track_id!==7)
        return error('ACTION_UNAVAILABLE','Stale confirmation',409,{message_key:'ownership.staleConfirmation'});
      scenario='working';ownerConfirmed=true;
    }
    if(action==='start'){if(data.work.active||data.work.behavior!=='SEATED')return error('ACTION_UNAVAILABLE','Simulate seated/start first',409);scenario='working';}
    if(action==='end'){if(!data.work.active)return error('ACTION_UNAVAILABLE','No active mock session',409);scenario='done';}
    if(action==='review'){if(!data.work.session_id)return error('ACTION_UNAVAILABLE','No mock session',409);review=true;}
    return json(fixtures().work);
  }
  if(url.pathname==='/api/frame.jpg'||url.pathname==='/api/v1/video.jpg'||url.pathname==='/api/v1/observations/frame.jpg'||url.pathname==='/api/v1/video.mjpg'||url.pathname==='/stream.mjpg') {
    if(['offline','algorithm'].includes(scenario))return error('FRAME_UNAVAILABLE','Simulated disconnect',503);
    if(url.pathname.includes('observations/')&&url.searchParams.get('observation_id')!=='mock-observation')return error('FRAME_EXPIRED','Simulated expired frame',410);
    const jpeg=await readFile(new URL('./public/mock.jpg',import.meta.url));
    if(!url.pathname.endsWith('mjpg')){res.writeHead(200,{'Content-Type':'image/jpeg','Content-Language':locale,'Content-Length':jpeg.length,'X-Observation-ID':'mock-observation','X-Stream-Session-ID':streamSession,'X-Frame-Sequence':'1','X-Config-Revision':String(deviceSettings.revision),'X-Privacy-Applied':String(deviceSettings.privacy.enabled)});res.end(jpeg);return;}
    res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame','Content-Language':locale,'X-Preview-Overlay':String(url.pathname==='/stream.mjpg')});
    let sequence=0;const revision=deviceSettings.revision;
    const send=()=>{if(scenario==='offline'||revision!==deviceSettings.revision){res.end();return;}if(!res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Language: ${locale}\r\nContent-Length: ${jpeg.length}\r\nX-Stream-Session-ID: ${streamSession}\r\nX-Frame-Sequence: ${++sequence}\r\n\r\n`))return;res.write(jpeg);res.write('\r\n');};
    send();const timer=setInterval(send,200);res.on('close',()=>clearInterval(timer));return;
  }
  error('NOT_FOUND','Unknown mock endpoint',404);
}
