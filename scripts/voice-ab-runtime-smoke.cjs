'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

function setupRenderer() {
  const legacy={pitch:1.75,low:-2,softness:2,clarity:2.5,breath:3,noise:9,threshold:-20,ratio:1.5,attack:12,release:140};
  localStorage.setItem('one4all-voice-settings',JSON.stringify({...legacy,input:'test-microphone',output:'test-cable'}));
  localStorage.removeItem('one4all-voice-presets-v1');
  const fixture=window.voiceFixture={legacy,contexts:[],streams:[],getUserMediaCalls:0,sinks:[],plays:[],blobs:[],recorders:[],notices:[],csp:[]};
  document.addEventListener('securitypolicyviolation',event=>fixture.csp.push({directive:event.violatedDirective,blocked:event.blockedURI}));
  const NativeContext=window.AudioContext;
  window.AudioContext=class SilentContext extends NativeContext {
    constructor(options={}) {
      super({...options,sinkId:{type:'none'}});
      if(this.sinkId?.type!=='none')throw Error('Silent audio sink is unavailable');
      fixture.contexts.push(this);
    }
    async setSinkId(id) {
      fixture.sinks.push({kind:'context',id});
      if(typeof id==='string'&&id!=='test-cable')throw Error('Unexpected voice route '+id);
      return super.setSinkId({type:'none'});
    }
  };
  HTMLMediaElement.prototype.setSinkId=async function(id) {
    if(id!=='test-headphones')throw Error('Playback did not select the independent headphones');
    this.testSinkId=id;fixture.sinks.push({kind:'media',id});
  };
  HTMLMediaElement.prototype.play=async function() {
    this.muted=true;
    fixture.plays.push({sink:this.testSinkId,src:this.src,hasStream:!!this.srcObject});
  };
  const NativeRecorder=window.MediaRecorder;
  window.MediaRecorder=class TestRecorder extends NativeRecorder {
    constructor(stream,options){super(stream,options);fixture.recorders.push(this);}
    start(...args){this.testStarted=performance.now();return super.start(...args);}
  };
  const createURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=value=>{
    const url=createURL(value);
    if(value instanceof Blob&&value.type.startsWith('audio/'))fixture.blobs.push({url,blob:value});
    return url;
  };
  const media=new EventTarget();
  media.enumerateDevices=async()=>[
    {kind:'audioinput',deviceId:'test-microphone',label:'Synthetic microphone'},
    {kind:'audioinput',deviceId:'test-virtual-mic',label:'CABLE Output (VB-Audio Virtual Cable)'},
    {kind:'audiooutput',deviceId:'test-cable',label:'CABLE Input (VB-Audio Virtual Cable)'},
    {kind:'audiooutput',deviceId:'test-cable16',label:'CABLE In 16ch (VB-Audio Virtual Cable)'},
    {kind:'audiooutput',deviceId:'test-headphones',label:'Headphone synthetic'}
  ];
  media.getUserMedia=async options=>{
    fixture.getUserMediaCalls++;
    if(options.audio.deviceId?.exact!=='test-microphone')throw Error('Unexpected microphone selection');
    const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),destination=context.createMediaStreamDestination();
    const oscillator=context.createOscillator(),gain=context.createGain(),real=new Float32Array(61),imaginary=new Float32Array(61);
    for(let k=1;k<imaginary.length;k++){
      const f=k*130;
      imaginary[k]=(0.3+1.3*Math.exp(-(((f-650)/130)**2))+0.8*Math.exp(-(((f-1500)/220)**2)))/Math.sqrt(k);
    }
    oscillator.setPeriodicWave(context.createPeriodicWave(real,imaginary));oscillator.frequency.value=130;
    gain.gain.value=0.22;oscillator.connect(gain).connect(destination);oscillator.start();await context.resume();
    const stream=destination.stream,track=stream.getAudioTracks()[0],getSettings=track.getSettings.bind(track);
    track.getSettings=()=>({...getSettings(),deviceId:'test-microphone'});
    fixture.streams.push(stream);return stream;
  };
  Object.defineProperty(navigator,'mediaDevices',{value:media,configurable:true});
  fixture.api={voiceModelAssets:async()=>{
    const [wasm,model]=await Promise.all(['df_bg.wasm','DeepFilterNet3_onnx.tar.gz'].map(async name=>new Uint8Array(await(await fetch('voice-vendor/deepfilter/'+name)).arrayBuffer())));
    return {wasm,model};
  }};
}

