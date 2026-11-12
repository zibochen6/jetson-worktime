import test from 'node:test';
import assert from 'node:assert/strict';
import {containRect,shouldRender,duration,systemMetricsView} from '../public/api.js';
import {systemMetricsFixture} from '../mock.mjs';
import {fixtures} from '../mock.mjs';
test('contain mapping includes letterbox offsets',()=>{
  assert.deepEqual(containRect(2560,1440,1000,1000),{scale:1000/2560,x:0,y:218.75,width:1000,height:562.5});
});
test('stale and repeated results never become new current overlays',()=>{
  const e=fixtures('working').envelope;assert.equal(shouldRender(e,null),true);
  assert.equal(shouldRender(e,e.observation.observation_id),false);
  assert.equal(shouldRender({...e,fresh:false},null),false);
  assert.equal(shouldRender(fixtures('offline').envelope,null),false);
});
test('all states available without a camera; timer formatting does not recalculate totals',()=>{
  const states=['idle','start','working','away','rest','done','unknown','offline'].map(n=>fixtures(n));
  assert.equal(states.length,8);assert.equal(states[5].work.active,false);assert.notEqual(states[5].work.session_end,null);
  assert.equal(duration(1115),'00:18:35');assert.equal(duration(null),'00:00:00');
  assert.equal(states[2].envelope.observation.persons[0].keypoints.length,17);
});

test('dashboard maps session totals, real ratios and incomplete data without invented values',async()=>{
 const {dashboardView}=await import('../public/api.js');
 const work={active:true,work_seconds:60,rest_seconds:20,pending_seconds:10,unknown_seconds:10};
 const view=dashboardView({},work,null);
 assert.equal(view.scope,'v4.currentSession');assert.equal(view.total,100);
 assert.deepEqual(view.ratios,{work:60,rest:20,pending:10,unknown:10});
 assert.equal(dashboardView({}, {...work,active:false,session_end:1},null).scope,'v4.lastSession');
 assert.equal(dashboardView({}, {...work,active:false,state:'START_PENDING',session_end:1},null).scope,'v4.lastSession');
 assert.equal(dashboardView({},null,null).total,null);
 assert.equal(dashboardView({},{...work,unknown_seconds:null},null).ratios.work,null);
 assert.equal(dashboardView({},{work_seconds:0,rest_seconds:0,pending_seconds:0,unknown_seconds:0},null).ratios.work,null);
});

test('health metrics discard unavailable, stale and differently versioned observations',async()=>{
 const {dashboardView,displayMode}=await import('../public/api.js');
 const camera={status:'online',output_fps:11.5,config_revision:2,stream_session_id:'a'};
 const envelope={available:true,fresh:true,age_ms:80,observation:{config_revision:2,frame:{stream_session_id:'a'},inference:{local_processing_ms:35}}};
 assert.equal(dashboardView(camera,null,envelope).processingMs,35);
 assert.equal(dashboardView(camera,null,{...envelope,fresh:false}).processingMs,null);
 assert.equal(dashboardView({...camera,config_revision:3},null,envelope).ageMs,null);
 assert.equal(dashboardView({...camera,stream_session_id:'b'},null,envelope).processingMs,null);
 assert.equal(dashboardView({...camera,status:'offline'},null,envelope).outputFps,null);
 assert.equal(dashboardView(camera,null,null).processingMs,null);
 assert.equal(displayMode('showcase'),'showcase');assert.equal(displayMode('bad'),'standard');
});

test('system telemetry preserves zero and rejects expired, invalid or missing measurements',()=>{
  const sample = systemMetricsFixture();
  const view = systemMetricsView({...sample,cpu_percent:0,gpu_percent:0});
  assert.equal(view.cpu,0);
  assert.equal(view.gpu,0);
  assert.equal(view.memoryUsed,sample.memory_used_bytes);
  assert.equal(view.temperature,55.2);
  assert.equal(systemMetricsView({...sample,age_ms:5001}).cpu,null);
  assert.equal(systemMetricsView({...sample,schema_version:'2.0'}).gpu,null);
  assert.equal(systemMetricsView({...sample,cpu_percent:101}).cpu,null);
  assert.equal(systemMetricsView({...sample,memory_used_bytes:sample.memory_total_bytes+1}).memoryUsed,null);
  assert.equal(systemMetricsView({...sample,temperature_celsius:NaN}).temperature,null);
  assert.equal(systemMetricsView({...sample,uptime_seconds:null}).uptime,null);
  assert.deepEqual(Object.values(systemMetricsView(null)),[null,null,null,null,null,null]);
});

 test('preview survives a slow structured-result request but stops on stale algorithm input',async()=>{
 const {previewReady}=await import('../public/api.js');
 const c={status:'online',algorithm_fresh:true,output_fps:12};
 assert.equal(previewReady(c,null),true);
 assert.equal(previewReady({...c,algorithm_fresh:false},null),false);
 assert.equal(previewReady({...c,algorithm_error:'error'},null),false);
 assert.equal(previewReady({...c,status:'reconnecting'},null),false);
});
