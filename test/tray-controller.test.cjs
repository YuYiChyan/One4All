'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createTrayController}=require('../core/tray-controller.cjs');

function setup({fail=false}={}) {
  const app=new EventEmitter(),window=new EventEmitter();
  let destroyed=false,visible=true,minimized=false,menu;
  Object.assign(window,{
    isDestroyed:()=>destroyed,isMinimized:()=>minimized,
    hide(){visible=false;},show(){visible=true;},focus(){},
    minimize(){minimized=true;},restore(){minimized=false;},
    close(){let prevented=false;window.emit('close',{preventDefault(){prevented=true;}});if(!prevented){destroyed=true;window.emit('closed');}}
  });
  app.quit=()=>{app.emit('before-quit');window.close();if(destroyed)app.emit('will-quit');};
  class Tray extends EventEmitter {
    constructor(){super();if(fail)throw Error('Tray unavailable');this.destroyed=false;}
    isDestroyed(){return this.destroyed;}
    destroy(){this.destroyed=true;}
    setToolTip(){}
    setContextMenu(value){menu=value;}
  }
  const errors=[];
  const controller=createTrayController({app,window,Tray,Menu:{buildFromTemplate:items=>items},iconPath:'app.ico',onError:error=>errors.push(error)});
  return {app,window,controller,errors,get menu(){return menu;},get visible(){return visible;}};
}

test('closing hides the same window; tray restores it from minimized state',()=>{
  const f=setup();f.window.close();assert.equal(f.visible,false);assert.equal(f.window.isDestroyed(),false);
  f.window.minimize();f.controller.tray.emit('click');assert.equal(f.visible,true);assert.equal(f.window.isMinimized(),false);
  f.window.close();f.controller.tray.emit('double-click');assert.equal(f.visible,true);f.controller.dispose();
});
test('tray exit permits close, releases tray and preserves other quit listeners',()=>{
  const f=setup();let cleaned=0;f.app.on('before-quit',()=>cleaned++);
  f.window.close();f.menu.find(item=>item.label==='退出 One4All').click();
  assert.equal(cleaned,1);assert.equal(f.window.isDestroyed(),true);assert.equal(f.controller.tray.isDestroyed(),true);assert.equal(f.controller.state.disposed,true);
});
test('direct app quit is not intercepted by close-to-tray',()=>{
  const f=setup();f.app.quit();assert.equal(f.window.isDestroyed(),true);assert.equal(f.controller.state.active,false);
});
test('failed or destroyed tray never traps an invisible application',()=>{
  const failed=setup({fail:true});assert.equal(failed.errors.length,1);failed.window.close();assert.equal(failed.window.isDestroyed(),true);
  const lost=setup();lost.controller.tray.destroy();lost.window.close();assert.equal(lost.window.isDestroyed(),true);
});
test('Windows session shutdown is allowed to close the window',()=>{
  const f=setup();f.window.emit('query-session-end',{});f.window.close();assert.equal(f.window.isDestroyed(),true);assert.equal(f.controller.state.active,false);
});
