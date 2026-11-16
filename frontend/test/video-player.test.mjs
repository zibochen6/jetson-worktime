import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoPlayer} from '../public/video-player.js';
import {addressedAnswer} from '../public/video-player.js';
test('literal device access retains same-address UDP and TCP without changing unrelated SDP',()=>{
 const lan='a=candidate:1 1 udp 1 192.168.2.16 8189 typ host';
 const tcp='a=candidate:2 1 tcp 1 192.168.2.16 8189 typ host tcptype passive';
 const tail='a=candidate:3 1 udp 1 100.98.151.121 8189 typ host';
 const sdp=['v=0','a=ice-ufrag:abc',lan,tcp,tail,'a=end-of-candidates',''].join('\r\n');
 const local=addressedAnswer(sdp,'192.168.2.16');
 assert.ok(local.includes(lan)&&local.includes(tcp));assert.ok(!local.includes(tail));
 assert.ok(local.includes('a=ice-ufrag:abc')&&local.endsWith('a=end-of-candidates\r\n'));
 const remote=addressedAnswer(sdp,'100.98.151.121');assert.ok(remote.includes(tail)&&!remote.includes(lan));
 for(const host of ['localhost','jetson.tail.ts.net','10.0.0.9',undefined])assert.equal(addressedAnswer(sdp,host),sdp);
});
test('localhost Firefox keeps device interface candidates when loopback ICE is unavailable',()=>{
 const sdp=['v=0','a=candidate:1 1 udp 1 127.0.0.1 8189 typ host',
  'a=candidate:2 1 udp 1 192.168.2.16 8189 typ host',
  'a=candidate:3 1 tcp 1 192.168.2.16 8189 typ host tcptype passive',''].join('\r\n');
 for(const host of ['127.0.0.1','127.1.2.3','localhost','[::1]'])assert.equal(addressedAnswer(sdp,host),sdp);
 const lan=addressedAnswer(sdp,'192.168.2.16');assert.ok(!lan.includes('127.0.0.1'));assert.ok(lan.includes('192.168.2.16'));
});
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
 assert.deepEqual(p.displayQuality(),{samples:2,p95_ms:100,stalls_over_500ms:1,presented_fps:null,unobserved_frame_intervals:0});
 assert.equal(JSON.parse(video.dataset.displayQuality).stalls_over_500ms,1);
 const old=callbacks.shift();p.stop();old(1500);
 assert.equal(p.displayQuality().samples,0);
});

test('media freshness follows decoded frames and expires on stalls or stop',t=>{
 let now=0;const callbacks=[];
 t.mock.method(performance,'now',()=>now);
 const video={...media(),requestVideoFrameCallback(fn){callbacks.push(fn);return 1;},cancelVideoFrameCallback(){}};
 const player=new VideoPlayer(video,media(),()=>{});
 assert.equal(player.isFresh(),false);player.measureDisplay(player.generation);callbacks.shift()(0);
 now=1500;assert.equal(player.isFresh(),true);
 now=2500;assert.equal(player.isFresh(),false);
 callbacks.shift()(2500);assert.equal(player.isFresh(),true);
 player.stop();assert.equal(player.isFresh(),false);
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

test('skipped callbacks do not become fake video freezes',()=>{
 const callbacks=[],video={...media(),dataset:{},requestVideoFrameCallback(fn){callbacks.push(fn);return callbacks.length;},cancelVideoFrameCallback(){}};
 const p=new VideoPlayer(video,media(),()=>{});p.measureDisplay(p.generation);
 callbacks.shift()(0,{presentedFrames:1});callbacks.shift()(1000,{presentedFrames:16});callbacks.shift()(2000,{presentedFrames:31});
 assert.equal(p.displayQuality().presented_fps,15);assert.equal(p.displayQuality().p95_ms,null);
 assert.equal(p.displayQuality().stalls_over_500ms,null);assert.equal(p.displayQuality().unobserved_frame_intervals,28);p.stop();
});
test('long playback keeps a bounded, valid presentation sample window',()=>{
 const callbacks=[],video={...media(),dataset:{},requestVideoFrameCallback(fn){callbacks.push(fn);return 1;},cancelVideoFrameCallback(){}};
 const p=new VideoPlayer(video,media(),()=>{});p.measureDisplay(p.generation);
 for(let i=0;i<1300;i++)callbacks.shift()(i*50,{presentedFrames:i+1});
 assert.equal(p.displayQuality().p95_ms,50);assert.equal(p.displayQuality().presented_fps,20);assert.equal(p.displayQuality().samples,600);p.stop();
});

test('fallback stop explicitly cancels its server session',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push([url,options?.method]);return {ok:true}};
 const p=new VideoPlayer(media(),media(),()=>{});
 try{await p.start('en',false);const token=new URL(p.fallback.src,'http://localhost').searchParams.get('client_id');assert.match(token,/^[a-f0-9]{32}$/);p.stop();assert.ok(calls.some(([u,m])=>u==='/api/v1/video/sessions/'+token&&m==='DELETE'));}
 finally{p.stop();globalThis.fetch=original;}
});

