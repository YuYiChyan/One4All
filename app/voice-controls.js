/* Live voice processing: SoundTouchJS + Web Audio, no AI or recording. */
(() => {
 'use strict';
 let engine=null,view=null;
 const defaults={pitch:1,clarity:1.5,breath:1,input:'',output:''},key='one4all-voice-settings';
 let config={...defaults};try{Object.assign(config,JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
 const save=()=>localStorage.setItem(key,JSON.stringify(config));
 function update(){if(!engine)return;const {context,pitch,clarity,breath}=engine;pitch.parameters.get('pitchSemitones').setTargetAtTime(Number(config.pitch),context.currentTime,.03);clarity.gain.setTargetAtTime(Number(config.clarity),context.currentTime,.03);breath.gain.setTargetAtTime(-Number(config.breath),context.currentTime,.03);}
 async function stop(){const previous=engine;engine=null;if(previous){previous.stream.getTracks().forEach(t=>t.stop());await previous.context.close();}view?.refresh();}
 async function devices(){return navigator.mediaDevices.enumerateDevices();}
 async function start(preview=false){
  if(engine)return;
  let stream,context;
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{...(config.input?{deviceId:{exact:config.input}}:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
   const all=await devices(), preferred=all.find(d=>d.kind==='audioinput'&&/PD100X/i.test(d.label));if(!config.input&&preferred&&stream.getAudioTracks()[0].getSettings().deviceId!==preferred.deviceId){stream.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:preferred.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});config.input=preferred.deviceId;save();}const outputs=all.filter(d=>d.kind==='audiooutput');let output=outputs.find(d=>d.deviceId===config.output&&(preview||/cable input|vb-audio.*cable/i.test(d.label)))||(!preview&&outputs.find(d=>/cable input|vb-audio.*cable/i.test(d.label)));
   if(!output&&preview)output=outputs.find(d=>d.deviceId==='default')||outputs[0];if(!output)throw Error('未找到 VB-CABLE 输出，请安装虚拟声卡后重新检测。');
   if(!preview&&!/cable input|vb-audio.*cable/i.test(output.label))throw Error('请选择虚拟声卡输出，或点耳机试听。');
   config.output=output.deviceId;save();
   context=new AudioContext({latencyHint:'interactive'});if(typeof context.setSinkId!=='function')throw Error('当前运行环境不支持选择音频输出');
   await context.setSinkId(output.deviceId);await context.audioWorklet.addModule('voice-vendor/soundtouch-processor.js');
   const source=context.createMediaStreamSource(stream),highpass=context.createBiquadFilter(),pitch=new AudioWorkletNode(context,'soundtouch-processor',{outputChannelCount:[2]}),low=context.createBiquadFilter(),clarity=context.createBiquadFilter(),breath=context.createBiquadFilter(),compressor=context.createDynamicsCompressor();
   highpass.type='highpass';highpass.frequency.value=80;low.type='peaking';low.frequency.value=200;low.Q.value=.8;low.gain.value=-1;clarity.type='peaking';clarity.frequency.value=3200;clarity.Q.value=.8;breath.type='highshelf';breath.frequency.value=6500;compressor.threshold.value=-18;compressor.knee.value=12;compressor.ratio.value=2;compressor.attack.value=.01;compressor.release.value=.15;
   source.connect(highpass).connect(pitch).connect(low).connect(clarity).connect(breath).connect(compressor).connect(context.destination);engine={stream,context,pitch,clarity,breath,preview};update();await context.resume();view?.refresh();
  }catch(error){stream?.getTracks().forEach(t=>t.stop());if(context)await context.close().catch(()=>{});engine=null;throw error;}
 }
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function render(container,{onBack,notify,api}){
  let alive=true;const root=el('section','voice-panel'),head=el('div','voice-head'),title=el('h2','','声音优化'),desc=el('p','o4-mouse-muted','实时调高音高、增加清晰度，声音只在本机处理。');head.append(title,desc);const state=el('p','voice-status');const actions=el('div','voice-actions'),run=el('button','primary','启动声音优化'),back=el('button','secondary','返回主页');back.onclick=onBack;run.onclick=async()=>{run.disabled=true;try{if(engine)await stop();else await start();}catch(e){notify(e.message||String(e));state.textContent=e.message||String(e);}finally{run.disabled=false;refresh();}};const preview=el('button','secondary','耳机试听');preview.onclick=async()=>{preview.disabled=true;try{if(engine)await stop();else await start(true);}catch(e){notify(e.message||String(e));}finally{preview.disabled=false;refresh();}};actions.append(run,preview,back);
  const settings=el('div','voice-settings'),input=el('select'),output=el('select');input.setAttribute('aria-label','输入麦克风');output.setAttribute('aria-label','虚拟声卡输出');
  function select(label,node){const l=el('label','voice-setting');l.append(el('strong','',label),node);settings.append(l);}select('输入麦克风',input);select('发送到',output);
  for(const [name,label,min,max,step,suffix] of [['pitch','音高',0,4,.25,' 半音'],['clarity','清晰度',-3,4,.5,' dB'],['breath','气音柔化',0,6,.5,' dB']]){const wrap=el('label','voice-setting'),row=el('div','voice-setting-row'),caption=el('strong','',label),number=el('output'),slider=el('input');slider.type='range';slider.min=min;slider.max=max;slider.step=step;slider.value=config[name];number.textContent=config[name]+suffix;slider.setAttribute('aria-label',label);row.append(caption,number);wrap.append(row,slider);settings.append(wrap);slider.oninput=()=>{config[name]=Number(slider.value);number.textContent=config[name]+suffix;save();update();};}
  input.onchange=()=>{config.input=input.value;save();};output.onchange=()=>{config.output=output.value;save();};const install=el('button','secondary','安装虚拟声卡');install.onclick=async()=>{install.disabled=true;try{state.textContent='正在下载虚拟声卡…';await api.downloadPackage('vb-cable');const result=await api.installPackage('vb-cable');notify(result?.cancelled?'已取消选择安装程序':'请选择 64 位安装程序，完成安装后重启电脑');}catch(e){notify(e.message||String(e));}finally{install.disabled=false;refresh();}};const hint=el('p','o4-mouse-muted','耳机试听请先戴好耳机；语音聊天选择 CABLE Output。切换页面后处理继续运行，关闭 One4All 或点停止会结束。');actions.append(install);root.append(head,state,actions,settings,hint);container.replaceChildren(root);
  async function refresh(){if(!alive)return;run.textContent=engine?'停止声音优化':'启动声音优化';state.textContent=engine?(engine.preview?'耳机试听中 · 请佩戴耳机避免啸叫':'运行中 · 语音软件请选择 CABLE Output'):'未运行';preview.textContent=engine?.preview?'停止试听':'耳机试听';preview.disabled=!!engine&&!engine.preview;run.disabled=!!engine&&engine.preview;input.disabled=output.disabled=!!engine;try{const all=await devices();if(!alive)return;for(const [node,kind,selected] of [[input,'audioinput',config.input],[output,'audiooutput',config.output]]){const list=all.filter(d=>d.kind===kind);node.replaceChildren();for(const d of list){const option=el('option','',d.label||((kind==='audioinput'?'麦克风':'输出设备')+' '+(node.length+1)));option.value=d.deviceId;node.append(option);}const match=list.find(d=>d.deviceId===selected)||(kind==='audioinput'?list.find(d=>/PD100X/i.test(d.label)):list.find(d=>/cable input/i.test(d.label)));if(match){node.value=match.deviceId;config[kind==='audioinput'?'input':'output']=match.deviceId;save();}}}catch(e){state.textContent=e.message;}}
  view={refresh};refresh();return {ready:Promise.resolve(),dispose(){alive=false;if(view?.refresh===refresh)view=null;root.remove();}};
 }
 window.One4AllVoice={render,stop,isRunning:()=>!!engine};
})();
