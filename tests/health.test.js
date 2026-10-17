
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHealth, adjustHealth } from '../src/model.js';
import { validateBarFile } from '../src/images.js';
import { JSDOM } from 'jsdom';
import { renderOverlay } from '../shared.js';
test('overflow converts to extra, damage consumes extra first, healing preserves it',()=>{
 assert.deepEqual(normalizeHealth(120,100,5),{hp:100,extra_hp:25});
 assert.deepEqual(adjustHealth(40,100,20,-5),{hp:40,extra_hp:15});
 assert.deepEqual(adjustHealth(40,100,2,-5),{hp:37,extra_hp:0});
 assert.deepEqual(adjustHealth(40,100,20,5),{hp:45,extra_hp:20});
});
test('bar upload validates dimensions and releases decoded bitmap',async t=>{
 let closed=0;
 const original=globalThis.createImageBitmap;
 t.after(()=>{globalThis.createImageBitmap=original;});
 globalThis.createImageBitmap=async()=>({width:100,height:100,close(){closed++;}});
 await assert.rejects(validateBarFile({type:'image/png',size:10}),/2172/);
 globalThis.createImageBitmap=async()=>({width:2172,height:724,close(){closed++;}});
 await validateBarFile({type:'image/png',size:10});
 assert.equal(closed,2);
 await assert.rejects(validateBarFile({type:'image/svg+xml',size:10}),/PNG/);
});
test('OBS renders custom frame and separate extra health without filling regular health',()=>{
 const doc=new JSDOM('<main></main>').window.document, root=doc.querySelector('main');
 renderOverlay(root,{name:'A',hp:40,max_hp:100,extra_hp:20,bar:'Personalizada',custom_bar:'https://example.test/bar.png',images:{},name_size:25,show_hp:true});
 assert.equal(root.querySelector('.bar-fill').style.width,'40%');
 assert.equal(root.querySelector('.extra-fill').style.width,'20%');
 assert.equal(root.querySelector('.bar-frame').src,'https://example.test/bar.png');
 assert.match(root.querySelector('.obs-extra').textContent,/20/);
});
