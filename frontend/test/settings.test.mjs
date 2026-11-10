import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePoint, validateRegions} from '../public/roi-editor.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('ROI point mapping respects letterbox, scaling and boundaries', () => {
  const bounds = {left:100, top:50, width:1000, height:1000};
  assert.equal(sourcePoint(600,100,bounds,[2560,1440]),null);
  assert.deepEqual(sourcePoint(600,550,bounds,[2560,1440]),[1280,720]);
  assert.deepEqual(sourcePoint(1100,831.25,bounds,[2560,1440]),[2559,1439]);
});

test('ROI geometry rejects crossing, degenerate and concave containment errors', () => {
  const regions = {station:[[0,0],[99,0],[99,99],[0,99]],seat:[[20,20],[80,20],[80,80],[20,80]]};
  assert.doesNotThrow(() => validateRegions(regions,[100,100]));
  for(const polygon of [[[0,0],[99,99],[0,99],[99,0]],[[0,0],[1,1],[2,2]],[[20,20],[101,20],[80,80]]]) {
    assert.throws(() => validateRegions({...regions,seat:polygon},[100,100]));
  }
  assert.throws(() => validateRegions({station:[[0,0],[99,0],[99,99],[60,99],[60,30],[40,30],[40,99],[0,99]],seat:[[20,60],[80,60],[80,80],[20,80]]},[100,100]));
});

test('settings mock shares versions, validates writes and marks media privacy', async t => {
  const child=spawn(process.execPath,['server.mjs','--mock'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('startup timeout')),5000);
    child.once('error',reject);
    child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  const put=body=>fetch(base+'/api/v1/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/settings')).status,200);
  const first=await (await fetch(base+'/api/v1/settings')).json();
  assert.equal(first.privacy.enabled,true);
  assert.equal((await (await fetch(base+'/api/v1/work/status')).json()).roi_provisional,true);
  const saved=await put({expected_revision:first.revision,display:{boxes:false,regions:false,keypoints:true}});
  assert.equal(saved.status,200);
  const second=await (await fetch(base+'/api/v1/settings')).json();
  assert.equal(second.revision,1);
  assert.equal(second.display.boxes,false);
  assert.equal((await put({expected_revision:0,privacy:{enabled:false}})).status,409);
  assert.equal((await put({expected_revision:1,timing:{...first.timing,start_seconds:-1}})).status,400);
  assert.equal((await put({expected_revision:1,privacy:{enabled:false}})).status,200);
  const screenshot=await fetch(base+'/api/v1/video.jpg');
  assert.equal(screenshot.headers.get('X-Privacy-Applied'),'false');
  assert.equal(screenshot.headers.get('X-Config-Revision'),'2');
  const observation=await (await fetch(base+'/api/v1/observations/latest')).json();
  assert.equal(observation.observation.display.boxes,false);
  const roiSave=await put({expected_revision:2,regions:first.regions,image_size:first.image_size,reference_frame:{stream_session_id:'mock-stream',image_size:first.image_size}});
  assert.equal(roiSave.status,200);
  assert.equal((await roiSave.json()).roi_configured,true);
  assert.equal((await (await fetch(base+'/api/v1/work/status')).json()).roi_provisional,false);
});

test('home presents an inline settings dialog using the shared editor', async () => {
  const {readFile}=await import('node:fs/promises');
  const home=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(home,/<button[^>]*id="settingsToggle"[^>]*data-open-settings/);
  assert.match(home,/<dialog id="settingsDialog"/);
  assert.match(home,/<iframe id="settingsFrame"[^>]*title=/);
  assert.doesNotMatch(home,/href="\/settings"/);
  assert.match(home, /id="roiToggle"[^>]*data-open-settings[^>]*data-settings-section="roi"/);
  assert.match(home,/工作会话计时/);
  assert.doesNotMatch(home,/今日工时统计|人员判定分布|网络延迟/);
  const settings=await readFile(new URL('../public/settings.html',import.meta.url),'utf8');
  assert.match(settings,/ROI区域编辑画布/);
});

