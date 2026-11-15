'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function processHarness(file,{fakeFiles=false}={}){
 const tasks=[],timers=new Map();let clock=0,nextTimer=0;
 const setTimer=(fn,ms)=>{const token={id:++nextTimer,unref(){}};timers.set(token,{fn,at:clock+ms});return token;};
 const advance=ms=>{clock+=ms;for(const [token,timer]of [...timers])if(timer.at<=clock){timers.delete(token);timer.fn();}};
 const child=()=>{const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stdin=new PassThrough();proc.killed=false;proc.kill=()=>{if(proc.killed)return;proc.killed=true;proc.finish?.(Error('Cancelled'));proc.emit('exit',null);};return proc;};
 const execFile=(program,args,options,done)=>{const proc=child();proc.finish=(error,data)=>{if(proc.finished)return;proc.finished=true;done(error,JSON.stringify(data));};tasks.push({proc,program,args,options});if(options.timeout)setTimer(()=>proc.kill(),options.timeout);return proc;};
 const spawn=()=>{const proc=child();tasks.push({proc});return proc;};
 const absolute=path.resolve(__dirname,'..',file),requireFile=createRequire(absolute),module={exports:{}};
 const fakeFs=fakeFiles?{...fs,existsSync:()=>true,mkdirSync(){},writeFileSync(){},readFileSync(file,...rest){if(String(file).endsWith('lab-config.json'))return JSON.stringify({python:'fixture-python'});if(String(file).endsWith('source.sha256'))return '';return fs.readFileSync(file,...rest);}}:fs;
 vm.runInNewContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(absolute,'utf8')+'\n})',{process,Buffer,console,setTimeout:setTimer,clearTimeout:token=>timers.delete(token)})(id=>id==='node:child_process'?{execFile,spawn}:id==='node:fs'?fakeFs:requireFile(id),module,module.exports,path.dirname(absolute),absolute);
 return {exports:module.exports,tasks,advance,timers};
}
const roots={payloadRoot:path.resolve('fixture-payload'),stateRoot:path.resolve('fixture-state')};
for(const [file,factory,request,response]of [
 ['core/hid/keyboard-service.cjs','createKeyboardService','status',{ok:true,state:{devices:[]}}],
 ['core/razer-models.cjs','createRazerService','scan',{ok:true,devices:[]}],
 ['core/logitech-models.cjs','createLogitechService','scan',{ok:true,devices:[]}],
 ['core/xiberia-models.cjs','createXiberiaService','scan',{ok:true,state:{devices:[]}}]
])test(file+' allows slow whole-process startup and still cancels on close',async()=>{
 const h=processHarness(file,{fakeFiles:true}),service=h.exports[factory]({...roots,python:'fixture-python'});let settled=false;
 const pending=service[request]();pending.finally(()=>{settled=true;}).catch(()=>{});await tick();assert.equal(h.tasks.length,1);h.advance(120000);await tick();assert.equal(settled,false,'Slow process was timed out');assert.equal(h.tasks[0].proc.killed,false);
 h.tasks[0].proc.finish(null,response);await pending;
 const next=service[request]();next.catch(()=>{});await tick();const closing=service.close();await assert.rejects(next);await closing;assert.equal(h.tasks[1].proc.killed,true);
});
for(const [file,factory,request,response]of [
 ['core/hid/keyboard-service.cjs','createKeyboardService','status',{ok:true,state:{devices:[]}}],
 ['core/razer-models.cjs','createRazerService','scan',{ok:true,devices:[]}],
 ['core/logitech-models.cjs','createLogitechService','scan',{ok:true,devices:[]}]
])test(file+' cancels pending work and reuses the service on the next scan',async()=>{
 const h=processHarness(file,{fakeFiles:true}),service=h.exports[factory]({...roots,python:'fixture-python'}),first=service[request]();first.catch(()=>{});await tick();const queued=service[request]();queued.catch(()=>{});const cancelled=await service.cancelPending();assert.equal(cancelled.cancelled,true);await assert.rejects(first);await assert.rejects(queued);assert.equal(h.tasks.length,1);
 const again=service[request]();await tick();h.tasks[1].proc.finish(null,response);await again;await service.close();
});
test('foreground keyboard test can start slowly, be stopped, and start again',async()=>{
 const h=processHarness('core/hid/test-session.cjs'),service=h.exports.createTestSession({python:'fixture-python'});
 let settled=false;const first=service.start();first.finally(()=>{settled=true;}).catch(()=>{});h.advance(120000);await tick();assert.equal(settled,false);h.tasks[0].proc.stdout.write('{"type":"ready"}\n');assert.equal((await first).active,true);service.stop();assert.equal(h.tasks[0].proc.killed,true);
 const cancelled=service.start();cancelled.catch(()=>{});service.stop();await assert.rejects(cancelled);const again=service.start();h.tasks[2].proc.stdout.write('{"type":"ready"}\n');await again;service.stop();
});
test('native Xiberia SDK startup has no whole-request deadline and close rejects pending work',async()=>{
 const h=processHarness('core/xiberia/service.cjs'),native=h.exports.createNative(path.resolve('fixture-base'));let settled=false;
 const pending=native.request('status');pending.finally(()=>{settled=true;}).catch(()=>{});h.advance(120000);await tick();assert.equal(settled,false);h.tasks[0].proc.stdout.write('{"ok":true,"state":{"ready":true}}\n');assert.equal((await pending).ready,true);
 const next=native.request('status');next.catch(()=>{});native.close();await assert.rejects(next,/退出/);assert.equal(h.tasks[0].proc.killed,true);
});
test('legacy Xiberia Core Audio process belongs to the service and closes with it',async()=>{
 const h=processHarness('core/xiberia/service.cjs',{fakeFiles:true}),service=h.exports.createService(path.resolve('fixture-base'),{native:{close(){},request:async()=>null}});
 let settled=false;const pending=service.status();pending.finally(()=>{settled=true;}).catch(()=>{});await tick();h.advance(120000);await tick();assert.equal(settled,false);const closing=service.close();await assert.rejects(pending);await closing;assert.equal(h.tasks[0].proc.killed,true);
});
test('closing Xiberia while its first bridge compiles cancels that compiler',async()=>{
 const h=processHarness('core/xiberia-models.cjs',{fakeFiles:true}),service=h.exports.createXiberiaService({...roots,runCore:async()=>({connected:true,capabilities:{},_renderEndpoint:'fixture'})});
 const pending=service.status('k03s');await tick();assert.equal(h.tasks.length,1);h.advance(120000);assert.equal(h.tasks[0].proc.killed,false);await service.close();assert.equal((await pending).capabilities.effects,false);assert.equal(h.tasks[0].proc.killed,true);
});
