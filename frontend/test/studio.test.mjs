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
