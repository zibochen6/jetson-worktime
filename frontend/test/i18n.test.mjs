import test from 'node:test';
import assert from 'node:assert/strict';
import {messages, tr, errorDetails} from '../public/i18n.js';
import {pipelineState} from '../public/pipeline.js';
import {fixtures} from '../mock.mjs';
import {readFile} from 'node:fs/promises';

test('all translation entries have both languages and matching placeholders', async () => {
  for (const [key, values] of Object.entries(messages)) {
    assert.ok(values['zh-CN'] && values.en, key);
    const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(parameters(values['zh-CN']), parameters(values.en), key);
  }
  for (const file of ['index.html','settings.html','main.js','settings.js','roi-editor.js']) {
    const source = await readFile(new URL('../public/'+file,import.meta.url),'utf8');
    const keys = [...source.matchAll(/data-i18n(?:-aria-label|-title|-alt)?="([^"]+)"|(?:tr|text|message|LocalizedError)\([^\n]*?'((?:app|nav|roi|privacy|session|pipeline|config|camera|video|error|help|state|timing|display|actions|v4)\.[a-zA-Z]+)'/g)];
    for (const match of keys) assert.ok(messages[match[1] || match[2]], file+' '+(match[1]||match[2]));
  }
  assert.equal(tr('roi.bounds',{region:'seat'},'en'),'Presence zone has coordinates outside the image');
  assert.equal(tr('session.autoStart',{seconds:10},'en'),'Starts after 10 seconds of continuous presence');
  assert.equal(errorDetails({code:'SETTINGS_CONFLICT'}).key,'error.SETTINGS_CONFLICT');
  assert.equal(errorDetails({message_key:'missing'}).key,'error.generic');
});

test('pipeline maps normal states, provisional absence and completed sessions', () => {
  const expected={idle:'idle',start:'start',working:'working',away:'pause',rest:'pause',done:'done',unknown:null,offline:null,algorithm:null,moved:null};
  for (const [name,phase] of Object.entries(expected)) {
    const data=fixtures(name);
    assert.equal(pipelineState(data.camera,data.work).phase,phase,name);
  }
  const data=fixtures('done');
  assert.equal(pipelineState({...data.camera,status:'reconnecting'},data.work).phase,null);
  assert.equal(pipelineState(data.camera,{...data.work,state:'START_PENDING'}).phase,'start');
});
