'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createVoiceLogin}=require('../core/voice-login.cjs');
function setup(t,existing){const root=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-login-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let enabled=existing,calls=[];const app={isPackaged:true,getLoginItemSettings:()=>({openAtLogin:enabled}),setLoginItemSettings:({openAtLogin})=>{enabled=openAtLogin;calls.push(enabled)}};return {set:createVoiceLogin({app,stateRoot:root}),calls};}
test('auto startup is removed only if One4All voice enabled it',t=>{const {set,calls}=setup(t,false);assert.equal(set(true).enabled,true);assert.equal(set(false).enabled,false);assert.deepEqual(calls,[true,false]);});
test('existing user startup preference remains on after voice stops',t=>{const {set,calls}=setup(t,true);assert.equal(set(true).enabled,true);assert.equal(set(false).enabled,true);assert.deepEqual(calls,[]);});
