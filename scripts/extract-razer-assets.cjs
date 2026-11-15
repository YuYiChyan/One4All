'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {downloadFile,isImage}=require('../core/resource-refresh-network.cjs');
async function extract(){
 const source=require('../catalog/razer-mice.json');const root=path.join(process.env.LOCALAPPDATA,'One4All-Desktop','vendor-resources','razer');fs.mkdirSync(path.join(root,'assets'),{recursive:true});
 const jobs=[...new Set(source.models.map(m=>m.imageUrl).filter(Boolean))],images=new Map(),failures=[];let cursor=0;
 async function worker(){while(cursor<jobs.length){const url=jobs[cursor++],file=path.join(root,'assets',crypto.createHash('sha256').update(url).digest('hex').slice(0,20)+'.png');try{if(!fs.existsSync(file))await downloadFile(url,file,{validateFile:partial=>{if(!isImage(fs.readFileSync(partial)))throw Error('原厂返回的内容不是商品图');}});images.set(url,file);}catch(e){failures.push({url,error:e.message.slice(0,250)});}}}
 await Promise.all(Array.from({length:6},worker));
 const devices=source.models.map(model=>({...model,variants:images.has(model.imageUrl)?[{id:'original',name:'原厂图',color:null,imagePath:images.get(model.imageUrl),imageUrl:model.imageUrl}]:[],source:{...model.source,imageSource:model.imageUrl},support:{...model.support,status:'unverified'}}));
 const result={schema:1,brand:'razer',generatedAt:new Date().toISOString(),source:source.source,devices,stats:{usbModelRecords:devices.length,uniqueImages:jobs.length,cachedImages:images.size,modelsWithImages:devices.filter(d=>d.variants.length).length},missingImages:failures};fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(root,'razer-catalog-report.json'),JSON.stringify({...result,devices:undefined},null,2));console.log(JSON.stringify(result.stats));return result;
}
module.exports={extract};if(require.main===module)extract().catch(e=>{console.error(e.message);process.exitCode=1});
