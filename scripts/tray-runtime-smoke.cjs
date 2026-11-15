'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runChild() {
  const {app, BrowserWindow, Tray, Menu} = require('electron');
  const {createTrayController} = require('../core/tray-controller.cjs');
  const folder = process.env.ONE4ALL_TRAY_SMOKE_STATE;
  if (!folder) throw Error('Missing isolated smoke-test state directory');
  app.setPath('userData', path.join(folder, 'browser'));
  app.setName('One4All Tray Smoke');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  const report = {success:false, microphoneUsed:false, physicalAudioOutputUsed:false};
  const writeReport = () => fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(report, null, 2));
  try {
    await app.whenReady();
    const win = new BrowserWindow({
      show:false, skipTaskbar:true, width:320, height:240,
      webPreferences:{contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false}
    });
    // windowsHide sets the process's first ShowWindow request to SW_HIDE.
    // Consume that startup instruction before exercising a later tray restore.
    win.showInactive();
    win.hide();
    let menu;
    const controller = createTrayController({
      app, window:win, Tray,
      Menu:{buildFromTemplate(template) { menu=Menu.buildFromTemplate(template);return menu; }},
      iconPath:path.join(root, 'app', 'assets', 'one4all.ico'),
      onError(error) { throw error; }
    });
    assert.ok(controller.tray && !controller.tray.isDestroyed(), 'Real tray icon was created');
    const page=path.join(folder,'tray-smoke.html');
    fs.writeFileSync(page,'<!doctype html><meta charset="utf-8"><title>One4All tray smoke</title>');
    await win.loadFile(page);
    const identity = await win.webContents.executeJavaScript(`(async()=>{
      window.smokeIdentity = Math.random().toString(36);
      window.smokeAudio = new AudioContext({sampleRate:48000, sinkId:{type:'none'}});
      if(smokeAudio.sinkId?.type!=='none')throw Error('Silent audio sink is unavailable');
      const oscillator=smokeAudio.createOscillator();
      window.smokeMeter=smokeAudio.createAnalyser();
      oscillator.connect(smokeMeter).connect(smokeAudio.destination);
      oscillator.start();
      await smokeAudio.resume();
      return smokeIdentity;
    })()`);
    const renderer = win.webContents.getOSProcessId();
    const sample = () => win.webContents.executeJavaScript(`(()=>{
      const samples=new Float32Array(smokeMeter.fftSize);smokeMeter.getFloatTimeDomainData(samples);
      return {identity:smokeIdentity,time:smokeAudio.currentTime,state:smokeAudio.state,
        rms:Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),sink:smokeAudio.sinkId.type};
    })()`);
    await pause(100);
    const before = await sample();
    win.close();
    assert.equal(win.isDestroyed(), false, 'Closing the window must preserve it');
    assert.equal(win.isVisible(), false, 'Closing the window must hide it');
    await pause(350);
    const hidden = await sample();
    assert.equal(hidden.identity, identity);
    assert.equal(win.webContents.getOSProcessId(), renderer);
    assert.equal(hidden.state, 'running');
    assert.equal(hidden.sink, 'none');
    assert.ok(hidden.time-before.time>0.15, 'Audio clock continues in the hidden window');
    assert.ok(hidden.rms>0.1, 'Synthetic audio continues while hidden');
    const shown=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Tray window did not become visible')),2000);
      win.once('show',()=>{clearTimeout(timer);resolve();});
    });
    controller.tray.emit('click');
    await shown;
    const showDeadline=Date.now()+2000;
    while(!win.isVisible()&&Date.now()<showDeadline)await pause(20);
    report.showState={visible:win.isVisible(),minimized:win.isMinimized(),bounds:win.getBounds()};
    assert.equal(win.isVisible(), true, 'Tray click restores the window');
    assert.equal(win.webContents.getOSProcessId(), renderer);
    assert.equal((await sample()).identity, identity);
    win.hide();
    report.hiddenAudioSeconds=Number((hidden.time-before.time).toFixed(3));
    report.hiddenAudioRms=Number(hidden.rms.toFixed(3));
    report.sameRendererRestored=true;
    report.menuItems=menu.items.map(item=>item.label).filter(Boolean);
    const quitItem=menu.items.find(item=>item.label==='退出 One4All');
    assert.ok(quitItem, 'Tray menu exposes explicit application exit');
    app.once('will-quit', () => {
      try {
        assert.equal(win.isDestroyed(), true, 'Explicit quit destroys the window');
        report.explicitQuitReached=true;
        report.success=true;
        writeReport();
      } catch(error) {
        report.error=error.stack;
        writeReport();
        process.exitCode=1;
      }
    });
    quitItem.click();
  } catch(error) {
    report.error=error.stack;
    writeReport();
    app.exit(1);
  }
}

async function main() {
  const electron=process.env.ONE4ALL_ELECTRON || path.resolve(root, '../One4All-Desktop/vendor/electron/electron.exe');
  assert.ok(fs.existsSync(electron), 'Electron runtime was not found');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(), 'one4all-tray-smoke-'));
  const env={...process.env,ONE4ALL_TRAY_SMOKE_STATE:folder};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron, [__filename], {env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-16000);});
  let timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;child.kill();},20000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(deadline));
  const file=path.join(folder,'result.json');
  const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{success:false};
  console.log(JSON.stringify({...report,exitCode:code,timedOut,reportFile:file,...(!report.success?{output}:{})},null,2));
  assert.equal(timedOut,false,'Tray smoke process must exit on its own');
  assert.equal(code,0,'Tray smoke process must exit successfully');
  assert.equal(report.success,true,report.error||'Tray smoke report was not completed');
  return report;
}

if(process.versions.electron)runChild().catch(error=>{console.error(error);require('electron').app.exit(1);});
else if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
