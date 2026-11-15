'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
const {createPackageManager}=require('../core/vendor-packages.cjs'),{createResourceRefresh}=require('../core/resource-refresh.cjs'),{jsonDocuments}=require('../scripts/official-via-assets.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a progressing package download can take longer than ten minutes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'o4-slow-package-')),stream=new PassThrough();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));t.mock.timers.enable({apis:['setTimeout','Date']});let signal;
 const entry={id:'slow',source:{type:'official',url:'https://vendor.example/setup.exe',filename:'setup.exe',format:'exe',allowedHosts:['vendor.example']}};
 const manager=createPackageManager({dataRoot:root,entries:[entry],transport:async(url,_hosts,current)=>{signal=current;return {url,total:null,stream};}}),pending=manager.download('slow');pending.catch(()=>{});
 try{await tick();stream.write('MZ');for(let i=0;i<21;i++){t.mock.timers.tick(30000);stream.write('progress');await tick();assert.equal(signal.aborted,false,'active download must not hit a total deadline');}stream.end();assert.equal((await pending).downloaded,true);}finally{stream.destroy();await pending.catch(()=>{});t.mock.timers.reset();}
});
test('default resource refresh does not kill a worker after fifteen minutes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const child=new EventEmitter();child.postMessage=()=>{};child.kill=()=>{child.killed=true;child.emit('exit',0);};const refresh=createResourceRefresh({utilityProcess:{fork:()=>child}}),pending=refresh.run('fgg');pending.catch(()=>{});
 try{t.mock.timers.tick(16*60000);assert.notEqual(child.killed,true);child.emit('message',{ok:true,count:4});assert.equal((await pending).count,4);}finally{refresh.close();await pending.catch(()=>{});t.mock.timers.reset();}
});
test('valid official JSON is not rejected by an arbitrary four MiB inflate cap',()=>{
 const name=Buffer.from('large-layout.json'),raw=Buffer.from(JSON.stringify({name:'fixture',description:'x'.repeat(4*1024*1024+1)})),compressed=zlib.deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
 const result=jsonDocuments(Buffer.concat([local,name,compressed,central,name,end]));assert.equal(result[0].definition.description.length,4*1024*1024+1);
});