async function exerciseRenderer() {
  const fixture=voiceFixture,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const findButton=text=>{const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent===text);check(button,'Missing button '+text);return button;};
  const click=async text=>{const button=findButton(text);check(!button.disabled,'Disabled button '+text);await button.onclick();};
  const view=One4AllVoice.render(document.getElementById('content'),{api:fixture.api,notify:text=>fixture.notices.push(text),onBack:()=>{}});
  await view.ready;
  let state=One4AllVoice.getState();
  for(const [name,value] of Object.entries(fixture.legacy))check(state.presets.A[name]===value,'Legacy value changed: '+name);
  check(state.active==='A'&&!state.monitoring,'Migration must select A with monitoring off');
  check(!fixture.plays.length,'Monitoring must not autoplay');
  check(!Array.from(document.querySelector('[aria-label="输入麦克风"]').options).some(option=>option.value==='test-virtual-mic'),'The virtual microphone must not feed back into itself');
  await click('B · 自然方案');
  const formant=document.querySelector('[aria-label="共鸣音色"]');
  check(!formant.disabled,'B formant control is disabled');formant.value='1.25';formant.dispatchEvent(new Event('input',{bubbles:true}));
  state=One4AllVoice.getState();
  check(state.active==='B'&&state.presets.B.formant===1.25,'B formant change was not saved');
  for(const [name,value] of Object.entries(fixture.legacy))check(state.presets.A[name]===value,'Editing B changed A: '+name);
  await click('启动声音优化');
  state=One4AllVoice.getState();
  check(state.running&&state.sending&&!state.monitoring,'Voice sender should run without monitoring');
  check(fixture.sinks.some(sink=>sink.kind==='context'&&sink.id==='test-cable'),'Voice sender did not select the cable');
  await click('录制 A / B 对比');
  check(One4AllVoice.getState().recording,'Recording did not start');
  check(fixture.getUserMediaCalls===1&&fixture.recorders.length===2,'A/B must share one microphone and record two branches');
  const startGap=Math.abs(fixture.recorders[0].testStarted-fixture.recorders[1].testStarted);
  check(startGap<50,'A/B recordings did not start together');
  await wait(1200);
  await click('结束录音');
  state=One4AllVoice.getState();
  check(state.recorded&&!state.recording&&state.sending,'A/B clips were not completed while preserving sending');
  check(fixture.blobs.length===2,'Expected two recorded audio blobs');
  const decoder=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),decoded=[];
  for(const {blob} of fixture.blobs){
    const audio=await decoder.decodeAudioData(await blob.arrayBuffer());let sum=0,count=0;
    for(let ch=0;ch<audio.numberOfChannels;ch++){const samples=audio.getChannelData(ch);for(const value of samples){check(Number.isFinite(value),'Non-finite recorded audio');sum+=value*value;count++;}}
    const rms=Math.sqrt(sum/count);check(audio.duration>0.5&&rms>1e-5,'Recording is empty or silent');
    decoded.push({duration:audio.duration,rms,bytes:blob.size});
  }
  const volumes=[];
  for(const mode of ['A','B']){
    await click('回放 '+mode);
    const playback=document.querySelector('audio');
    check(playback.testSinkId==='test-headphones'&&playback.src.startsWith('blob:'),'Replay routing is incorrect');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Recorded blob metadata did not load')),3000);
      playback.onloadedmetadata=()=>{clearTimeout(timer);resolve();};
      playback.onerror=()=>{clearTimeout(timer);reject(Error('Recorded blob was rejected by media loading/CSP'));};
      playback.load();
    });
    check(playback.duration>0.5,'Media element could not decode the recorded blob');
    volumes.push(playback.volume);
  }
  check(Math.abs(decoded[0].rms*volumes[0]-decoded[1].rms*volumes[1])<1e-4,'A/B replay loudness is not aligned');
  check(One4AllVoice.getState().routes.output==='test-cable','Replay changed the voice-cable route');
  await click('临时开启返听');check(One4AllVoice.getState().monitoring&&One4AllVoice.getState().sending,'Independent monitor failed');
  await click('关闭返听');check(!One4AllVoice.getState().monitoring&&One4AllVoice.getState().sending,'Stopping monitor interrupted sending');
  await One4AllVoice.stop();
  check(!One4AllVoice.isRunning()&&fixture.streams[0].getAudioTracks().every(track=>track.readyState==='ended'),'Stop did not release the synthetic input track');
  await click('录制 A / B 对比');
  check(One4AllVoice.getState().recording&&!One4AllVoice.getState().sending,'Recording-only mode did not start');
  await wait(800);await click('结束录音');
  state=One4AllVoice.getState();
  check(state.recorded&&!state.running,'Recording-only mode did not release its engine');
  check(fixture.streams.every(stream=>stream.getAudioTracks().every(track=>track.readyState==='ended')),'An input track remained active');
  const saved=JSON.parse(localStorage.getItem('one4all-voice-settings'));
  check(saved.output==='test-cable'&&saved.monitorOutput==='test-headphones','Saved routes changed during replay');
  check(!fixture.csp.length,'CSP blocked an A/B dependency or recording');
  check(!fixture.notices.length,'UI reported errors: '+fixture.notices.join('; '));
  const report={legacyParametersPreserved:10,activePreset:state.active,formant:state.presets.B.formant,monitorInitiallyOff:true,recordingStartGapMs:startGap,decoded,alignedVolumes:volumes,routes:saved.output+' -> voice; '+saved.monitorOutput+' -> listening',recordingOnlyReleased:true,allInputTracksEnded:true,cspViolations:fixture.csp,contextsUsed:fixture.contexts.length};
  view.dispose();await Promise.all(fixture.contexts.filter(context=>context.state!=='closed').map(context=>context.close()));return report;
}

