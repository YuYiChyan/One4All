'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createPackageManager, checkedUrl, sourceFor } = require('../core/vendor-packages.cjs');

const entry = { id:'sample', name:'Sample', homepage:'https://vendor.example/', source:{type:'official', url:'https://vendor.example/setup.exe', filename:'setup.exe', format:'exe', allowedHosts:['vendor.example']}, installedExecutables:[] };
function fixture(t, overrides = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(),'one4all-packages-'));
  t.after(() => fs.rmSync(dataRoot, { recursive:true, force:true }));
  return { dataRoot, manager:createPackageManager({ dataRoot, entries:[entry], ...overrides }) };
}
test('official sources take precedence without blocking changed public CDN hosts or ports', () => {
  assert.equal(checkedUrl('https://files.xiberia.net:9443/driver.exe',['files.xiberia.net:9443']).port,'9443');
  assert.equal(checkedUrl('https://files.xiberia.net:9444/driver.exe',['files.xiberia.net:9443']).port,'9444');
  assert.equal(sourceFor({...entry,adapter:{type:'github'}}).type,'official');
  assert.equal(checkedUrl(entry.source.url,['vendor.example']).hostname,'vendor.example');
  for (const url of ['https://new-cdn.example/setup.exe','http://vendor.example/setup.exe','https://vendor.example:8443/setup.exe']) assert.ok(checkedUrl(url,['vendor.example']));
  for (const url of ['file:///C:/setup.exe','data:text/plain,MZ','https://user:pw@vendor.example/setup.exe']) {
    assert.throws(()=>checkedUrl(url,['vendor.example']));
  }
  assert.equal(sourceFor({source:{type:'github',url:'https://github.com/o/r/releases/latest/download/a.zip'}}).type,'github');
});
test('a supplied SHA remains a data check while GitHub latest downloads do not require a pin',async t=>{
 const latest={...entry,source:{...entry.source,type:'github',url:'https://github.com/o/r/releases/latest/download/setup.exe'}},bytes=Buffer.from('MZ-current'),transport=async url=>({url,total:bytes.length,stream:Readable.from([bytes])});
 const {manager}=fixture(t,{entries:[latest],transport});assert.equal((await manager.download('sample')).downloaded,true);
 const mismatch=fixture(t,{entries:[{...latest,source:{...latest.source,sha256:'0'.repeat(64)}}],transport});await assert.rejects(mismatch.manager.download('sample'),/版本.*不一致/);assert.equal(mismatch.manager.status('sample').downloaded,false);
});

test('force download refreshes cached bytes, transient network failures retry, and cancellation can be retried',async t=>{
 let calls=0,blocked=false;
 const {manager}=fixture(t,{retryDelayMs:0,transport:async(url,_hosts,signal)=>{calls++;if(calls===1)throw Object.assign(Error('connection reset'),{code:'ECONNRESET'});if(blocked)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));const bytes=Buffer.from('MZ-'+calls);return {url,stream:Readable.from([bytes]),total:bytes.length};}});
 await manager.download('sample');assert.equal(calls,2);await manager.download('sample');assert.equal(calls,2);await manager.download('sample',{force:true});assert.equal(calls,3);blocked=true;const pending=manager.download('sample',{force:true});const rejected=assert.rejects(pending,/取消/);assert.equal(manager.cancel('sample').cancelled,true);await rejected;assert.equal(manager.status('sample').state,'cancelled');blocked=false;await manager.download('sample',{force:true});assert.equal(manager.status('sample').state,'downloaded');assert.equal(manager.cancel('sample').cancelled,false);
});

test('ZIP installers can be renamed or deeply nested, and ambiguous entries can be chosen or browsed',async t=>{
 const zip={...entry,installerNamePattern:'^setup\\.exe$',source:{...entry.source,url:'https://vendor.example/package.zip',filename:'package.zip',format:'zip'}},raw=Buffer.from([0x50,0x4b,3,4]),opened=[],scenarios=[['renamed.exe'],['a.exe','b.exe'],['a.exe','b.exe'],[]];let current=0,choiceCalls=0;
 const {dataRoot,manager}=fixture(t,{entries:[zip],transport:async url=>({url,total:raw.length,stream:Readable.from([raw])}),openPath:async file=>{opened.push(file);return '';},chooseInstaller:async files=>{choiceCalls++;return current===2?files[1]:null;},runFile:async(_cmd,args,options)=>{assert.equal(options.timeout,undefined);const script=Buffer.from(args.at(-1),'base64').toString('utf16le'),folder=script.match(/-DestinationPath '([^']+)'/)[1];fs.rmSync(folder,{recursive:true,force:true});const deep=path.join(folder,'one/two/three/four/five');fs.mkdirSync(deep,{recursive:true});for(const name of scenarios[current++])fs.writeFileSync(path.join(deep,name),'MZ-test');}});
 await manager.download('sample');assert.equal((await manager.install('sample')).installerStarted,true);assert.ok(opened[0].endsWith('renamed.exe'));assert.equal(choiceCalls,0);
 assert.equal((await manager.install('sample')).installerStarted,true);assert.ok(opened[1].endsWith('b.exe'));
 assert.equal((await manager.install('sample')).cancelled,true);assert.equal(opened.length,2);
 const folder=await manager.install('sample');assert.equal(folder.folderOpened,true);assert.equal(folder.installerStarted,false);assert.ok(folder.directory.startsWith(dataRoot));
});
test('download is deduplicated, records exact bytes, and does not install or declare an adapter', async t => {
  let calls = 0, launches = 0;
  const data = Buffer.from('MZ-fixture-installer');
  const { manager } = fixture(t, { transport:async url => { calls++; return {stream:Readable.from([data]),total:data.length,url}; }, openPath:async()=>{launches++;return '';} });
  const a = manager.download('sample'), b = manager.download('sample');
  assert.equal(a,b); await Promise.all([a,b]);
  const result = manager.status('sample');
  assert.equal(calls,1); assert.equal(result.downloaded,true); assert.equal(result.installed,false);
  assert.equal(result.adapterReady,false); assert.equal(result.bytes,data.length); assert.equal(launches,0);
  const installation = await manager.install('sample');
  assert.equal(launches,1); assert.equal(installation.installerStarted,true); assert.equal(installation.installed,false);
  await manager.download('sample'); assert.equal(calls,1);
});
test('HTML error responses and truncated packages remain unavailable for installation', async t => {
  let launches = 0;
  const { manager } = fixture(t, { transport:async url=>({stream:Readable.from(['<html>error</html>']),total:null,url}),openPath:async()=>{launches++;return '';} });
  await assert.rejects(manager.download('sample'),/Windows/);
  assert.equal(manager.status('sample').downloaded,false);
  await assert.rejects(manager.install('sample'),/请先下载/); assert.equal(launches,0);
});
test('a changed downloaded file cannot be launched; an unknown id is rejected', async t => {
  const data = Buffer.from('MZ-one');
  const { manager } = fixture(t, { transport:async url=>({stream:Readable.from([data]),total:data.length,url}) });
  await manager.download('sample');
  fs.writeFileSync(manager.status('sample').downloadPath,Buffer.from('MZ-two'));
  await assert.rejects(manager.install('sample'),/已改变/);
  assert.throws(()=>manager.status('../evil'),/未登记/);
});
