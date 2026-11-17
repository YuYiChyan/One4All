/* Local voice processing, independent pitch/formants, and recorded A/B listening. */
(() => {
 'use strict';
 const key='one4all-voice-settings',bankKey='one4all-voice-presets-v1';
 const defaults={pitch:0,clarity:0,breath:0,low:0,softness:0,noise:0,threshold:-12,ratio:1,attack:15,release:180,formant:0,preserveFormants:true,deessAmount:0,deessThreshold:-30,deessFrequency:6000,outputGain:0};
 const read=(name,fallback)=>{try{return JSON.parse(localStorage.getItem(name)||'null')||fallback;}catch{return fallback;}};
 const previous=read(key,{}),savedBank=read(bankKey,null);
 const original={...defaults,...previous};
 const bank=savedBank?.A&&savedBank?.B?{A:{...defaults,...savedBank.A},B:{...defaults,...savedBank.B}}:{
  A:{...original},
  B:{...original}
 };
 for(const preset of Object.values(bank))for(const field of ['input','output','monitorOutput','monitorVolume'])delete preset[field];
 let active=savedBank?.active==='B'?'B':'A';
 const routes={input:previous.input||'',output:previous.output||'',monitorOutput:previous.monitorOutput||'',monitorVolume:previous.monitorVolume??35};
 let engine=null,starting=null,view=null,recording=null,clips=null,busy=false,backgroundNotify=()=>{},deviceTimer=null;
 const autoKey='one4all-voice-auto-resume';let wanted=localStorage.getItem(autoKey)==='1',recovering=null,backgroundError='';
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const cable=d=>/cable input|cable in 16ch|vb-audio.*cable/i.test(d.label);
 const save=()=>{localStorage.setItem(bankKey,JSON.stringify({active,...bank}));localStorage.setItem(key,JSON.stringify({...bank[active],...routes}));};
 const report=error=>view?.error?.(error.message||String(error));
 const smooth=(param,value,context)=>param.setTargetAtTime(Number(value),context.currentTime,.025);
 function updateBranch(branch,config,context) {
  if(branch.natural)branch.natural.set({pitch:config.pitch,formant:config.formant,preserveFormants:config.preserveFormants}).catch(report);
  else smooth(branch.pitch.parameters.get('pitchSemitones'),config.pitch,context);
  smooth(branch.low.gain,config.low,context);smooth(branch.softness.gain,-config.softness,context);
  smooth(branch.clarity.gain,config.clarity,context);smooth(branch.breath.gain,-config.breath,context);
  for(const field of ['threshold','ratio'])smooth(branch.compressor[field],config[field],context);
  smooth(branch.compressor.attack,config.attack/1000,context);smooth(branch.compressor.release,config.release/1000,context);
  smooth(branch.gain.gain,10**(config.outputGain/20),context);
  smooth(branch.deesser.parameters.get('amount'),branch.natural?config.deessAmount:0,context);
  smooth(branch.deesser.parameters.get('threshold'),config.deessThreshold,context);
  smooth(branch.deesser.parameters.get('frequency'),config.deessFrequency,context);
 }
 function update(){
  if(!engine)return;
  engine.denoiser.port.postMessage({type:'attenuation',value:Number(bank[active].noise)});
  for(const mode of ['A','B']){
   updateBranch(engine.branches[mode],bank[mode],engine.context);
   smooth(engine.branches[mode].selected.gain,mode===active?1:0,engine.context);
  }
 }
 function choosePreset(mode){if(!bank[mode])return;active=mode;save();update();view?.refresh();}

 async function buildBranch(context,mode,input,bus){
  const config=bank[mode],natural=mode==='B'?await One4AllNaturalPitch.create(context,config):null;
  const pitch=natural?null:new AudioWorkletNode(context,'soundtouch-processor',{outputChannelCount:[2]});
  const low=context.createBiquadFilter(),softness=context.createBiquadFilter(),clarity=context.createBiquadFilter(),breath=context.createBiquadFilter();
  low.type='peaking';low.frequency.value=200;low.Q.value=.8;
  softness.type='peaking';softness.frequency.value=3000;softness.Q.value=.9;
  clarity.type='peaking';clarity.frequency.value=4200;clarity.Q.value=.8;
  breath.type='highshelf';breath.frequency.value=6500;
  const compressor=context.createDynamicsCompressor();compressor.knee.value=12;
  const deesser=new AudioWorkletNode(context,'one4all-deesser',{channelCount:mode==='B'?1:2,channelCountMode:'explicit',outputChannelCount:[mode==='B'?1:2]});
  const gain=context.createGain(),selected=context.createGain(),tap=context.createMediaStreamDestination(),meter=context.createAnalyser();
  selected.gain.value=mode===active?1:0;meter.fftSize=1024;
  input.connect(natural?natural.input:pitch);
  (natural?natural.output:pitch).connect(low).connect(softness).connect(clarity).connect(breath).connect(compressor).connect(deesser).connect(gain);
  gain.connect(selected).connect(bus);gain.connect(tap);gain.connect(meter);
  const branch={natural,pitch,low,softness,clarity,breath,compressor,deesser,gain,selected,tap,meter,samples:new Float32Array(meter.fftSize),deessReduction:0};
  deesser.port.onmessage=event=>{if(event.data.type==='meter')branch.deessReduction=event.data.reductionDb;};
  deesser.onprocessorerror=()=>report(Error('齿音处理出现异常，请停止后重新启动'));
  updateBranch(branch,config,context);
  return branch;
 }
 async function createEngine(api){
  let stream,context;const branches={};
  try{
   let devices=await navigator.mediaDevices.enumerateDevices(),inputs=devices.filter(d=>d.kind==='audioinput');
   if(!inputs.some(d=>d.label)){const probe=await navigator.mediaDevices.getUserMedia({audio:true,video:false});probe.getTracks().forEach(track=>track.stop());devices=await navigator.mediaDevices.enumerateDevices();inputs=devices.filter(d=>d.kind==='audioinput');}
   const physical=inputs.filter(d=>!/cable|vb-audio/i.test(d.label));
   const input=physical.find(d=>d.deviceId===routes.input)||physical.find(d=>d.deviceId!=='default'&&d.deviceId!=='communications')||physical.find(d=>d.deviceId==='default');
   if(!input||(!input.label&&input.deviceId==='default'))throw Error('未找到可用的实际麦克风，请选择输入后重试');
   stream=await navigator.mediaDevices.getUserMedia({audio:{...(input?{deviceId:{exact:input.deviceId}}:{}),channelCount:{ideal:1},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
   routes.input=stream.getAudioTracks()[0].getSettings().deviceId||routes.input;
   context=new AudioContext({latencyHint:'interactive',sampleRate:48000,sinkId:{type:'none'}});
   await context.resume();
   const assets=await api.voiceModelAssets(),wasmModule=await WebAssembly.compile(Uint8Array.from(assets.wasm)),modelBytes=Uint8Array.from(assets.model);
   await Promise.all([context.audioWorklet.addModule('voice-vendor/soundtouch-processor.js'),context.audioWorklet.addModule('voice-vendor/deepfilter/deepfilternet-worklet-processor.js'),context.audioWorklet.addModule('voice-deesser-processor.js')]);
   const denoiser=new AudioWorkletNode(context,'workadventure-deepfilternet',{channelCount:1,channelCountMode:'explicit',numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{wasmModule,modelBytes:modelBytes.buffer,speechAttenuationDb:Number(bank[active].noise),bypassUntilReady:true,maxLoad:.8,loadReportAfterMs:0}});
   await new Promise((resolve,reject)=>{denoiser.port.onmessage=event=>{if(event.data.type==='ready')resolve();else if(event.data.type==='error')reject(Error(event.data.message));};denoiser.onprocessorerror=()=>reject(Error('降噪模块无法启动'));});
   denoiser.port.onmessage=event=>{if(event.data.type==='error')report(Error('降噪处理异常：'+event.data.message));};
   denoiser.onprocessorerror=()=>report(Error('降噪处理出现异常，请停止后重新启动'));
   const source=context.createMediaStreamSource(stream),highpass=context.createBiquadFilter(),bus=context.createGain(),tap=context.createMediaStreamDestination();
   highpass.type='highpass';highpass.frequency.value=80;
   source.connect(highpass).connect(denoiser);bus.connect(context.destination);bus.connect(tap);
   branches.A=await buildBranch(context,'A',denoiser,bus);
   branches.B=await buildBranch(context,'B',denoiser,bus);
   engine={stream,context,branches,denoiser,bus,tap,sending:false,monitorAudio:null};
   stream.getAudioTracks()[0]?.addEventListener('ended',()=>{if(wanted&&engine?.stream===stream){backgroundError='麦克风已断开，等待设备重新连接';backgroundNotify(backgroundError);api.restoreVoiceDefault().catch(report);stop().catch(report);view?.refresh();}});
   save();update();view?.refresh();return engine;
  }catch(error){
   stream?.getTracks().forEach(track=>track.stop());
   for(const branch of Object.values(branches))branch.natural?.dispose();
   if(context)await context.close().catch(()=>{});
   throw error;
  }
 }
 async function ensureEngine(api){if(engine)return engine;if(!starting)starting=createEngine(api).finally(()=>{starting=null;});return starting;}
 async function send(enabled,api){
  if(enabled){
   const devices=await navigator.mediaDevices.enumerateDevices(),outputs=devices.filter(d=>d.kind==='audiooutput'&&cable(d));
   const output=outputs.find(d=>d.deviceId===routes.output)||outputs.find(d=>/cable input/i.test(d.label)&&!/16ch/i.test(d.label));
   if(!output)throw Error('未找到虚拟声卡，请安装 VB-CABLE 后重试。');
   const current=await ensureEngine(api);try{await current.context.setSinkId(output.deviceId);await api.activateVoiceDefault();}catch(error){await current.context.setSinkId({type:'none'}).catch(()=>{});if(!current.monitorAudio&&!recording)await stop();throw error;}current.sending=true;routes.output=output.deviceId;wanted=true;localStorage.setItem(autoKey,'1');backgroundError='';save();try{await api.setVoiceAutoLogin(true);}catch(error){backgroundError='声音已启动，开机自动启动设置失败：'+error.message;}
  }else {wanted=false;localStorage.setItem(autoKey,'0');try{await api.setVoiceAutoLogin(false);}catch(error){report(error);}try{await api.restoreVoiceDefault();}finally{if(engine){await engine.context.setSinkId({type:'none'});engine.sending=false;if(!engine.monitorAudio&&!recording)await stop();}}}
  view?.refresh();
 }
 async function monitor(enabled,api){
  if(enabled){
   const devices=await navigator.mediaDevices.enumerateDevices(),outputs=devices.filter(d=>d.kind==='audiooutput'&&!cable(d));
   const output=outputs.find(d=>d.deviceId===routes.monitorOutput)||outputs.find(d=>/耳机|headphone/i.test(d.label))||outputs.find(d=>d.deviceId==='default')||outputs[0];
   if(!output)throw Error('请选择用于试听的耳机。');
   const current=await ensureEngine(api),audio=new Audio();audio.srcObject=current.tap.stream;audio.volume=routes.monitorVolume/100;
   try{await audio.setSinkId(output.deviceId);await audio.play();}catch(error){audio.srcObject=null;throw error;}
   if(current.monitorAudio){current.monitorAudio.pause();current.monitorAudio.srcObject=null;}
   current.monitorAudio=audio;routes.monitorOutput=output.deviceId;save();
  }else if(engine?.monitorAudio){engine.monitorAudio.pause();engine.monitorAudio.srcObject=null;engine.monitorAudio=null;if(!engine.sending&&!recording)await stop();}
  view?.refresh();
 }
 async function stop(){
  if(recording)await finishRecording();
  const previous=engine;engine=null;
  if(previous){previous.monitorAudio?.pause();if(previous.monitorAudio)previous.monitorAudio.srcObject=null;previous.stream.getTracks().forEach(track=>track.stop());for(const branch of Object.values(previous.branches))branch.natural?.dispose();await previous.context.close();}
  view?.refresh();
 }
 function clearClips(){if(clips)for(const clip of Object.values(clips))URL.revokeObjectURL(clip.url);clips=null;}
 async function beginRecording(api){
  const current=await ensureEngine(api);clearClips();
  const state={started:Date.now(),items:{},presets:JSON.parse(JSON.stringify(bank))};
  for(const mode of ['A','B']){
   const chunks=[],mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
   const recorder=new MediaRecorder(current.branches[mode].tap.stream,{mimeType:mime});
   const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=()=>resolve(new Blob(chunks,{type:mime}));recorder.onerror=event=>reject(event.error||Error('录音失败'));});
   state.items[mode]={recorder,done};recorder.start(250);
  }
  recording=state;view?.refresh();
 }
 async function finishRecording(){
  const state=recording;if(!state)return;const recordingContext=engine.context;recording=null;
  for(const item of Object.values(state.items))if(item.recorder.state!=='inactive')item.recorder.stop();
  const result={};
  for(const mode of ['A','B']){
   const blob=await state.items[mode].done;if(!blob.size)throw Error('录音为空，请说一小段后再结束录音。');
   const buffer=await recordingContext.decodeAudioData(await blob.arrayBuffer());
   let sum=0,count=0;for(let ch=0;ch<buffer.numberOfChannels;ch++){const samples=buffer.getChannelData(ch);for(const value of samples){sum+=value*value;count++;}}
   result[mode]={url:URL.createObjectURL(blob),rms:Math.sqrt(sum/Math.max(1,count)),duration:buffer.duration,preset:state.presets[mode]};
  }
  clips=result;if(engine&&!engine.sending&&!engine.monitorAudio)await stop();view?.refresh();
 }
 function snapshot(){
  const branch=engine?.branches[active];let peak=0;
  if(branch){branch.meter.getFloatTimeDomainData(branch.samples);for(const value of branch.samples)peak=Math.max(peak,Math.abs(value));}
  return {active,presets:JSON.parse(JSON.stringify(bank)),routes:{...routes},running:!!engine,sending:!!engine?.sending,monitoring:!!engine?.monitorAudio,recording:!!recording,recorded:!!clips,peakDb:peak?20*Math.log10(peak):-Infinity,compressionDb:branch?-branch.compressor.reduction:0,deessDb:branch?.deessReduction||0,pitchLatencyMs:engine?.branches.B.natural.latencySeconds*1000};
 }
 function render(container,{onBack,notify,api}){
  let alive=true,playbackURL='',playbackMode='A';
  const root=el('section','voice-panel'),head=el('div','voice-head');head.append(el('h2','','声音优化'),el('p','o4-mouse-muted','A 保留原来的调音，B 使用自然变调与动态齿音控制。'));
  const status=el('p','voice-status'),actions=el('div','voice-actions'),presetRow=el('div','voice-presets'),controls=new Map();
  const invoke=fn=>async()=>{if(busy)return;busy=true;refresh();try{await fn();}catch(error){notify(error.message||String(error));}finally{busy=false;refresh();}};
  const button=(text,fn,cls='secondary')=>{const b=el('button',cls,text);b.type='button';b.onclick=invoke(fn);return b;};
  const run=button('启动声音优化',()=>send(!engine?.sending,api),'primary');
  const listening=button('临时开启返听',()=>monitor(!engine?.monitorAudio,api));
  actions.append(run,listening,button('返回主页',onBack));
  const presets={};for(const mode of ['A','B']){const b=el('button','secondary',mode==='A'?'A · 原方案':'B · 自然方案');b.type='button';b.onclick=()=>{choosePreset(mode);refresh();};presets[mode]=b;presetRow.append(b);}
  const routing=el('div','voice-routing'),input=el('select'),headphones=el('select');
  input.setAttribute('aria-label','输入麦克风');headphones.setAttribute('aria-label','试听耳机');
  function select(label,node){const wrap=el('label','voice-setting');wrap.append(el('strong','',label),node);routing.append(wrap);}
  select('输入麦克风',input);select('试听与回放耳机',headphones);
  input.onchange=()=>{routes.input=input.value;save();};
  headphones.onchange=invoke(async()=>{routes.monitorOutput=headphones.value;save();if(engine?.monitorAudio)await monitor(true,api);if(playback.src)await playback.setSinkId(routes.monitorOutput);});
  const levels=el('p','voice-meter'),settings=el('div','voice-settings');
  const fields=[['pitch','音高',-4,8,.25,' 半音'],['low','低频厚度',-6,6,.5,' dB'],['softness','尖锐柔化',0,8,.5,' dB'],['clarity','清晰度',-6,6,.5,' dB'],['breath','气音柔化',0,8,.5,' dB'],['formant','共鸣音色',-4,4,.25,' 半音'],['deessAmount','动态齿音抑制',0,12,.5,' dB'],['deessThreshold','齿音触发阈值',-60,0,1,' dB'],['deessFrequency','齿音处理频段',3000,10000,250,' Hz'],['noise','共同背景降噪',0,30,1,' dB'],['threshold','压缩阈值',-48,0,1,' dB'],['ratio','压缩比例',1,4,.1,':1'],['attack','压缩起音',1,100,1,' ms'],['release','压缩恢复',20,600,10,' ms'],['outputGain','输出音量',-12,6,.5,' dB']];
  for(const [name,label,min,max,step,suffix] of fields){
   const wrap=el('label','voice-setting'),row=el('div','voice-setting-row'),number=el('output'),slider=el('input');slider.type='range';slider.min=min;slider.max=max;slider.step=step;slider.setAttribute('aria-label',label);row.append(el('strong','',label),number);wrap.append(row,slider);settings.append(wrap);
   controls.set(name,{slider,number,suffix});
   slider.oninput=()=>{bank[active][name]=Number(slider.value);if(name==='noise')bank.A.noise=bank.B.noise=Number(slider.value);save();update();refreshValues();};
  }
  const preserveWrap=el('label','voice-setting'),preserve=el('input');preserve.type='checkbox';preserve.setAttribute('aria-label','升降音高时保持共鸣');preserveWrap.append(preserve,el('span','','升降音高时保持共鸣（B）'));settings.append(preserveWrap);preserve.onchange=()=>{bank.B.preserveFormants=preserve.checked;save();update();refreshValues();};
  const recorderBox=el('section','voice-recording'),recordActions=el('div','voice-actions'),recordButton=button('录制 A / B 对比',async()=>{if(recording)await finishRecording();else await beginRecording(api);});
  const clipStatus=el('p','o4-mouse-muted','说一小段后结束录音，再停下来回放。两档同时记录同一次说话，录音仅留在本机内存。');
  const playback=el('audio');playback.controls=true;playback.preload='metadata';playback.hidden=true;
  const matchWrap=el('label','voice-match'),match=el('input');match.type='checkbox';match.checked=true;matchWrap.append(match,el('span','','对齐 A / B 回放音量'));
  const plays={};for(const mode of ['A','B']){plays[mode]=button('回放 '+mode,()=>playClip(mode));recordActions.append(plays[mode]);}
  recordActions.prepend(recordButton);recorderBox.append(el('h3','','录后试听'),clipStatus,recordActions,matchWrap,playback);
  function playbackVolume(){if(!clips)return 1;const rms=clips[playbackMode].rms,quiet=Math.min(clips.A.rms,clips.B.rms);return match.checked&&quiet>1e-5&&rms>0?Math.min(1,quiet/rms):1;}
  match.onchange=()=>{playback.volume=playbackVolume();};
  async function playClip(mode){
   if(!clips)return;playback.pause();playbackMode=mode;playbackURL=clips[mode].url;playback.src=playbackURL;playback.hidden=false;playback.volume=playbackVolume();
   if(routes.monitorOutput)await playback.setSinkId(routes.monitorOutput);else{const all=await navigator.mediaDevices.enumerateDevices();const output=all.find(d=>d.kind==='audiooutput'&&!cable(d)&&/耳机|headphone/i.test(d.label))||all.find(d=>d.kind==='audiooutput'&&!cable(d));if(!output)throw Error('请选择回放耳机');await playback.setSinkId(output.deviceId);}
   await playback.play();clipStatus.textContent='正在回放 '+mode+' 档 · '+clips[mode].duration.toFixed(1)+' 秒（录制时的参数）';
  }
  const monitorWrap=el('label','voice-setting'),volume=el('input');volume.type='range';volume.min=0;volume.max=100;volume.value=routes.monitorVolume;volume.setAttribute('aria-label','返听音量');monitorWrap.append(el('strong','','返听音量'),volume);volume.oninput=()=>{routes.monitorVolume=Number(volume.value);if(engine?.monitorAudio)engine.monitorAudio.volume=routes.monitorVolume/100;save();};
  const install=button('安装虚拟声卡',async()=>{status.textContent='正在下载虚拟声卡…';await api.downloadPackage('vb-cable');const result=await api.installPackage('vb-cable');notify(result?.cancelled?'已取消选择安装程序':'请选择 64 位安装程序完成安装');});
  const extra=el('details','voice-more'),summary=el('summary','','声音连接与说明');extra.append(summary,el('p','o4-mouse-muted','启动后自动设为默认麦克风；使用指定设备的语音软件请选择 CABLE Output。电脑播放设备仍选你的耳机。实时返听有处理延迟，默认关闭；录后回放更便于判断。共鸣音色负值偏厚、正值偏亮，不是混响。动态齿音主要处理刺耳的嘶声，不是呼吸声识别。'),install);
  root.append(head,status,presetRow,actions,routing,recorderBox,levels,settings,monitorWrap,extra,el('p','o4-mouse-muted','关闭窗口后声音优化继续在托盘运行；从托盘退出会结束。当前参数自动保存。'));
  container.replaceChildren(root);
  function refreshValues(){for(const [name,{slider,number,suffix}]of controls){slider.value=bank[active][name];number.textContent=bank[active][name]+suffix;slider.disabled=active==='A'&&['formant','deessAmount','deessThreshold','deessFrequency'].includes(name);}preserve.checked=bank.B.preserveFormants;preserve.disabled=active==='A';for(const mode of ['A','B']){presets[mode].classList.toggle('primary',active===mode);presets[mode].setAttribute('aria-pressed',String(active===mode));}}
  function refresh(){
   if(!alive)return;refreshValues();
   run.textContent=engine?.sending?'停止声音优化':'启动声音优化';listening.textContent=engine?.monitorAudio?'关闭返听':'临时开启返听';
   status.textContent=backgroundError||((engine?.sending?'运行中 · 默认麦克风：CABLE Output':engine?'试听处理中 · 尚未发送到语音软件':'未运行')+' · '+active+' 档'+(engine?.monitorAudio?' · 返听已开启':''));
   run.disabled=listening.disabled=busy;input.disabled=!!engine;recordButton.disabled=busy;recordButton.textContent=recording?'结束录音':'录制 A / B 对比';
   for(const mode of ['A','B'])plays[mode].disabled=busy||!clips;
   if(!clips&&playbackURL){playback.pause();playback.removeAttribute('src');playback.load();playback.hidden=true;playbackURL='';}
   if(clips&&!recording&&!playbackURL)clipStatus.textContent='A / B 已录好 · '+clips.A.duration.toFixed(1)+' 秒。停下来听，再选择你喜欢的方案。';
  }
  async function loadDevices(){
   const all=await navigator.mediaDevices.enumerateDevices();if(!alive)return;
   for(const [node,items,selected]of [[input,all.filter(d=>d.kind==='audioinput'&&!/cable output|vb-audio.*cable/i.test(d.label)),routes.input],[headphones,all.filter(d=>d.kind==='audiooutput'&&!cable(d)),routes.monitorOutput]]){
    node.replaceChildren();for(const d of items){const option=el('option','',d.label||'音频设备');option.value=d.deviceId;node.append(option);}
    const choice=items.find(d=>d.deviceId===selected)||items.find(d=>node===input?d.deviceId==='default':/耳机|headphone/i.test(d.label))||items[0];
    if(choice){node.value=choice.deviceId;routes[node===input?'input':'monitorOutput']=choice.deviceId;}
   }save();refresh();
  }
  const timer=setInterval(()=>{if(!alive)return;const s=snapshot();levels.textContent=engine?'输出峰值 '+(Number.isFinite(s.peakDb)?s.peakDb.toFixed(1):'—')+' dB · 压缩减少 '+s.compressionDb.toFixed(1)+' dB · 齿音减少 '+s.deessDb.toFixed(1)+' dB':'启动后显示音量与处理强度';if(recording)clipStatus.textContent='正在同时录制 A / B · '+Math.floor((Date.now()-recording.started)/1000)+' 秒，录完后点“结束录音”。';},150);
  view={refresh,error:message=>{if(alive){status.textContent=message;notify(message);}}};refresh();
  const ready=loadDevices().catch(report);
  const onDeviceChange=()=>loadDevices().catch(report);navigator.mediaDevices.addEventListener('devicechange',onDeviceChange);
  return {ready,dispose(){alive=false;clearInterval(timer);navigator.mediaDevices.removeEventListener('devicechange',onDeviceChange);playback.pause();if(recording)finishRecording().catch(report);if(view?.refresh===refresh)view=null;root.remove();}};
 }
 async function resume(api,notify=()=>{}){backgroundNotify=notify;if(!wanted||engine?.sending)return;if(recovering)return recovering;recovering=send(true,api).catch(error=>{backgroundError='自动启动失败：'+(error.message||String(error));view?.refresh();notify(backgroundError);}).finally(()=>{recovering=null;});return recovering;}
 navigator.mediaDevices?.addEventListener('devicechange',()=>{clearTimeout(deviceTimer);deviceTimer=setTimeout(()=>{if(!wanted)return;if(engine?.sending&&engine.stream.getAudioTracks().some(track=>track.readyState==='live')){apiForRecovery?.activateVoiceDefault().catch(error=>{backgroundError='默认麦克风接管失败：'+error.message;backgroundNotify(backgroundError);view?.refresh();});}else if(apiForRecovery&&!engine)resume(apiForRecovery,backgroundNotify);},800);});
 let apiForRecovery=null;
 const startBackground=(api,notify)=>{apiForRecovery=api;return resume(api,notify);};
 window.One4AllVoice={render,stop,resume:startBackground,isRunning:()=>!!engine,getState:snapshot};
})();
