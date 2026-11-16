import test from 'node:test';import assert from 'node:assert/strict';
import {productionView,reviewChoices} from '../public/production.js';
test('new production uses event total, never inventory or legacy total',()=>{
 assert.equal(productionView({}, {initial:10,cumulative:14,completed:12}).total,null);
 assert.equal(productionView({}, {production_basis:'completion_events_v1',production_total:4,initial:10}).total,4);
 const v=productionView({}, {production_basis:'completion_events_v1',production_total:4,available:false});
 assert.equal(v.total,4);assert.equal(v.fresh,false);
});
test('review actions distinguish uncertain arrival from an already counted abnormality',()=>{
 assert.deepEqual(reviewChoices({kind:'review',review_reason:'completion_unverified'}),[1,0]);
 assert.deepEqual(reviewChoices({kind:'review',review_reason:'counted_became_abnormal'}),[-1,0]);
 assert.deepEqual(reviewChoices({kind:'review',resolved:true}),[]);
});
