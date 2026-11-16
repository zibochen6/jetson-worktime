import test from 'node:test';
import assert from 'node:assert/strict';
import {overlayStyle, overlayDimensions, cornerSegments, placeOverlayLabels} from '../public/overlay.js';
import {drawResult, currentObservation} from '../public/api.js';
import {fixtures} from '../mock.mjs';

function canvasRecorder() {
  const calls=[];
  const context={
    createLinearGradient(){return {addColorStop(){}};},
    measureText:text=>({width:text.length*8}),
    drawImage(...args){calls.push(['drawImage',...args]);},
    save(){},restore(){},beginPath(){},closePath(){},setLineDash(){},
    moveTo(...args){calls.push(['moveTo',...args]);},
    lineTo(...args){calls.push(['lineTo',...args]);},
    stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth]);},
    fill(){calls.push(['fill',this.fillStyle,this.globalAlpha]);},
    arc(...args){calls.push(['arc',...args]);},
    roundRect(...args){calls.push(['roundRect',...args]);},
    fillText(...args){calls.push(['fillText',...args]);},
  };
  return {canvas:{width:0,height:0,getContext:()=>context},calls};
}

test('shared overlay tokens default to quiet geometry and sparse corners',()=>{
  assert.deepEqual(overlayStyle.defaults,{boxes:true,regions:true,keypoints:false});
  assert.equal(overlayStyle.seat_fill_alpha,.16);
  assert.equal(overlayStyle.colors.seat,'#fbbf24');
  for (const width of [160,640,1280,2560]) {
    const m=overlayDimensions(width);
    assert.ok(m.font_size>=11 && m.font_size<=22);
    const corners=cornerSegments([0,0,10,10],m);
    assert.equal(corners.length,4);
    assert.ok(corners[0][1][0]<=5);
  }
});

test('labels remain inside the image and omit crowded placements',()=>{
  const metrics=overlayDimensions(640);
  const labels=Array.from({length:20},()=>({x:639,y:359,width:110,height:24,text:'Presence zone'}));
  const placed=placeOverlayLabels(labels,640,360,metrics);
  assert.ok(placed.length<labels.length);
  placed.forEach((a,index)=>{
    assert.ok(a.x>=0 && a.y>=0 && a.x+a.width<=640 && a.y+a.height<=360);
    for (const b of placed.slice(0,index)) assert.equal(a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y,false);
  });
});

test('frame canvas uses current layers, a subtle fill and short labels',()=>{
  const observation=fixtures('working').envelope.observation;
  observation.display={boxes:true,regions:true,keypoints:false};
  const {canvas,calls}=canvasRecorder();
  drawResult(canvas,{naturalWidth:1280,naturalHeight:720},observation);
  assert.equal(canvas.width,1280);
  assert.ok(calls.some(c=>c[0]==='fill' && c[1]===overlayStyle.colors.seat && c[2]===overlayStyle.seat_fill_alpha));
  assert.ok(calls.some(c=>c[0]==='fillText' && c[1]==='人员'));
  assert.equal(calls.some(c=>c[0]==='arc'),false);
  assert.equal(calls.some(c=>c[0]==='fillText' && /配置|轨迹/.test(c[1])),false);
});

test('stale canvas hides people and privacy suppresses facial landmarks',()=>{
  const observation=fixtures('working').envelope.observation;
  observation.display={boxes:true,regions:false,keypoints:true};
  let result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation,{fresh:false});
  assert.equal(result.calls.filter(c=>c[0]==='arc'||c[0]==='fillText').length,0);
  result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation);
  const hidden=result.calls.filter(c=>c[0]==='arc').length;
  observation.privacy_applied=false;
  result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation);
  assert.equal(result.calls.filter(c=>c[0]==='arc').length-hidden,5);
});

test('live observations expire across version, camera and freshness changes',()=>{
  const {camera,envelope}=fixtures('working');
  assert.equal(currentObservation(camera,envelope),true);
  assert.equal(currentObservation(camera,{...envelope,fresh:false}),false);
  assert.equal(currentObservation({...camera,config_revision:camera.config_revision+1},envelope),false);
  assert.equal(currentObservation({...camera,stream_session_id:'new'},envelope),false);
  assert.equal(currentObservation({...camera,algorithm_error:'RuntimeError'},envelope),false);
});

test('pose canvas respects the effective keypoint threshold and legacy fallback',()=>{
  const observation=fixtures('working').envelope.observation;
  observation.display={boxes:false,regions:false,keypoints:true};
  observation.persons[0].upper_body_anchor=null;
  let result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation);
  const legacyPoints=result.calls.filter(c=>c[0]==='arc').length;
  assert.ok(legacyPoints>0);
  observation.detection={person_confidence:.1,keypoint_confidence:.99};
  result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation);
  assert.equal(result.calls.filter(c=>c[0]==='arc').length,0);
  observation.detection.keypoint_confidence=.9;
  result=canvasRecorder();
  drawResult(result.canvas,{naturalWidth:1280,naturalHeight:720},observation);
  assert.equal(result.calls.filter(c=>c[0]==='arc').length,legacyPoints);
});

test('station uses a gradient without a perimeter stroke',()=>{
 const observation=fixtures('working').envelope.observation;observation.display={boxes:false,station:true,seat:false,keypoints:false};
 observation.materials={enabled:false};const {canvas,calls}=canvasRecorder();drawResult(canvas,{naturalWidth:1280,naturalHeight:720},observation);
 assert.equal(calls.filter(c=>c[0]==='stroke').length,1); // compact label accent only
 assert.ok(calls.some(c=>c[0]==='fill'&&typeof c[1]==='object'));
});