async function child() {
  const {app,BrowserWindow}=require('electron');
  const state=process.env.ONE4ALL_VOICE_AB_SMOKE;
  const report={success:false,microphoneUsed:false,physicalAudioOutputUsed:false};
  app.setPath('userData',path.join(state,'browser'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
  try {
    await app.whenReady();
    const assets=path.join(state,'app');fs.mkdirSync(assets,{recursive:true});
    for(const name of ['voice-controls.js','voice-natural-pitch.js','voice-deesser-processor.js'])fs.copyFileSync(path.join(root,'app',name),path.join(assets,name));
    fs.cpSync(path.join(root,'app','voice-vendor'),path.join(assets,'voice-vendor'),{recursive:true});
    const csp=fs.readFileSync(path.join(root,'app','index.html'),'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    report.csp=csp;
    fs.writeFileSync(path.join(assets,'setup.js'),'('+setupRenderer.toString()+')();');
    fs.writeFileSync(path.join(assets,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><div id="content"></div><script src="setup.js"></script><script src="voice-natural-pitch.js"></script><script src="voice-controls.js"></script>`);
    const win=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    await win.loadFile(path.join(assets,'index.html'));
    report.measurements=await win.webContents.executeJavaScript('('+exerciseRenderer.toString()+')()',true);
    report.success=true;win.destroy();
  }catch(error){report.error=error.stack;}
  fs.writeFileSync(path.join(state,'result.json'),JSON.stringify(report,null,2));app.exit(report.success?0:1);
}

async function main() {
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-voice-ab-'));
  const electron=process.env.ONE4ALL_ELECTRON||path.resolve(root,'../One4All-Desktop/vendor/electron/electron.exe');
  const env={...process.env,ONE4ALL_VOICE_AB_SMOKE:state};delete env.ELECTRON_RUN_AS_NODE;
  const proc=spawn(electron,[__filename],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',timedOut=false;for(const stream of [proc.stdout,proc.stderr])stream.on('data',data=>output=(output+data).slice(-7000));
  const timer=setTimeout(()=>{timedOut=true;proc.kill();},45000);
  const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  const file=path.join(state,'result.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{success:false};
  console.log(JSON.stringify({...report,exitCode:code,timedOut,reportFile:file,...(!report.success?{output}:{})},null,2));
  assert.equal(timedOut,false);assert.equal(code,0);assert.equal(report.success,true);
}
if(process.versions.electron)child().catch(error=>{console.error(error);require('electron').app.exit(1);});
else if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
