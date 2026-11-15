'use strict';

function createTrayController({app,window,Tray,Menu,iconPath,onError=()=>{}}) {
  let tray=null, quitting=false, disposed=false;
  const active=()=>!disposed&&!!tray&&!tray.isDestroyed();
  function show() {
    if(disposed||window.isDestroyed())return;
    if(window.isMinimized())window.restore();
    window.show();
    window.focus();
  }
  function beginQuit(){quitting=true;}
  function close(event) {
    if(quitting||!active())return;
    event.preventDefault();
    window.hide();
  }
  function dispose() {
    if(disposed)return;
    disposed=true;
    window.off('close',close);
    window.off('closed',dispose);
    window.off('query-session-end',beginQuit);
    window.off('session-end',beginQuit);
    app.off('before-quit',beginQuit);
    app.off('will-quit',dispose);
    if(tray&&!tray.isDestroyed())tray.destroy();
  }
  const controller={show,dispose,get tray(){return tray;},get state(){return {active:active(),quitting,disposed};}};
  try {
    tray=new Tray(iconPath);
    tray.setToolTip('One4All');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开 One4All',click:show},
      {type:'separator'},
      {label:'退出 One4All',click(){beginQuit();app.quit();}}
    ]));
    tray.on('click',show);
    tray.on('double-click',show);
  } catch(error) {
    if(tray&&!tray.isDestroyed())tray.destroy();
    tray=null;
    onError(error);
    return controller;
  }
  window.on('close',close);
  window.on('closed',dispose);
  window.on('query-session-end',beginQuit);
  window.on('session-end',beginQuit);
  app.on('before-quit',beginQuit);
  app.on('will-quit',dispose);
  return controller;
}

module.exports={createTrayController};
