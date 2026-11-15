'use strict';

// Keep the device page in its panel and send ordinary links to the user's browser.
function attachPageNavigation(contents,{inside,openExternal,onError=()=>{}}){
 const external=url=>{
  try{const protocol=new URL(url).protocol;if(!['https:','http:','mailto:'].includes(protocol))return;
   Promise.resolve(openExternal(url)).catch(onError);
  }catch(error){onError(error);}
 };
 contents.setWindowOpenHandler(({url})=>{
  if(inside(url))Promise.resolve(contents.loadURL(url)).catch(onError);else external(url);
  return {action:'deny'};
 });
 for(const eventName of ['will-navigate','will-redirect'])contents.on(eventName,(event,url)=>{
  if(inside(url))return;event.preventDefault();external(url);
 });
}
module.exports={attachPageNavigation};
