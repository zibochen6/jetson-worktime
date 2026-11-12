/** Read-only deployment check. No work actions or settings are written. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.argv[2] || 'http://192.168.2.16:8088';
const assets=['index.html','main.css','main.js','api.js','locales.json','settings.css','settings.js','i18n.js','overlay.js','overlay-style.json','roi-editor.js','studio.js','studio.css','annotation.js'];
for(const name of assets){
 const path=name==='index.html'?'/':'/'+name;
 const response=await fetch(base+path,{cache:'no-store',signal:AbortSignal.timeout(8000)});
 assert.equal(response.status,200,path);
 assert.equal(await response.text(),await readFile(new URL('../frontend/public/'+name,import.meta.url),'utf8'),name+' differs from source');
}
const html=await readFile(new URL('../frontend/public/index.html',import.meta.url),'utf8');
for(const id of ['settingsToggle','settingsDialog','modeToggle','pipeline','statsDialog','healthFps'])assert.ok(html.includes('id="'+id+'"'),id);
for(const match of html.matchAll(/src="data:image\/webp;base64,([A-Za-z0-9+/=]+)"/g)){
 const image=Buffer.from(match[1],'base64');assert.equal(image.toString('ascii',0,4),'RIFF');assert.equal(image.toString('ascii',8,12),'WEBP');
}
const settings=await(await fetch(base+'/api/v1/settings')).json();
console.log(JSON.stringify({status:'PASS',canonicalHome:true,assets:assets.length,revision:settings.revision,roiConfigured:settings.roi_configured,privacy:settings.privacy.enabled}));
