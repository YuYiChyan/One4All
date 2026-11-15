'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createContext}=require('../scripts/official-via-assets.cjs');
test('official VIA resources above ten MiB are accepted when their contents are valid',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'o4-via-resources-')),original=globalThis.fetch,bytes=Buffer.from(JSON.stringify({description:'x'.repeat(10*1024*1024+1)}));t.after(()=>{globalThis.fetch=original;fs.rmSync(root,{recursive:true,force:true});});globalThis.fetch=async()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}});
 const context=createContext('keychron',{outputRoot:root});const result=await context.load('https://vendor.example/definition.json','definition.json',{validate:data=>JSON.parse(data).description.length>10*1024*1024});assert.equal(result.length,bytes.length);assert.equal(fs.statSync(path.join(root,'source/definition.json')).size,bytes.length);await assert.rejects(context.load('https://vendor.example/definition.json','../../outside.json'),/路径/);
});
test('a valid updated FGG product image is accepted and its actual digest is recorded',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'o4-fgg-resources-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6s2EAAAAASUVORK5CYII=','base64'),digest=crypto.createHash('sha256').update(png).digest('hex');let calls=0;
 const {extract}=require('../scripts/extract-fgg-assets.cjs'),result=await extract({outputRoot:root,fetchImpl:async()=>{calls++;return new Response(png,{headers:{'content-type':'application/octet-stream'}});}});assert.equal(result.devices.length,10);assert.equal(calls,4);assert.ok(result.devices.every(d=>d.variants.every(v=>v.sha256===digest&&fs.readFileSync(v.imagePath).equals(png))));assert.ok(result.devices.every(d=>d.support.hardwareVerified===false));
});
