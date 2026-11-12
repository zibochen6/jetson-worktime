import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validRatios,moveSplit,trainingParameters,trainingProgress,trainingMetricRows} from '../public/studio.js';
import {clampBox} from '../public/annotation.js';
test('training split and parameters preserve explicit learning rate and model defaults',()=>{
 assert.ok(validRatios([80,10,10]));for(const r of [[100,0,0],[80,10,11],[80,10.5,9.5]])assert.equal(validRatios(r),false);
 assert.deepEqual(trainingParameters('yolo11n'),{epochs:100,lr0:.001,batch:4});assert.equal(trainingParameters('yolo11l').batch,1);
 assert.equal(trainingParameters('yolo11m',10,.0002,2).lr0,.0002);
});
test('training does not show complete before artifacts saved',()=>{
 assert.equal(trainingProgress({state:'saving',progress:1}),.99);assert.equal(trainingProgress({state:'completed',progress:1}),1);assert.equal(trainingProgress({progress:NaN}),0);
});
test('annotation boxes clamp corners to full image coordinates',()=>{
 assert.deepEqual(clampBox([120,90,-10,-20],[100,80]),[0,0,100,80]);
});
test('settings exposes all studio entries and device media whitelist includes resources',async()=>{
 const html=await readFile(new URL('../public/settings.html',import.meta.url),'utf8');for(const k of ['materials','models','training'])assert.ok(html.includes('data-studio="'+k+'"'));
 const script=await readFile(new URL('../../scripts/preview.py',import.meta.url),'utf8');for(const file of ['studio.js','studio.css','annotation.js'])assert.ok(script.includes("'/"+file+"'"));
});

test('independent split handles preserve total and at least one percent per set',()=>{assert.deepEqual(moveSplit([80,10,10],0,70),[70,20,10]);assert.deepEqual(moveSplit([70,20,10],1,85),[70,15,15]);for(const b of [0,1])for(const v of [-10,0,99,100,200])assert.ok(validRatios(moveSplit([80,10,10],b,v)));});

test('validation and test metrics remain distinct and actual learning rate is labelled',()=>{
 const rows=trainingMetricRows({metrics:{'metrics/mAP50(B)':.2,'val/box_loss':1.2},test_metrics:{'metrics/mAP50(B)':.6},lr:{'lr/pg0':.0005}},'en');
 assert.deepEqual(rows.map(r=>r.value),[.2,1.2,.6,.0005]);
 assert.match(rows[0].label,/Validation/);assert.match(rows[2].label,/Test/);assert.match(rows[3].label,/Actual learning rate/);
 const zh=trainingMetricRows({test_metrics:{'metrics/recall(B)':.9}},'zh-CN');assert.match(zh[0].label,/测试/);assert.match(zh[0].label,/召回/);
});

test('capture serializes concurrent requests and finish drains the last photo without restarting',async()=>{
 const {CaptureSequence}=await import('../public/studio.js');let resolve,calls=0;const timers=[];
 const c=new CaptureSequence(()=>{calls++;return new Promise(r=>resolve=r);},()=>{},()=>{},fn=>{timers.push(fn);return timers.length;},()=>{});
 const start=c.start(2);await Promise.resolve();const same=c.take();assert.equal(calls,1);assert.equal(c.running,true);
 const finish=c.finish();assert.equal(c.running,false);resolve(true);await Promise.all([start,same,finish]);
 assert.equal(c.saved,1);assert.equal(c.pending,null);assert.equal(timers.length,0);
});
test('continuous capture waits for each save and a failed photo stops the sequence',async()=>{
 const {CaptureSequence}=await import('../public/studio.js');let calls=0,error;const timers=[];
 const c=new CaptureSequence(async()=>{calls++;if(calls===2)throw Error('camera offline');return true;},()=>{},e=>error=e,fn=>{timers.push(fn);return timers.length;},()=>{});
 await c.start(1);assert.equal(c.saved,1);assert.equal(timers.length,1);await timers.shift()();
 assert.equal(c.running,false);assert.equal(c.saved,1);assert.equal(error.message,'camera offline');
 for(const seconds of [0,NaN,3601])await assert.rejects(()=>c.start(seconds),RangeError);
});
test('duplicate camera images do not increase the newly saved count',async()=>{
 const {CaptureSequence}=await import('../public/studio.js');const c=new CaptureSequence(async()=>false);await c.take();assert.equal(c.saved,0);
});
test('capture requires a fresh business camera and blocks training, stale or failed observations',async()=>{
 const {captureCameraReady}=await import('../public/studio.js');assert.equal(captureCameraReady({status:'online',algorithm_fresh:true,operating_mode:'business'}),true);
 for(const c of [null,{status:'reconnecting'},{status:'online',algorithm_fresh:false},{status:'online',algorithm_error:'failed'},{status:'online',operating_mode:'training'}])assert.equal(captureCameraReady(c),false);
});

test('annotation class changes and undo preserve coordinates and labels',async()=>{
 const {BoxAnnotator}=await import('../public/annotation.js');const canvas={addEventListener(){}};let changes=0;
 const a=new BoxAnnotator(canvas,()=>changes++);a.draw=()=>{};a.classes={0:'part',1:'box'};a.boxes=[[1,2,20,30,0]];a.selected=0;a.setClass(1);assert.deepEqual(a.boxes[0],[1,2,20,30,1]);a.undo();assert.deepEqual(a.boxes[0],[1,2,20,30,0]);assert.equal(changes,2);
});
test('new-box mode allows overlapping annotations with the selected class',async()=>{const {BoxAnnotator}=await import('../public/annotation.js');const a=new BoxAnnotator({addEventListener(){},setPointerCapture(){},getBoundingClientRect(){return {width:100}}},()=>{});a.draw=()=>{};a.image={};a.classes={0:'a',1:'b'};a.classId=1;a.size=[100,100];a.boxes=[[0,0,90,90,0]];a.point=()=>[10,10];a.beginBox();a.down({button:0,pointerId:1,preventDefault(){}});assert.equal(a.boxes.length,2);assert.equal(a.boxes[1][4],1);});
