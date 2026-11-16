// Validates the JSON Schema subset used by this contract without adding dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixtures,systemMetricsFixture,settingsFixture} from '../mock.mjs';
const spec=JSON.parse(await readFile(new URL('../contracts/openapi-v1.json',import.meta.url)));
function validate(value,schema,label='root') {
  if(schema.$ref)return validate(value,spec.components.schemas[schema.$ref.split('/').at(-1)],label);
  if(schema.anyOf){assert.ok(schema.anyOf.some(s=>{try{validate(value,s,label);return true;}catch{return false;}}),`${label}: no anyOf match`);return;}
  if(schema.oneOf){assert.equal(schema.oneOf.filter(s=>{try{validate(value,s,label);return true;}catch{return false;}}).length,1,`${label}: expected one schema match`);return;}
  if(schema.const!==undefined)assert.deepEqual(value,schema.const,label);
  if(schema.enum)assert.ok(schema.enum.includes(value),`${label}: enum`);
  if(schema.type==='null'){assert.equal(value,null,label);return;}
  if(schema.type==='object'){
    assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),label);
    for(const key of schema.required||[])assert.ok(key in value,`${label}.${key}: required`);
    for(const [key,v] of Object.entries(value)){const s=schema.properties?.[key]||schema.additionalProperties;if(s&&typeof s==='object')validate(v,s,label+'.'+key);}
  } else if(schema.type==='array'){
    assert.ok(Array.isArray(value),label);
    if(schema.minItems!==undefined)assert.ok(value.length>=schema.minItems,label);
    if(schema.maxItems!==undefined)assert.ok(value.length<=schema.maxItems,label);
    value.forEach((v,i)=>validate(v,schema.items,`${label}[${i}]`));
  } else if(schema.type==='number'||schema.type==='integer'){
    assert.ok(typeof value==='number'&&Number.isFinite(value),label);
    if(schema.type==='integer')assert.ok(Number.isInteger(value),label);
    if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,label);
    if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,label);
  } else if(schema.type){assert.equal(typeof value,schema.type,label);}
  if(schema.pattern)assert.match(value,new RegExp(schema.pattern),label);
}
test('captured real responses agree with OpenAPI schemas',async()=>{
 for(const [file,schema] of [['camera.real.json','Camera'],['observations.real.json','ObservationEnvelope'],['work-status.real.json','WorkStatus']]){
  const value=JSON.parse(await readFile(new URL('../contracts/examples/'+file,import.meta.url)));validate(value,spec.components.schemas[schema],schema);
 }
});
test('every mock scenario agrees with the same production contract',()=>{
 validate(settingsFixture(),spec.components.schemas.DeviceSettings,'settings');
 validate(systemMetricsFixture(),spec.components.schemas.SystemMetrics,'systemMetrics');
 for(const name of ['idle','start','working','away','rest','done','unknown','offline','algorithm','moved','owner_return','assembly','assembly_alert','assembly_stale']){
  const f=fixtures(name);validate(f.camera,spec.components.schemas.Camera,name+'.camera');validate(f.work,spec.components.schemas.WorkStatus,name+'.work');validate(f.envelope,spec.components.schemas.ObservationEnvelope,name+'.observations');
 }
});
