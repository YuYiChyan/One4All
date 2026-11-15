'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

async function child(){
  const {app,BrowserWindow}=require('electron');
  const state=process.env.ONE4ALL_NATURAL_PITCH_SMOKE;
  const report={success:false,microphoneUsed:false,physicalAudioOutputUsed:false};
  app.setPath('userData',path.join(state,'browser'));
  app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
  try{
    await app.whenReady();
    const win=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
    const page=path.join(state,'index.html');
    const script=pathToFileURL(path.join(root,'app/voice-natural-pitch.js')).href;
    fs.writeFileSync(page,`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"><script src="${script}"></script>`);
    await win.loadFile(page);
    report.measurements=await win.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
      if(context.sinkId?.type!=='none')throw Error('Silent sink is unavailable');
      const processor=await One4AllNaturalPitch.create(context,{pitch:0,formant:0,preserveFormants:true});
      const analyser=context.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;
      processor.output.connect(analyser).connect(context.destination);
      const oscillator=context.createOscillator();oscillator.frequency.value=220;oscillator.connect(processor.input);oscillator.start();
      await context.resume();
      function measure(low=40,high=2000){
        const db=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(db);
        const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
        const finite=Array.from(samples).every(Number.isFinite);
        let max=-Infinity,bin=0;
        for(let i=Math.ceil(low*analyser.fftSize/context.sampleRate);i<Math.min(db.length,high*analyser.fftSize/context.sampleRate);i++)if(db[i]>max){max=db[i];bin=i;}
        const harmonics=Array.from({length:20},(_,i)=>{const b=Math.round((i+1)*120*analyser.fftSize/context.sampleRate);return Math.max(...db.slice(b-1,b+2));});
        let fundamentalBin=0,fundamentalMax=-Infinity;
        for(let i=Math.ceil(100*analyser.fftSize/context.sampleRate);i<150*analyser.fftSize/context.sampleRate;i++)if(db[i]>fundamentalMax){fundamentalMax=db[i];fundamentalBin=i;}
        return {
          peakHz:bin*context.sampleRate/analyser.fftSize,
          rms:Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length),finite,
          peak100To150Hz:fundamentalBin*context.sampleRate/analyser.fftSize,
          envelope840vs600Db:harmonics[6]-harmonics[4],
          envelope480vs1200Db:harmonics[3]-harmonics[9]
        };
      }
      await wait(500);const normal=measure();
      await processor.set({pitch:12});await wait(500);const octave=measure();
      oscillator.stop();oscillator.disconnect();
      const vowel=context.createOscillator(),real=new Float32Array(81),imag=new Float32Array(81);
      for(let k=1;k<imag.length;k++){const f=k*120;imag[k]=(.5+1.3*Math.exp(-(((f-600)/100)**2))+.8*Math.exp(-(((f-1400)/180)**2)))/Math.sqrt(k);}
      vowel.setPeriodicWave(context.createPeriodicWave(real,imag));vowel.frequency.value=120;vowel.connect(processor.input);vowel.start();
      await processor.set({pitch:0,formant:0,preserveFormants:true});await wait(650);const neutralFormant=measure(400,1100);
      await processor.set({formant:6});await wait(650);const shiftedFormant=measure(400,1300);
      await processor.set({pitch:12,formant:0,preserveFormants:false});await wait(650);const uncompensatedPitch=measure(400,2000);
      await processor.set({preserveFormants:true});await wait(650);const compensatedPitch=measure(400,2000);
      const result={latencySeconds:processor.latencySeconds,normal,octave,neutralFormant,shiftedFormant,uncompensatedPitch,compensatedPitch};
      vowel.stop();vowel.disconnect();processor.dispose();processor.dispose();await context.close();return result;
    })()`);
    const m=report.measurements;
    assert.ok(m.latencySeconds>0&&m.latencySeconds<0.1,'Speech algorithm latency should remain below 100 ms');
    assert.ok(Math.abs(m.normal.peakHz-220)<10,'Unshifted sine stays at 220 Hz');
    assert.ok(Math.abs(m.octave.peakHz-440)<10,'Live pitch update moves sine to 440 Hz');
    for(const signal of [m.normal,m.octave,m.neutralFormant,m.shiftedFormant,m.uncompensatedPitch,m.compensatedPitch])assert.ok(signal.finite&&signal.rms>.01,'DSP produces finite nonzero audio');
    // Formant shifting changes the envelope, not the harmonic frequencies. The
    // strongest harmonic can stay in place even when its envelope has moved.
    assert.ok(m.shiftedFormant.envelope840vs600Db>m.neutralFormant.envelope840vs600Db+3,'Formant shift raises the vowel spectral envelope');
    assert.ok(Math.abs(m.shiftedFormant.peak100To150Hz-120)<6&&Math.abs(m.neutralFormant.peak100To150Hz-120)<6,'Formant-only update preserves the fundamental');
    assert.ok(m.compensatedPitch.envelope480vs1200Db>m.uncompensatedPitch.envelope480vs1200Db+3,'Pitch compensation preserves a lower vowel envelope than uncompensated pitch');
    report.success=true;
    win.destroy();
  }catch(error){report.error=error.stack;}
  fs.writeFileSync(path.join(state,'result.json'),JSON.stringify(report,null,2));app.exit(report.success?0:1);
}
async function main(){
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-natural-pitch-'));
  const electron=process.env.ONE4ALL_ELECTRON||path.resolve(root,'../One4All-Desktop/vendor/electron/electron.exe');
  const env={...process.env,ONE4ALL_NATURAL_PITCH_SMOKE:state};delete env.ELECTRON_RUN_AS_NODE;
  const proc=spawn(electron,[__filename],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [proc.stdout,proc.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-6000));
  const timeout=setTimeout(()=>proc.kill(),20000);
  const code=await new Promise((resolve,reject)=>{proc.once('exit',resolve);proc.once('error',reject);}).finally(()=>clearTimeout(timeout));
  const file=path.join(state,'result.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{success:false};
  console.log(JSON.stringify({...report,exitCode:code,reportFile:file,...(!report.success?{output}:{})},null,2));
  assert.equal(code,0);assert.equal(report.success,true);
}
if(process.versions.electron)child().catch(error=>{console.error(error);require('electron').app.exit(1);});
else if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
