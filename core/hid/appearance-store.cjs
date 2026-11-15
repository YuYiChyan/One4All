/* Local user preferences only; never writes HID reports. SPDX-License-Identifier: MIT. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
function validateAppearance(value){
  if(!value||typeof value!=='object'||typeof value.name!=='string'||/[\x00-\x1f\x7f]/.test(value.name))throw Error('名称需为单行文字');
  const image=value.imageDataUrl;
  if(typeof image!=='string')throw Error('图片格式不正确');
  if(image){
    if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw Error('请上传 PNG 图片');
    const bytes=Buffer.from(image.slice(22),'base64');
    if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR')throw Error('图片格式不正确');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(!width||!height)throw Error('图片尺寸不正确');
  }
  const deviceType=value.deviceType||'auto';
  if(!['auto','keyboard','mouse'].includes(deviceType))throw Error('设备类型不正确');
  return {name:value.name.trim(),imageDataUrl:image,deviceType};
}
function createAppearanceStore(directory){
  try{fs.mkdirSync(directory,{recursive:true});}catch{}
  const file=path.join(directory,'keyboard-appearance.json');
  let data,missing=false,preserveOnWrite=false;
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){missing=error.code==='ENOENT';preserveOnWrite=!missing;}
  if(!data||typeof data!=='object'||!/^[a-f0-9]{64}$/.test(data.salt)||!data.devices||typeof data.devices!=='object'||Array.isArray(data.devices)){data=null;preserveOnWrite=!missing;}
  data??={salt:randomBytes(32).toString('hex'),devices:{}};
  function persist(next){
    const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
    if(preserveOnWrite&&fs.existsSync(file)){fs.copyFileSync(file,file+'.preserved-'+randomBytes(6).toString('hex'));preserveOnWrite=false;}
    try{fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
    finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    data=next;
  }
  if(missing)try{persist(data);}catch{}
  function checkId(id){if(typeof id!=='string'||!/^[a-f0-9]{20}$/.test(id))throw Error('设备标识不正确');}
  return Object.freeze({salt:data.salt,
    get(id){checkId(id);try{if(data.devices[id])return validateAppearance(data.devices[id]);}catch{}return {name:'',imageDataUrl:'',deviceType:'auto'};},
    set(id,value){checkId(id);const appearance=validateAppearance(value);persist({...data,devices:{...data.devices,[id]:appearance}});return appearance;},
  });
}
module.exports={createAppearanceStore,validateAppearance};
