'use strict';
const path=require('node:path'),{execFile}=require('node:child_process');
const catalog=require('../catalog/maono-microphones.json');
const PROVIDER='maono-hidapi',VERSION='pd100x-hid-1',MAONO_MODELS=catalog.models;
function getMaonoModel(id){return MAONO_MODELS.find(model=>model.id===id)||null;}
function getMaonoSupport(model){const entry=model?.brand==='maono'?getMaonoModel(model.id):null;return entry?{...entry.support,modelId:entry.id}:null;}
function createMaonoService({payloadRoot,stateRoot,run,execProcess=execFile}={}){
 if(!path.isAbsolute(payloadRoot||'')||!path.isAbsolute(stateRoot||''))throw TypeError('payloadRoot and stateRoot are required');
 let queue=Promise.resolve(),closed=false,revision=0,child=null;
 const cancelled=()=>Object.assign(Error('麦克风检测已取消'),{name:'AbortError'});
 const transport=run||((request)=>new Promise((resolve,reject)=>{
  const current=execProcess(path.join(payloadRoot,'python','python.exe'),['-I','-B',path.join(__dirname,'maono_backend.py'),'--payload',payloadRoot],{windowsHide:true,encoding:'utf8',maxBuffer:1024*1024},(error,stdout)=>{
   if(child===current)child=null;if(error){reject(Error('麦克风读取失败：'+error.message));return;}
   try{const result=JSON.parse(stdout);if(result.ok===false)throw Error(result.error||'麦克风读取失败');resolve(result);}catch(failure){reject(failure);}
  });child=current;current.stdin.on('error',()=>{});current.stdin.end(JSON.stringify(request));
 }));
 function enqueue(request){if(closed)return Promise.reject(Error('麦克风模块已关闭'));const ticket=revision;const job=queue.catch(()=>{}).then(()=>{if(closed||ticket!==revision)throw cancelled();return transport(request);});queue=job;return job;}
 const identity=id=>{if(typeof id!=='string'||!/^maono-352f-(?:010c|0108)-[a-f0-9]{20}$/.test(id))throw Error('请选择已连接的 PD100X');return id;};
 return Object.freeze({
  scan:()=>enqueue({action:'scan'}),
  status:id=>enqueue({action:'status',deviceId:getMaonoModel(id)?id:identity(id)}),
  execute:({deviceId,command,value}={})=>enqueue({action:'execute',deviceId:identity(deviceId),command,value}),
  cancelPending(){revision++;const current=child;current?.kill();return queue.catch(()=>{}).then(()=>({cancelled:!!current}));},
  close(){closed=true;revision++;child?.kill();return queue.catch(()=>{});}
 });
}
module.exports={PROVIDER,VERSION,MAONO_MODELS,getMaonoModel,getMaonoSupport,getMaonoModels:()=>MAONO_MODELS,listMaonoModels:()=>MAONO_MODELS,loadCatalog:()=>catalog,createMaonoService};
