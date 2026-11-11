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
