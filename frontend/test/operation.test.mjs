import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {previewReady,currentObservation,operationToken} from '../public/api.js';
import {pipelineState} from '../public/pipeline.js';
import {materialDetectionLabel} from '../public/overlay.js';
import {captureCameraReady} from '../public/studio.js';
import {assemblyRows,zoneCountRows,zoneTotal,completedAlertCount,liveMaterials} from '../public/assembly.js';
import {mockReply} from '../mock.mjs';
test('preview health is independent of business observations and never implies detection',()=>{
 const c={status:'online',operating_mode:'preview',detection_enabled:false,preview_fresh:true,algorithm_fresh:false,output_fps:10};
 assert.equal(previewReady(c,null),true);assert.equal(currentObservation(c,null),false);
 assert.equal(previewReady({...c,preview_fresh:false},null),false);
 assert.equal(previewReady({...c,algorithm_error:'privacy failed'},null),false);
 assert.equal(captureCameraReady(c),true);
 assert.equal(pipelineState(c,{operating_mode:'preview',session_end:4}).key,'operation.preview');
 assert.equal(pipelineState(c,{operating_mode:'preview'}).phase,null);
});
test('confidence display hides only scores and preserves class aliases and warnings',()=>{
 const d={class_id:2,confidence:.876,role:'alert'},m={class_styles:{2:{name:'Finished'}}};
 assert.match(materialDetectionLabel(d,m),/Finished 0.88/);
 const text=materialDetectionLabel(d,{...m,show_confidence:false});assert.match(text,/Finished/);assert.doesNotMatch(text,/0.88/);assert.notEqual(text,'Finished');
});
test('assembly separates region quantities from session production',()=>{
 const rows=assemblyRows({available:true,by_class:{pending:{0:2,3:2},completed:{2:3}},class_names:{0:'box',3:'part',2:'packed'},initial:2,added:1,cumulative:3});
 assert.deepEqual(rows.map(r=>r.group),['pending','pending','completed','production','production','production']);
});
test('mock controls persist shared state and reject stale changes; reset is idempotent',async t=>{
 const server=http.createServer((req,res)=>mockReply(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const get=async p=>(await fetch(base+p)).json();
 const put=body=>fetch(base+'/api/v1/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const old=await get('/api/v1/settings');assert.equal(old.operation.detection_enabled,true);
 const response=await put({expected_revision:old.revision,operation:{detection_enabled:false}});assert.equal(response.status,200);
 const camera=await get('/api/v1/camera'),work=await get('/api/v1/work/status');assert.equal(camera.operating_mode,'preview');assert.equal(work.active,false);assert.equal(work.state,'DETECTION_DISABLED');
 assert.equal((await put({expected_revision:old.revision,operation:{detection_enabled:true}})).status,409);
 const next=await get('/api/v1/settings');
 const reset=()=>fetch(base+'/api/v1/work/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset_display',expected_revision:next.revision,token:'repeat-reset-test'})});
 assert.equal((await reset()).status,200);assert.equal((await reset()).status,200);assert.equal((await get('/api/v1/settings')).operation.detection_enabled,false);
});

test('reset tokens work on LAN HTTP without randomUUID',()=>{
 const token=operationToken({getRandomValues:array=>{array.fill(15);return array;}});
 assert.equal(token,'0f'.repeat(16));assert.equal(operationToken({randomUUID:()=> 'secure-uuid'}),'secure-uuid');
});

test('home zone cards show separate real class counts and hide stale quantities',()=>{
 const s={available:true,by_class:{pending:{0:2,3:3},completed:{2:4}},class_names:{0:'box',3:'part',2:'packed'}};
 assert.deepEqual(zoneCountRows(s,'pending'),[{name:'box',value:2},{name:'part',value:3}]);
 assert.deepEqual(zoneCountRows(s,'completed'),[{name:'packed',value:4}]);
 assert.deepEqual(zoneCountRows({...s,available:false},'pending'),[]);
});

test('home totals count objects, exclude alerts, and distinguish unavailable from zero',()=>{
 const s={enabled:true,available:true,pending:2,completed:2,by_class:{pending:{0:1,3:1},completed:{2:2}},alerts:[{id:'x',active:true,region:'completed',class_id:1}]};
 assert.equal(zoneTotal(s,'pending'),2);assert.equal(zoneTotal(s,'completed'),2);assert.equal(completedAlertCount(s),1);
 assert.equal(zoneTotal({...s,pending:0},'pending'),0);
 assert.equal(zoneTotal({...s,available:false},'pending'),null);assert.equal(zoneTotal(s,'pending',false),null);
 for(const status of [{...s,available:false},{...s,alerts:[]},{...s,alerts:[{id:'x',active:false,region:'completed'}]},{...s,alerts:[{id:'x',active:true,region:'pending'}]}])assert.equal(completedAlertCount(status),0);
 assert.equal(completedAlertCount({...s,alerts:[...s.alerts,...s.alerts]}),1);assert.equal(completedAlertCount(s,false),0);
});
test('offline, changed camera, training and disabled detection discard stale home alerts',()=>{
 const m={available:true,pending:3,completed:2,alerts:[{id:'a',active:true,region:'completed'}]},w={materials:m,detection_enabled:true,operating_mode:'business'};
 for(const [camera,work]of [[{status:'reconnecting'},w],[{status:'online',algorithm_error:'failed'},w],[{status:'online',regions_match:false},w],[{status:'online',camera_changed:true},w],[{status:'online'},{...w,detection_enabled:false}],[{status:'online'},{...w,operating_mode:'training'}],[{status:'online'},{...w,operating_mode:'preview'}],[{status:'online',config_revision:2},{...w,config_revision:1}]]){
  const visible=liveMaterials(camera,work);assert.equal(zoneTotal(visible,'pending'),null);assert.equal(completedAlertCount(visible),0);
 }
 assert.equal(liveMaterials({status:'online'},w),m);assert.equal(m.alerts.length,1);
});

test('unprotected live video survives stale/failed business inference without claiming a valid observation',()=>{
 const c={status:'online',operating_mode:'business',privacy_applied:false,preview_fresh:true,algorithm_fresh:false,algorithm_error:'test',output_fps:0};
 assert.equal(previewReady(c,null),true);assert.equal(currentObservation(c,null),false);
 assert.equal(previewReady({...c,privacy_applied:true},null),false);
 assert.equal(previewReady({...c,operating_mode:'training'},null),false);
});
