(() => {
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 window.One4AllWorkbench={render(container,{api,notify,isCurrent=()=>true}){
  let disposed=false,activeDraftId=null,trialView=null,trialZone=null,trialBusy=false,listVersion=0,requestBusy=false,requestCancelled=false,stopButton;
  const mount=el('div','workbench');container.append(mount);
  const alive=()=>!disposed&&mount.isConnected&&isCurrent();
  const say=message=>{if(alive())notify(message instanceof Error?message.message:String(message));};
  function clearTrial(){trialView?.dispose();trialView=null;trialZone?.remove();trialZone=null;}
  async function stopTrial(){const id=activeDraftId;activeDraftId=null;if(stopButton)stopButton.disabled=true;clearTrial();if(id&&api.stopAdapterDraft)await api.stopAdapterDraft(id);}
  function dispose(){if(disposed)return;disposed=true;listVersion++;void stopTrial().catch(()=>{});if(requestBusy)void api.cancelGeneration?.().catch(()=>{});mount.remove();}
  async function run(button,fn){if(!alive())return;button.disabled=true;try{return await fn();}catch(error){say(error);}finally{button.disabled=false;}}
  function btn(text,fn,cls='secondary'){const button=el('button',cls,text);button.type='button';button.onclick=()=>run(button,()=>fn(button));return button;}
  function field(label,type,value,placeholder){const wrap=el('label','workbench-field'),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value||'';input.placeholder=placeholder||'';input.autocomplete='off';wrap.append(el('span','',label),input);return {wrap,input};}
  async function initialize(){
   const config=await api.aiConfig();if(!alive())return;
   const settings=el('section','workbench-section'),form=el('div','workbench-fields');settings.append(el('h2','','模型接口'),el('p','','使用兼容 OpenAI 的 Chat Completions 接口，包括 DeepSeek 和自建服务。'));
   const endpoint=field('接口地址','url',config.baseURL||config.endpoint,'https://api.deepseek.com'),model=field('模型名称','text',config.model,'填写服务商提供的模型名称'),key=field('API Key','password','',config.keyConfigured?(config.keyPersistence==='local'?'已在本机保存，留空保持原密钥':'已加密保存，留空保持原密钥'):'填写 API Key'),outputLimit=field('输出上限（可选）','number',config.maxOutputTokens,'留空使用服务商默认值');outputLimit.input.min='1';outputLimit.input.step='1';form.append(endpoint.wrap,model.wrap,key.wrap,outputLimit.wrap);settings.append(form);
   async function save(){const data={baseURL:endpoint.input.value.trim(),model:model.input.value.trim(),maxOutputTokens:outputLimit.input.value};if(key.input.value)data.apiKey=key.input.value;const updated=await api.saveAiConfig(data);if(!alive())return;key.input.value='';key.input.placeholder=updated.keyConfigured?(updated.keyPersistence==='local'?'已在本机保存，留空保持原密钥':'已加密保存，留空保持原密钥'):'填写 API Key';}
   const cancelRequest=btn('取消请求',async()=>{requestCancelled=true;await api.cancelGeneration();say('已取消，可重新尝试');});cancelRequest.hidden=true;
   async function runModelRequest(operation){if(requestBusy){say('正在处理模型请求，可点击“取消请求”后重试');return;}requestBusy=true;requestCancelled=false;cancelRequest.hidden=false;try{return await operation();}finally{requestBusy=false;cancelRequest.hidden=true;}}
   const actions=el('div','workbench-actions');actions.append(btn('保存接口',async()=>{await save();say('接口已保存');},'primary'),btn('测试连接',()=>runModelRequest(async()=>{await save();if(!alive()||requestCancelled)return;const result=await api.testAiConnection();say(result.message||'模型接口连接成功');})),cancelRequest);settings.append(actions);
   const generate=el('section','workbench-section');generate.append(el('h2','','生成设备适配'),el('p','','将所选包的接口资料、适配规范和需求发送给你配置的模型，生成待验证模块。'));
   const selection=el('select'),packageData=await api.getPackages();if(!alive())return;
   const catalog=Array.isArray(packageData)?packageData:packageData.catalog||packageData.packages||[];
   for(const p of catalog){const option=el('option','',p.name||p.id);option.value=p.id;selection.append(option);}const pick=el('label','workbench-field');pick.append(el('span','','驱动包'),selection);
   const request=field('适配需求','textarea','','例如：接入这个型号的灯效、回报率与板载配置，并复用统一键盘控件。'),context=field('补充接口资料（可选）','textarea','','粘贴接口说明、协议记录或错误日志。');generate.append(pick,request.wrap,context.wrap);
   const resultBox=el('div','workbench-results'),draftList=el('section','workbench-section');stopButton=btn('停止模块',stopTrial);stopButton.disabled=true;draftList.append(el('h2','','本机适配草稿'),btn('刷新草稿',()=>list()),stopButton,resultBox);
   async function list(){
    const version=++listVersion,drafts=await api.listAdapterDrafts();if(!alive()||version!==listVersion)return;
    await stopTrial();if(!alive()||version!==listVersion)return;resultBox.replaceChildren();
    if(!drafts.length){resultBox.append(el('p','','尚未生成适配模块。'));return;}
    for(const draft of drafts){
     const row=el('article','draft-row');row.append(el('strong','',draft.manifest?.id||draft.id),el('span','draft-status','待验证'));
     const text=el('pre','draft-report',JSON.stringify(draft.report||draft.manifest||{},null,2)),details=el('details');details.append(el('summary','','查看适配结果'),text);row.append(details,btn('打开文件夹',()=>api.openAdapterDraft(draft.id)));
     if(draft.candidateReady)row.append(btn('试用模块',async()=>{
      if(trialBusy){say('正在连接模块，请稍候');return;}trialBusy=true;
      try{
       await stopTrial();if(!alive()||!row.isConnected)return;
       activeDraftId=draft.id;stopButton.disabled=false;const result=await api.startAdapterDraft(draft.id);
       if(!alive()||!row.isConnected||activeDraftId!==draft.id)return;
       trialZone=el('div','draft-controls');row.append(trialZone);
       trialView=window.One4AllKeyboard.render(trialZone,{device:result.device||{},capabilities:result.capabilities||[],values:result.values||{},execute:(command,payload)=>api.executeAdapterDraft({id:draft.id,command,payload}),onError:say});
       say(result.connected?'已连接，控件来自实际接口':'模块已运行，尚未确认设备接口');
      }catch(error){if(activeDraftId===draft.id)await stopTrial().catch(()=>{});throw error;}finally{trialBusy=false;}
     }));resultBox.append(row);
    }
   }
   generate.append(btn('生成适配模块',button=>runModelRequest(async()=>{
    await save();if(!alive()||requestCancelled)return;button.textContent='正在分析并生成…';
    try{await api.generateAdapter({packageId:selection.value,instructions:request.input.value,context:context.input.value});if(!alive())return;say('已生成待验证模块');await list();}
    finally{button.textContent='生成适配模块';}
   }),'primary'));
   if(!alive())return;mount.append(settings,generate,draftList);await list();
  }
  async function load(){try{await initialize();}catch(error){if(alive()){say(error);mount.append(btn('重新加载工作台',async()=>{mount.replaceChildren();await load();}));}}}
  const ready=load();
  return {ready,dispose};
 }};
})();
