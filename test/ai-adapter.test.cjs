'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createAiAdapter,completionEndpoint,parseCandidate} = require('../core/ai-adapter.cjs');
const sample = { manifest:{id:'sample',version:'0.1.0',entry:'adapter.cjs',verification:'passed'}, files:[{path:'adapter.cjs',content:'throw new Error("This must not execute while generating");'}], capabilities:[],report:{summary:'Needs device connection',verification:'passed'} };
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'one4all-ai-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
test('normalizes compatible endpoints without losing custom URL prefixes',()=>{
  assert.equal(completionEndpoint('https://api.deepseek.com'),'https://api.deepseek.com/v1/chat/completions');
  assert.equal(completionEndpoint('http://127.0.0.1:1234/v1/'),'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(completionEndpoint('https://example.test/custom/chat/completions'),'https://example.test/custom/chat/completions');
  assert.equal(completionEndpoint('http://localhost:1234/custom/?api-version=2026-01'),'http://localhost:1234/custom/chat/completions?api-version=2026-01');
  assert.throws(()=>completionEndpoint('https://key@host/v1'));
});
test('persists encrypted credentials and exposes no API key from config()', t=>{
  const dir=root(t);
  const ai=createAiAdapter({dataRoot:dir,encryptString:value=>Buffer.from(value).map(byte=>byte^0x55),decryptString:value=>Buffer.from(value).map(byte=>byte^0x55).toString()});
  const result=ai.saveConfig({baseURL:'https://api.example.test/v1',model:'test',apiKey:'test-secret-key'});
  assert.equal(result.keyConfigured,true);assert.equal(result.apiKey,undefined);assert.equal(result.keyPersistence,'encrypted');
  assert.ok(!fs.readFileSync(path.join(dir,'ai-config.json'),'utf8').includes('test-secret-key'));
  ai.saveConfig({clearApiKey:true});assert.equal(ai.config().keyConfigured,false);
});
test('candidate files are saved without executing code, and verified claims are removed',async t=>{
  const dir=root(t);let request;
  const ai=createAiAdapter({dataRoot:dir,getPackageContext:()=>({evidenceStatus:'missing'}),fetchImpl:async (url,options)=>{request=JSON.parse(options.body);return {ok:true,status:200,text:async()=>JSON.stringify({model:'test',choices:[{message:{content:'```json\n'+JSON.stringify(sample)+'\n```'}}]})};}});
  ai.saveConfig({model:'test',apiKey:'session-secret'});
  const result=await ai.generate({packageId:'sample',context:'Exports have not been extracted.'});
  assert.equal(result.verification,'unverified');assert.equal(result.manifest.verification,'unverified');assert.equal(result.report.verification,'unverified');assert.equal(result.candidateReady,true);
  assert.ok(fs.existsSync(path.join(result.directory,'adapter.cjs')));
  assert.ok(request.messages[1].content.includes('missing'));
  assert.equal(ai.config().keyPersistence,'local');assert.equal(createAiAdapter({dataRoot:dir}).config().keyConfigured,true);
});

test('local credential fallback survives restart and preserves inaccessible encrypted settings',t=>{
  const dataRoot=root(t),ai=createAiAdapter({dataRoot,encryptString:()=>{throw Error('OS store unavailable');},decryptString:()=>''});
  ai.saveConfig({model:'fixture',apiKey:'local-fixture-key'});assert.equal(ai.config().keyPersistence,'local');assert.equal(createAiAdapter({dataRoot}).config().keyConfigured,true);
  const file=path.join(dataRoot,'ai-config.json');fs.writeFileSync(file,JSON.stringify({model:'fixture',encryptedKey:'keep-encrypted-value'}));
  createAiAdapter({dataRoot}).saveConfig({model:'updated'});assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).encryptedKey,'keep-encrypted-value');
});
test('model paths cannot escape the candidate directory or pretend missing entries exist',()=>{
  for(const p of ['../outside.cjs','C:/outside.cjs','nested/../../outside.cjs','foo\\bar.cjs']) assert.throws(()=>parseCandidate(JSON.stringify({...sample,files:[{path:p,content:''}]})));
  assert.throws(()=>parseCandidate(JSON.stringify({...sample,files:[{path:'helper.js',content:''}]})),/入口/);
  const report=parseCandidate(JSON.stringify({...sample,files:[]})); assert.equal(report.candidateReady,false);
});

test('text helpers and ESM entries are accepted without a filename or keyword denylist',()=>{
  const candidate=parseCandidate(JSON.stringify({...sample,manifest:{entry:'adapter.mjs'},files:[{path:'adapter.mjs',content:'import fs from "node:fs"; export const createAdapter=()=>{};'},...Array.from({length:45},(_,i)=>({path:'native/helper-'+i+'.py',content:'import subprocess\n# protocol token and secret fields'}))]}));
  assert.equal(candidate.candidateReady,true);assert.equal(candidate.files.length,46);
});

test('generation has no built-in deadline, cancellation releases it, and another attempt succeeds',async t=>{
  let count=0,signal;
  t.mock.method(AbortSignal,'timeout',()=>{throw Error('A fixed deadline must not be installed');});
  const ai=createAiAdapter({dataRoot:root(t),fetchImpl:async(_url,options)=>{count++;signal=options.signal;if(count===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(sample)}}]})};}});
  ai.saveConfig({model:'fixture'});
  const pending=ai.generate({packageId:'sample'});const rejected=assert.rejects(pending,/取消/);await new Promise(setImmediate);
  assert.equal(signal.aborted,false);assert.equal(ai.cancelGeneration().cancelled,true);await rejected;
  assert.equal((await ai.generate({packageId:'sample'})).candidateReady,true);assert.equal(ai.cancelGeneration().cancelled,false);
});

test('cancel during package inspection stops generation before contacting the model',async t=>{
  let inspectSignal,resolveContext,calls=0;
  const ai=createAiAdapter({dataRoot:root(t),getPackageContext:(_id,{signal})=>{inspectSignal=signal;return new Promise(resolve=>resolveContext=resolve);},fetchImpl:()=>{calls++;throw Error('No model request');}});
  ai.saveConfig({model:'fixture'});const pending=ai.generate({packageId:'sample'}),rejected=assert.rejects(pending,/取消/);
  ai.cancelGeneration();await rejected;assert.equal(inspectSignal.aborted,true);resolveContext({});await new Promise(setImmediate);assert.equal(calls,0);
});

test('user context is preserved; output limits are optional and truncation has an actionable error',async t=>{
  const requests=[];let limited=false;
  const ai=createAiAdapter({dataRoot:root(t),fetchImpl:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:limited?'length':'stop',message:{content:limited?'{':JSON.stringify(sample)}}]})};}});
  ai.saveConfig({model:'fixture'});const context='x'.repeat(170000),instructions='y'.repeat(13000);
  await ai.generate({packageId:'sample',context,instructions});assert.equal(Object.hasOwn(requests[0],'max_tokens'),false);assert.equal(JSON.parse(requests[0].messages[1].content).userContext,context);assert.equal(JSON.parse(requests[0].messages[1].content).instructions,instructions);
  ai.saveConfig({maxOutputTokens:32000});limited=true;await assert.rejects(ai.generate({packageId:'sample'}),/输出达到服务端长度上限/);assert.equal(requests[1].max_tokens,32000);assert.equal(ai.config().maxOutputTokens,32000);
  ai.saveConfig({maxOutputTokens:''});assert.equal(ai.config().maxOutputTokens,null);
});
