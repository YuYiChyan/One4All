'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{PassThrough}=require('node:stream');
const {createMaonoService,getMaonoModels,getMaonoSupport}=require('../core/maono-models.cjs');
const roots={payloadRoot:path.resolve('fixture-payload'),stateRoot:path.resolve('fixture-state')},deviceId='maono-352f-010c-'+'a'.repeat(20),tick=()=>new Promise(resolve=>setImmediate(resolve));
test('PD100X service preserves exact model and physical instance identity',async()=>{
 const calls=[],service=createMaonoService({...roots,run:async request=>{calls.push(request);return {ok:true};}});assert.equal(getMaonoModels().length,1);assert.equal(getMaonoSupport({brand:'maono',id:'maono-pd100x'}).protocol,'pd100x-010c');await service.status('maono-pd100x');await service.execute({deviceId,command:'gain.set',value:32});assert.equal(calls[1].deviceId,deviceId);assert.equal(calls[1].command,'gain.set');assert.throws(()=>service.execute({deviceId:'maono-pd100x',command:'gain.set',value:20}));await service.close();
});
test('PD100X process can be cancelled and the service can scan again without a total time limit',async()=>{
 const jobs=[],service=createMaonoService({...roots,execProcess:(python,args,options,callback)=>{assert(!options.timeout);assert(args.includes('--payload'));const proc={stdin:new PassThrough(),kill(){callback(Error('cancelled'));},finish:()=>callback(null,'{"ok":true,"devices":[]}')};jobs.push(proc);return proc;}});
 const pending=service.scan();pending.catch(()=>{});await tick();assert.equal((await service.cancelPending()).cancelled,true);await assert.rejects(pending);const next=service.scan();await tick();jobs[1].finish();assert.deepEqual((await next).devices,[]);await service.close();
});
