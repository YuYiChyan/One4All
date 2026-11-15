'use strict';
const fs=require('node:fs'),path=require('node:path');
const catalog=require('../catalog/maono-microphones.json');
async function extract({outputRoot=path.join(process.env.LOCALAPPDATA||process.cwd(),'One4All-Desktop/vendor-resources/maono')}={}){
 const assetsRoot=path.join(outputRoot,'assets');fs.mkdirSync(assetsRoot,{recursive:true});
 const devices=catalog.models.map(model=>({...model,variants:model.variants.map(variant=>{
  const imagePath=path.join(assetsRoot,variant.file);fs.copyFileSync(path.join(__dirname,'../app/assets/maono',variant.file),imagePath);return {...variant,imagePath};
 })}));
 const result={schema:1,brand:'maono',source:catalog.source,generatedAt:new Date().toISOString(),stats:{models:devices.length,products:devices.length,images:devices.length,variants:devices.reduce((count,model)=>count+model.variants.length,0)},devices};
 fs.writeFileSync(path.join(outputRoot,'catalog.json'),JSON.stringify(result,null,2));return result;
}
module.exports={extract};if(require.main===module)extract().then(result=>console.log(JSON.stringify(result.stats))).catch(error=>{console.error(error.message);process.exitCode=1;});
