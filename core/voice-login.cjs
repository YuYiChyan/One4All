'use strict';
const fs=require('node:fs'),path=require('node:path');
function createVoiceLogin({app,stateRoot}){
 const marker=path.join(stateRoot,'voice-login-managed.json');
 return enabled=>{
  if(typeof enabled!=='boolean')throw Error('启动选项无效');
  if(!app.isPackaged)return {enabled:false,development:true};
  if(enabled){
   if(!app.getLoginItemSettings().openAtLogin){
    app.setLoginItemSettings({openAtLogin:true});
    fs.writeFileSync(marker,JSON.stringify({managed:true}));
   }
  }else if(fs.existsSync(marker)){
   app.setLoginItemSettings({openAtLogin:false});fs.unlinkSync(marker);
  }
  return {enabled:app.getLoginItemSettings().openAtLogin};
 };
}
module.exports={createVoiceLogin};
