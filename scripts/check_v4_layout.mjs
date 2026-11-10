/** Browser acceptance helper. Pass an existing ego-browser Page. No backend writes. */
export async function checkV4Layout(p, {base = 'http://192.168.2.16:8088'} = {}) {
await p.goto(base);
const rows=[];
for(const [width,height] of [[1920,1080],[1600,900],[1440,900],[1366,768],[1024,600],[768,1024]]) {
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 for(const lang of ['zh-CN','en']) {
  await p.click('.header [data-language="'+lang+'"]');
  for(const mode of ['standard','showcase']) {
   if(await p.evaluate(()=>document.body.dataset.mode)!==mode) await p.click('#modeToggle');
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   rows.push(await p.evaluate(({width,height,lang,mode})=>{
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}};
    const issues=[];
    const v=document.querySelector('#viewport'),card=document.querySelector('.video-card');
    if(box(v).h<box(card).h*.55)issues.push('video too small');
    const feed=document.querySelector('#feed');
    if(feed.naturalWidth>0 && Math.abs(box(v).w-box(v).h*feed.naturalWidth/feed.naturalHeight)>2)issues.push('video frame does not match source aspect');
    if(getComputedStyle(feed).objectFit!=='contain')issues.push('camera image may be cropped');
    if(box(document.querySelector('.video-hud')).h>40)issues.push('video header too tall');
    const ids=['modeToggle','workState','workTime','more','pipeline','inputInfo','sessionScope'];
    if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)issues.push('page overflow');
    for(const id of ids){const e=document.getElementById(id),r=box(e);if(getComputedStyle(e).display==='none')continue;if(r.r>innerWidth+1||r.b>innerHeight+1||r.x<0||r.y<0)issues.push(id+' outside viewport');}
    const side=document.querySelector('.session-card'),foot=document.querySelector('.session-footer');
    if(box(foot).b>box(side).b+1)issues.push('session overflow');
    const timer=document.querySelector('.timer-card');if(timer.scrollHeight>timer.clientHeight+2)issues.push('timer clipped');
    const bottom=document.querySelector('.bottom-panel');
    if(bottom.scrollHeight>bottom.clientHeight+2)issues.push('bottom panel clipped');
    const brand=document.querySelector('.header-actions');if(box(brand).r>innerWidth)issues.push('header overflow');
    if(mode==='standard') {
     const settings=document.getElementById('settingsToggle'),r=box(settings);if(r.b>innerHeight||r.x<0||r.w===0)issues.push('settings unavailable');
     const more=document.getElementById('more'),r2=more.getBoundingClientRect(),hit=document.elementFromPoint(r2.x+r2.width/2,r2.y+r2.height/2);if(!more.contains(hit))issues.push('more occluded');
    }
    return {width,height,lang,mode,viewport:[innerWidth,innerHeight],issues,video:box(document.getElementById('viewport')),session:box(side),footer:box(foot)};
   },{width,height,lang,mode}));
  }
 }
}
return rows;
}