test('background decoding pauses retain the peer and foreground gets a recovery grace period',async t=>{
 const oldPC=globalThis.RTCPeerConnection,oldFetch=globalThis.fetch,oldDocument=globalThis.document;
 let now=0,tick,plays=0;
 t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'setInterval',fn=>{tick=fn;return 1;});
 t.mock.method(globalThis,'clearInterval',()=>{});
 globalThis.document={hidden:false};
 globalThis.RTCPeerConnection=class{
  constructor(){this.iceGatheringState='complete';this.connectionState='connected';}
  addTransceiver(){return {receiver:{}};}
  async createOffer(){return {type:'offer',sdp:'offer'};}
  async setLocalDescription(offer){this.localDescription=offer;}
  async setRemoteDescription(){}
  async getStats(){return new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:0,timestamp:now}]]);}
  close(){this.connectionState='closed';}
 };
 globalThis.fetch=async()=>({ok:true,headers:new Map([['Location','/api/v1/video/sessions/test']]),text:async()=> 'answer'});
 const v={...media(),play:async()=>{plays++;}},p=new VideoPlayer(v,media(),()=>{});
 try{
  await p.start('zh-CN',true);const peer=p.pc,resource=p.resource,generation=p.generation;v.srcObject={};
  globalThis.document.hidden=true;p.visibilityChanged(true);now=60000;await tick();
  assert.equal(p.pc,peer);assert.equal(p.resource,resource);assert.equal(p.generation,generation);
  globalThis.document.hidden=false;p.visibilityChanged(false);now+=1000;await tick();
  assert.equal(p.pc,peer);assert.equal(p.resource,resource);assert.equal(plays,1);
  now+=5001;await tick();assert.equal(p.mode,'mjpeg');
 }finally{p.stop();globalThis.RTCPeerConnection=oldPC;globalThis.fetch=oldFetch;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('heartbeat failures do not discard live RTP, but expired sessions and missing frames reconnect',async t=>{
 const oldPC=globalThis.RTCPeerConnection,oldFetch=globalThis.fetch;
 let now=0,tick,frames=0,health='network';
 t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'setInterval',fn=>{tick=fn;return 1;});
 t.mock.method(globalThis,'clearInterval',()=>{});
 globalThis.RTCPeerConnection=class{
  constructor(){this.iceGatheringState='complete';this.connectionState='connected';}
  addTransceiver(){return {receiver:{}};}
  async createOffer(){return {type:'offer',sdp:'offer'};}
  async setLocalDescription(offer){this.localDescription=offer;}
  async setRemoteDescription(){}
  async getStats(){if(health==='stats-error')throw new Error('stats unavailable');return new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:frames,timestamp:now}]]);}
  close(){this.connectionState='closed';}
 };
 globalThis.fetch=async(url,options)=>{
  if(options?.method)return {ok:true,headers:new Map([['Location','/api/v1/video/sessions/test']]),text:async()=> 'answer'};
  if(health==='network')throw new TypeError('network error');
  return {ok:false,status:health==='expired'?404:503};
 };
 const p=new VideoPlayer(media(),media(),()=>{});
 try{
  await p.start('zh-CN',true);const peer=p.pc,generation=p.generation;
  now=6000;frames++;await tick();assert.equal(p.pc,peer);assert.equal(p.mode,'webrtc');
  now=12000;frames++;health='server';await tick();assert.equal(p.pc,peer);assert.equal(p.generation,generation);
  now=13000;health='stats-error';await tick();assert.equal(p.pc,peer);
  now=18000;frames++;health='expired';await tick();assert.equal(p.mode,'mjpeg');
  await p.start('zh-CN',true);health='stats-error';now=24000;await tick();assert.equal(p.mode,'mjpeg');
 }finally{p.stop();globalThis.RTCPeerConnection=oldPC;globalThis.fetch=oldFetch;}
});