test('camera source controls and mock enforce test-before-save and shared revisions', async t => {
  const {readFile} = await import('node:fs/promises');
  const html = await readFile(new URL('../public/settings.html', import.meta.url), 'utf8');
  for (const id of ['sourceType','sourceUrl','sourceUsername','sourcePassword','sourceCodec','sourceDevice','sourceFormat','testSource','saveSource']) assert.match(html, new RegExp(`id="${id}"`));
  const child = spawn(process.execPath,['server.mjs','--mock'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base = await new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>reject(new Error('startup timeout')),5000);
    child.once('error',reject);
    child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  const send = (path, method, body) => fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const devices = await (await fetch(base+'/api/v1/camera/devices')).json();
  assert.deepEqual(devices.devices[0].formats,['yuyv','mjpeg','h264']);
  const camera_source={type:'rtsp',url:'rtsp://new/stream',username:'admin',password:'secret',codec:'h264'};
  assert.equal((await send('/api/v1/settings','PUT',{expected_revision:0,camera_source,test_token:'bad'})).status,400);
  const tested = await (await send('/api/v1/camera/test','POST',{expected_revision:0,camera_source})).json();
  const saved = await send('/api/v1/settings','PUT',{expected_revision:0,camera_source,test_token:tested.test_token});
  assert.equal(saved.status,200);
  const config = await saved.json();
  assert.equal(config.revision,1);
  assert.equal(config.roi_configured,false);
  assert.equal(config.camera_source.password_set,true);
  assert.equal(JSON.stringify(config).includes('secret'),false);
  assert.equal((await send('/api/v1/camera/test','POST',{expected_revision:0,camera_source})).status,409);
});

test('detection settings share versions, validate ranges and reset mock sessions', async t => {
  const {readFile} = await import('node:fs/promises');
  const html = await readFile(new URL('../public/settings.html',import.meta.url),'utf8');
  assert.match(html,/id="detectionPanel"/);
  assert.match(html,/id="restoreDetectionDefaults"/);
  const child=spawn(process.execPath,['server.mjs','--mock'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('startup timeout')),5000);
    child.once('error',reject);
    child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  const put = body=>fetch(base+'/api/v1/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const first=await (await fetch(base+'/api/v1/settings')).json();
  assert.deepEqual(first.detection,{person_confidence:.1,keypoint_confidence:.4});
  assert.deepEqual(first.detection_defaults,first.detection);
  await fetch(base+'/mock/scenario?name=working');
  assert.equal((await (await fetch(base+'/api/v1/work/status')).json()).active,true);
  assert.equal((await put({expected_revision:0,detection:{person_confidence:.09,keypoint_confidence:.4}})).status,400);
  assert.equal((await put({expected_revision:0,detection:{person_confidence:.1,keypoint_confidence:.24}})).status,400);
  assert.equal((await put({expected_revision:0,detection:{person_confidence:.5}})).status,400);
  const changed=await put({expected_revision:0,detection:{person_confidence:.99,keypoint_confidence:.95}});
  assert.equal(changed.status,200);
  const saved=await changed.json();
  assert.equal(saved.revision,1);
  assert.equal(saved.privacy.enabled,true);
  assert.equal((await (await fetch(base+'/api/v1/work/status')).json()).active,false);
  const repeated=await put({expected_revision:1,detection:saved.detection});
  assert.equal((await repeated.json()).revision,1);
  assert.equal((await put({expected_revision:0,detection:first.detection})).status,409);
  await fetch(base+'/mock/scenario?name=working');
  const observation=(await (await fetch(base+'/api/v1/observations/latest')).json()).observation;
  assert.deepEqual(observation.detection,saved.detection);
  assert.equal(observation.persons.length,0);
  assert.equal(observation.privacy_applied,true);
});
