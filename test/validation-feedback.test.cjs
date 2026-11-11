'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createValidationFeedback} = require('../core/validation-feedback.cjs');
const sample = {model:{id:'logitech-g502-test',name:'G502',brand:'logitech',support:{provider:'hidpp'},serial:'PRIVATE_SERIAL',path:'PRIVATE_HID_PATH'},providerVersion:'hidpp-0.1',checks:['dpi','pollRate'],hardwareConfirmed:true};
function root(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-validation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const cryptoCallbacks = {encryptString:value=>Buffer.from(value).map(byte=>byte^0x55),decryptString:value=>Buffer.from(value).map(byte=>byte^0x55).toString()};
test('requires actual hardware declaration and selected features; public report omits device identity',t=>{
  const service=createValidationFeedback({dataRoot:root(t)});
  assert.throws(()=>service.prepare({...sample,hardwareConfirmed:false}),/实物/);
  assert.throws(()=>service.prepare({...sample,checks:['inventedFeature']}),/至少一项/);
  assert.throws(()=>service.prepare({...sample,providerVersion:''}),/版本/);
  const report=service.prepare({...sample,notes:'token: ghp_12345678 序列号: private123 C:\\Users\\private\\device.log'});
  assert.equal(report.modelId,sample.model.id);assert.deepEqual(report.checks,['dpi','pollRate']);
  for(const secret of ['PRIVATE_SERIAL','PRIVATE_HID_PATH','private123','ghp_12345678','C:\\Users']) assert.ok(!report.body.includes(secret),secret);
  assert.match(report.body,/其他型号及未测试的功能仍待验证/);
  assert.match(report.body,/支持库型号 ID/);
});
test('without token opens a prefilled browser issue, never reports it submitted or calls API',async t=>{
  const opened=[];
  const service=createValidationFeedback({dataRoot:root(t),openExternal:async url=>opened.push(url),fetchImpl:()=>{throw Error('Must not POST');}});
  const report=service.prepare(sample),result=await service.submit(report.id);
  assert.equal(result.submitted,false);assert.equal(result.mode,'browser');assert.equal(opened.length,1);
  const url=new URL(opened[0]);assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/YuYiChyan/One4All/issues/new');assert.equal(url.searchParams.get('body'),report.body);
  assert.deepEqual(service.list(),[]);
});
test('encrypted token stays out of public configuration, reports, and plaintext disk',t=>{
  const dir=root(t),service=createValidationFeedback({dataRoot:dir,...cryptoCallbacks});
  service.saveConfig({token:'arbitrary-secret-value'});
  assert.deepEqual(service.config(),{repository:'YuYiChyan/One4All',tokenConfigured:true,tokenPersistence:'encrypted'});
  assert.ok(!fs.readFileSync(path.join(dir,'validation-config.json'),'utf8').includes('arbitrary-secret-value'));
  assert.ok(!service.prepare({...sample,notes:'arbitrary-secret-value'}).body.includes('arbitrary-secret-value'));
  const restored=createValidationFeedback({dataRoot:dir,...cryptoCallbacks});assert.equal(restored.config().tokenConfigured,true);
  restored.saveConfig({clearToken:true});assert.equal(restored.config().tokenConfigured,false);
  const session=createValidationFeedback({dataRoot:dir});session.saveConfig({token:'session-secret'});
  assert.equal(session.config().tokenPersistence,'session');assert.ok(!fs.readFileSync(path.join(dir,'validation-config.json'),'utf8').includes('session-secret'));
});
test('a confirmed report posts once even across parallel clicks or restart; forged bodies are ignored',async t=>{
  const dir=root(t);let requests=0,posted;
  const fetchImpl=async(url,options)=>{requests++;posted=JSON.parse(options.body);assert.equal(url,'https://api.github.com/repos/YuYiChyan/One4All/issues');assert.equal(options.method,'POST');return {status:201,json:async()=>({number:72,html_url:'https://github.com/YuYiChyan/One4All/issues/72'})};};
  const service=createValidationFeedback({dataRoot:dir,...cryptoCallbacks,fetchImpl});service.saveConfig({token:'test-token'});
  const report=service.prepare(sample);
  const results=await Promise.all([service.submit({...report,body:'FORGED'}),service.submit(report.id)]);
  assert.equal(requests,1);assert.equal(posted.body,report.body);assert.equal(results[0].submitted,true);assert.equal(service.list()[0].url,results[0].url);
  const next=createValidationFeedback({dataRoot:dir,...cryptoCallbacks,fetchImpl});const repeated=await next.submit(next.prepare(sample));
  assert.equal(repeated.duplicate,true);assert.equal(requests,1);assert.equal(repeated.modelId,sample.model.id);
});
test('permission errors are actionable and do not mark the report verified',async t=>{
  const service=createValidationFeedback({dataRoot:root(t),fetchImpl:async()=>({status:401})});service.saveConfig({token:'invalid-token'});
  await assert.rejects(service.submit(service.prepare(sample)),/登录凭据无效/);
  assert.equal(service.list()[0].submitted,false);assert.equal(service.list()[0].status,'failed');
});
test('uncertain network result prevents an accidental duplicate POST',async t=>{
  let requests=0;
  const service=createValidationFeedback({dataRoot:root(t),fetchImpl:async()=>{requests++;throw Error('timeout');}});service.saveConfig({token:'test-token'});
  const report=service.prepare(sample);
  await assert.rejects(service.submit(report),/避免重复提交/);
  const next=await service.submit(report);assert.equal(next.status,'uncertain');assert.equal(next.submitted,false);assert.equal(requests,1);
});

test('repository migration retains legacy history and account settings without replaying old pending feedback',async t=>{
  for(const status of ['pending','uncertain','submitted','failed']){
    const dir=root(t),configFile=path.join(dir,'validation-config.json'),receiptsFile=path.join(dir,'validation-receipts.json');
    const existingToken='existing-user-token';
    fs.writeFileSync(configFile,JSON.stringify({encryptedToken:cryptoCallbacks.encryptString(existingToken).toString('base64')}));
    const preservedFiles={
      'validation-config.json':fs.readFileSync(configFile,'utf8'),
      'local-verifications.json':JSON.stringify({schema:1,records:[{modelId:sample.model.id,confirmed:true}]}),
      'verification-server-config.json':JSON.stringify({baseURL:'https://verification.example.test/'}),
      'verification-server-state.json':JSON.stringify({cursor:'keep-existing-cursor',records:[]})
    };
    for(const [name,contents]of Object.entries(preservedFiles))fs.writeFileSync(path.join(dir,name),contents);
    const oldReport={modelId:sample.model.id,modelName:sample.model.name,brand:sample.model.brand,provider:'hidpp',providerVersion:sample.providerVersion,firmware:'',checks:['dpi','pollRate'],notes:''};
    const oldId=crypto.createHash('sha256').update(JSON.stringify(oldReport)).digest('hex');
    const oldReceipt={id:oldId,modelId:sample.model.id,modelName:sample.model.name,providerVersion:sample.providerVersion,checks:['dpi','pollRate'],createdAt:'2026-10-01T00:00:00.000Z',mode:'api',submitted:status==='submitted',status,url:'https://github.com/YuYiChyan/MCHOUSE_for_all/issues'+(status==='submitted'?'/41':'')};
    fs.writeFileSync(receiptsFile,JSON.stringify([oldReceipt],null,2));const originalReceipts=fs.readFileSync(receiptsFile,'utf8');
    let posts=0;
    const service=createValidationFeedback({dataRoot:dir,...cryptoCallbacks,fetchImpl:async(url,options)=>{
      posts++;assert.equal(url,'https://api.github.com/repos/YuYiChyan/One4All/issues');
      assert.equal(options.headers.Authorization,'Bearer '+existingToken);
      return {status:201,json:async()=>({number:42,html_url:'https://github.com/YuYiChyan/One4All/issues/42'})};
    }});
    assert.equal(service.config().tokenConfigured,true);
    assert.equal(service.list()[0].repository,'YuYiChyan/MCHOUSE_for_all');
    assert.equal(service.list()[0].status,status);
    assert.equal(fs.readFileSync(receiptsFile,'utf8'),originalReceipts,'Loading must not rewrite legacy receipts');
    await assert.rejects(service.submit(oldId),/预览已失效/);
    const report=service.prepare(sample);assert.notEqual(report.id,oldId,'New repository must have a separate report fingerprint');
    assert.equal(report.repository,'YuYiChyan/One4All');assert.equal(posts,0,'Migration and preview must not submit anything');
    const result=await service.submit(report.id);assert.equal(result.repository,'YuYiChyan/One4All');assert.equal(result.submitted,true);assert.equal(posts,1);
    const saved=JSON.parse(fs.readFileSync(receiptsFile,'utf8'));assert.equal(saved.length,2);
    assert.deepEqual(saved.find(receipt=>receipt.id===oldId),oldReceipt,'Old receipt must remain intact');
    const restarted=createValidationFeedback({dataRoot:dir,...cryptoCallbacks,fetchImpl:()=>{throw Error('Duplicate after restart');}});
    const duplicate=await restarted.submit(restarted.prepare(sample));assert.equal(duplicate.duplicate,true);assert.equal(duplicate.url,result.url);
    for(const [name,contents]of Object.entries(preservedFiles))assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),contents,name+' must be preserved');
  }
});

test('a response pointing to the old project is never accepted as a new-project receipt',async t=>{
  let posts=0;
  const service=createValidationFeedback({dataRoot:root(t),fetchImpl:async()=>{posts++;return {status:201,json:async()=>({number:91,html_url:'https://github.com/YuYiChyan/MCHOUSE_for_all/issues/91'})};}});
  service.saveConfig({token:'fixture-token'});const report=service.prepare(sample);
  await assert.rejects(service.submit(report),/报告链接不完整/);
  const receipt=service.list()[0];assert.equal(receipt.repository,'YuYiChyan/One4All');assert.equal(receipt.status,'uncertain');assert.equal(receipt.submitted,false);
  await service.submit(report);assert.equal(posts,1);
});
