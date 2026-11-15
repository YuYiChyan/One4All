/* PD100X controls are rendered from the native service's actual capabilities. */
(() => {
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const labels={gain:'麦克风增益',mute:'麦克风静音',noise:'降噪',noiseLevel:'降噪强度',lightingEnabled:'灯光',lightingMode:'灯光模式',lightingColor:'灯光颜色',lightingBrightness:'灯光亮度'};
 const colors=['conic-gradient(#f55,#fd5,#5d8,#59f,#b5f,#f55)','#ef4343','#f18a32','#eed34b','#42bd6c','#396fed','#73d5ed','#a466dd','#ffffff'];
 const colorNames=['混合','红色','橙色','黄色','绿色','蓝色','浅蓝','紫色','白色'];
 window.One4AllMaono={render(container,{model,api,notify=()=>{},onBack=()=>{}}){
  let alive=true,state=null,tab='sound',busy=false,reading=false,revision=0,error='',notice='',localBadge=null,feedback=null,closing=null,selectedDevice='';
  const root=el('section','o4-mouse o4-xiberia o4-maono'),sidebar=el('aside','o4-mouse-sidebar'),main=el('div','o4-mouse-main'),heading=el('div','o4-mouse-heading');
  function button(label,action,cls='secondary'){const n=el('button',cls,label);n.type='button';n.onclick=action;return n;}
  const back=button('← 返回支持库',onBack,'o4-mouse-back'),connection=el('p','o4-mouse-muted','正在检测麦克风…');heading.append(back,el('h2','',model.name),connection);
  const art=el('div','o4-mouse-art'),image=el('img');image.alt=model.name;
  const variants=(model.variants||[]).filter(v=>v.imageUrl||v.artUrl).map(v=>({...v,imageUrl:v.imageUrl||v.artUrl})),selected=variants.find(v=>v.id===model.selectedVariant)||variants[0];
  if(selected){image.src=selected.imageUrl;art.append(image);}
  const colorHost=el('div','o4-xiberia-colors'),picker=window.One4AllColorPicker?.mount(colorHost,{variants,selectedId:selected?.id,image});
  const rescan=button('重新检测',()=>read()),cancel=button('取消检测',async()=>{revision++;reading=false;notice='已取消检测';render();try{await api.cancelMaonoDetection?.();}catch(failure){if(alive){error=failure.message||String(failure);render();}}});
  const actions=el('div','o4-xiberia-actions');actions.append(rescan,cancel);sidebar.append(heading,art,colorHost,actions);
  const tabs=el('nav','o4-mouse-tabs'),message=el('p','o4-mouse-message'),body=el('div','o4-mouse-body');tabs.setAttribute('aria-label','麦克风设置');message.setAttribute('role','status');
  for(const [id,label]of [['sound','声音'],['lighting','灯光'],['about','设备信息']]){const n=button(label,()=>{tab=id;render();},'');n.dataset.tab=id;tabs.append(n);}
  main.append(tabs,message,body);root.append(sidebar,main);container.replaceChildren(root);
  const cap=key=>state?.capabilities?.[key],value=key=>state?.values?.[key],enabled=key=>!!state?.connected&&!!state?.device?.id&&cap(key)?.writable===true&&!busy&&!reading;
  function card(title){const n=el('section','o4-mouse-setting o4-xiberia-setting');n.append(el('h3','',title));body.append(n);return n;}
  function row(parent,label,text){const n=el('div','o4-mouse-info-row');n.append(el('span','o4-mouse-muted',label),el('span','',text));parent.append(n);}
  async function write(key,next){
   if(!alive||!enabled(key))return;busy=true;revision++;error='';notice='';const deviceId=state.device.id;render();
   try{const result=await api.executeMaono({deviceId,command:key+'.set',value:next});if(alive){if(result?.ok===false)throw Error(result.error||'设置未完成');state=result;notice='已应用';}}
   catch(failure){if(alive)error=failure.message||String(failure);}finally{busy=false;if(alive)render();}
  }
  function toggle(key){if(!cap(key))return;const n=card(labels[key]),line=el('label','o4-xiberia-toggle'),input=el('input');input.type='checkbox';input.checked=value(key)===true;input.disabled=!enabled(key);input.setAttribute('aria-label',labels[key]);input.onchange=()=>write(key,input.checked);line.append(el('span','',value(key)===undefined?'尚未读取':value(key)?'已开启':'已关闭'),input);n.append(line);}
  function slider(key){
   const c=cap(key);if(!c)return;const n=card(labels[key]),output=el('output','o4-xiberia-volume',typeof value(key)==='number'?value(key)+(c.unit||''):'—');n.append(output);
   if(!Number.isFinite(c.min)||!Number.isFinite(c.max))return;
   const input=el('input','o4-xiberia-slider');input.type='range';input.min=c.min;input.max=c.max;input.step=c.step||1;input.value=value(key)??c.min;input.disabled=!enabled(key);input.setAttribute('aria-label',labels[key]);input.oninput=()=>{output.textContent=input.value+(c.unit||'');};input.onchange=()=>write(key,Number(input.value));n.append(input);
  }
  function options(key){const raw=cap(key)?.options||[];return (Array.isArray(raw)?raw:Object.entries(raw).map(([v,label])=>({value:Number.isFinite(Number(v))?Number(v):v,label}))).map(option=>typeof option==='object'?{value:option.value??option.id,label:option.label??option.name??String(option.value??option.id),color:option.color}:{value:option,label:String(option)});}
  function choice(key){
   if(!cap(key))return;const n=card(labels[key]),items=options(key);if(!items.length){n.append(el('p','o4-mouse-muted',value(key)===undefined?'尚未读取':String(value(key))));return;}
   if(key==='lightingColor'){
    const dots=el('div','o4-xiberia-actions');for(const option of items){const index=Number(option.value),label=option.label||colorNames[index],dot=button(label,()=>write(key,option.value),'');dot.textContent='';dot.title=label;dot.setAttribute('aria-label','灯光颜色：'+label);dot.setAttribute('aria-pressed',String(value(key)===option.value));dot.disabled=!enabled(key);Object.assign(dot.style,{width:'32px',height:'32px',borderRadius:'50%',background:option.color||colors[index]||'var(--panel)',border:value(key)===option.value?'3px solid var(--text)':'1px solid var(--border)',boxShadow:'inset 0 0 0 2px var(--panel)',cursor:dot.disabled?'default':'pointer'});dots.append(dot);}n.append(dots);
   }else{
    const select=el('select','o4-xiberia-select');select.setAttribute('aria-label',labels[key]);for(const [index,option]of items.entries()){const item=el('option','',option.label);item.value=index;select.append(item);}select.value=String(items.findIndex(item=>item.value===value(key)));select.disabled=!enabled(key);select.onchange=()=>write(key,items[Number(select.value)].value);n.append(select);
   }
  }
  function render(){
   if(!alive)return;localBadge?.dispose();localBadge=null;body.replaceChildren();for(const n of tabs.children){n.classList.toggle('active',n.dataset.tab===tab);n.setAttribute('aria-current',n.dataset.tab===tab?'page':'false');}
   connection.textContent=reading?'正在读取设备…':state?.connected?'USB · 已连接':'未连接';rescan.disabled=reading||busy;cancel.hidden=!reading;
   message.textContent=error||(busy?'正在应用…':notice||(state?.ambiguous?'检测到多台 PD100X，请选择设备':!state?.connected&&!reading?'连接 PD100X 后可读取设置':''));message.hidden=!message.textContent;
   if(state?.ambiguous){const n=card('选择设备'),select=el('select','o4-xiberia-select');select.setAttribute('aria-label','选择 PD100X');const placeholder=el('option','','请选择');placeholder.value='';select.append(placeholder);for(const [index,device]of (state.devices||[]).entries()){const option=el('option','',device.name+' · '+(index+1));option.value=device.id;select.append(option);}select.value=selectedDevice;select.onchange=()=>{selectedDevice=select.value;if(selectedDevice)read();};n.append(select);}
   if(tab==='sound'){slider('gain');toggle('mute');toggle('noise');slider('noiseLevel');}
   else if(tab==='lighting'){toggle('lightingEnabled');choice('lightingMode');choice('lightingColor');slider('lightingBrightness');}
   else{
    const n=card('设备信息');row(n,'设备',model.name);row(n,'连接方式','USB');row(n,'控制接口','PD100X 原生 HID');row(n,'适配状态','待验证');
    const verification=el('div','o4-xiberia-actions');n.append(verification);if(window.One4AllLocalVerification)localBadge=window.One4AllLocalVerification.mount(verification,{model,api,notify});
    if(window.One4AllValidation)verification.append(button('提交验证反馈',()=>{feedback?.dispose();feedback=window.One4AllValidation.open({model,providerVersion:model.support?.version,availableChecks:Object.keys(state?.capabilities||{}).filter(key=>labels[key]).map(id=>({id,label:labels[id]})),api,notify});}));
    const controls=el('div','o4-xiberia-actions');controls.append(button('打开官方 APP',async()=>{try{await api.openOfficial('maono');}catch(failure){if(alive){error=failure.message||String(failure);render();}}}));n.append(controls);
    const errors=Object.values(state?.errors||{});if(errors.length)n.append(el('p','o4-mouse-muted','部分设置尚未读取，可重新检测。'));
   }
   if(!body.children.length)card(reading?'正在读取设置…':state?.connected?'此页面暂未读取到可用设置':'连接后显示可用设置');
  }
  async function read(){
   if(!alive||reading||busy)return;const ticket=++revision;reading=true;error='';notice='';render();
   try{const result=await api.statusMaono(selectedDevice||model.id);if(alive&&ticket===revision){if(result?.ok===false)throw Error(result.error||'读取未完成');state=result;}}
   catch(failure){if(alive&&ticket===revision){error=failure.message||String(failure);state=null;}}
   finally{if(ticket===revision)reading=false;if(alive)render();}
  }
  render();const ready=read();
  return {ready,dispose(){if(closing)return closing;alive=false;revision++;picker?.dispose();localBadge?.dispose();feedback?.dispose();root.remove();try{closing=Promise.resolve(api.cancelMaonoDetection?.()).catch(()=>{});}catch{closing=Promise.resolve();}return closing;}};
 }};
})();
