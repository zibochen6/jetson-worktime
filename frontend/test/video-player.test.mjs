import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoPlayer} from '../public/video-player.js';
function media(){return {hidden:false,srcObject:null,removeAttribute(name){delete this[name];}};}
test('fallback is bounded to one connection and stop clears both media elements',async()=>{
 const video=media(),image=media(),events=[];
 const player=new VideoPlayer(video,image,(...value)=>events.push(value));
 await player.start('en',false);
 assert.equal(player.mode,'mjpeg');
 assert.match(image.src,/lang=en/);
 const first=image.src;
 player.useFallback(player.generation);
 assert.equal(image.src,first);
 player.stop();
 assert.equal(image.src,undefined);
 assert.equal(video.srcObject,null);
 assert.equal(player.mode,'idle');
});
test('stale connection callbacks cannot replace a newer language stream',async()=>{
 const player=new VideoPlayer(media(),media(),()=>{});
 await player.start('zh-CN',false);
 const old=player.generation;
 await player.start('en',false);
 player.useFallback(old);
 assert.match(player.fallback.src,/lang=en/);
 player.stop();
});
test('localhost and private LAN use HD while Tailscale uses fluent video',async()=>{
 const {videoProfile}=await import('../public/video-player.js');
 for(const host of ['localhost','127.0.0.1','[::1]','192.168.34.47','10.0.0.2','172.16.2.1'])assert.equal(videoProfile(host),'local',host);
 for(const host of ['100.98.151.121','172.32.1.1','example.com'])assert.equal(videoProfile(host),'remote',host);
});
test('display diagnostics measure rendered frames and discard old callbacks on stop',()=>{
 const callbacks=[];
 const video={...media(),dataset:{},requestVideoFrameCallback(fn){callbacks.push(fn);return callbacks.length;},cancelVideoFrameCallback(){}};
 const p=new VideoPlayer(video,media(),()=>{});
 p.measureDisplay(p.generation);
 callbacks.shift()(0);callbacks.shift()(100);callbacks.shift()(800);
 assert.deepEqual(p.displayQuality(),{samples:2,p95_ms:100,stalls_over_500ms:1});
 assert.equal(JSON.parse(video.dataset.displayQuality).stalls_over_500ms,1);
 const old=callbacks.shift();p.stop();old(1500);
 assert.equal(p.displayQuality().samples,0);
});

test('collection preview uses overlay-free fallback and HD LAN and compressed Tailscale profiles',async()=>{
 const {captureVideoProfile}=await import('../public/video-player.js');
 for(const host of ['localhost','127.0.0.1','[::1]','192.168.2.16','10.0.0.3','172.16.2.1','jetson.local','example.com'])assert.equal(captureVideoProfile(host),'local');
 for(const host of ['100.98.151.121','100.64.0.1','100.127.255.254','jetson.tail123.ts.net'])assert.equal(captureVideoProfile(host),'remote');
 const p=new VideoPlayer(media(),media(),()=>{},{raw:true,adaptive:true});
 await p.start('en',false,captureVideoProfile('100.98.151.121'));
 assert.match(p.fallback.src,/^\/api\/v1\/video.mjpg\?profile=remote/);assert.doesNotMatch(p.fallback.src,/stream\.mjpg|lang=/);p.stop();
});

test('raw WebRTC negotiates the dedicated stream and applies bounded receiver buffering',async()=>{
 const oldPC=globalThis.RTCPeerConnection,oldFetch=globalThis.fetch;let requested,receiver={jitterBufferTarget:null};
 globalThis.RTCPeerConnection=class{
  constructor(){this.iceGatheringState='complete';this.connectionState='new';}
  addTransceiver(){return {receiver};}
  async createOffer(){return {type:'offer',sdp:'offer'};}
  async setLocalDescription(offer){this.localDescription=offer;}
  async setRemoteDescription(answer){this.remote=answer;}
  close(){this.connectionState='closed';}
 };
 globalThis.fetch=async(url,options)=>{if(options.method==='POST')requested=url;return {ok:true,headers:new Map([['Location','/api/v1/video/sessions/abc']]),text:async()=> 'answer'};};
 const p=new VideoPlayer(media(),media(),()=>{},{raw:true});
 try{await p.start('zh-CN',true,'remote');assert.equal(requested,'/api/v1/video/whep/raw?profile=remote');assert.equal(receiver.jitterBufferTarget,100);}
 finally{p.stop();globalThis.RTCPeerConnection=oldPC;globalThis.fetch=oldFetch;}
});
