'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {connect}=require('../app/fgg-provider.js');
const {FggFakeDevice,fakeHid}=require('./fixtures/fgg-hid.cjs');
const {getFggModels}=require('../core/fgg-models.cjs');
const model=getFggModels().find(m=>m.id==='fgg-373b-1064');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const [brand,Provider] of [['mchose',require('../app/mchose-provider.js')],['atk',require('../app/atk-provider.js')]])test(brand+' closes the page without waiting for a pending OS open, and closes the late handle',async()=>{
 let release;const opening=new Promise(resolve=>release=resolve);const device={opened:false,closes:0,async open(){await opening;this.opened=true;},async close(){this.opened=false;this.closes++;},addEventListener(){},removeEventListener(){},async sendReport(){throw Error('Must not send after closing');}};
 const session=new Provider.MouseSession(device,{}),pending=session.command(1);pending.catch(()=>{});await pause(0);
 assert.equal(await Promise.race([session.close().then(()=>true),pause(30).then(()=>false)]),true);
 release();await assert.rejects(pending,/关闭/);assert.equal(device.opened,false);assert.equal(device.closes,1);
});
for(const [brand,create,run]of [
 ['dareu',d=>new(require('../app/dareu-provider.js').Handle)(d,5),s=>s.command(0,0,128,3)],
 ['rapoo',d=>new(require('../app/rapoo-provider.js').MouseSession)(d,{productIds:[1,2]}),s=>s.command(new Uint8Array([255,163,0]))],
 ['aula',d=>new(require('../app/aula-provider.js').MouseSession)(d,{},{}),s=>s.enqueue(()=>s.transport.command(1))]
])test(brand+' closes pending OS open promptly without a late report',async()=>{
 let release;const device={opened:false,closes:0,async open(){await new Promise(resolve=>release=resolve);this.opened=true;},async close(){this.opened=false;this.closes++;},async sendReport(){assert.fail('Late report after closing');},async sendFeatureReport(){assert.fail('Late report after closing');}};
 const session=create(device),pending=run(session);pending.catch(()=>{});await pause(0);assert.equal(await Promise.race([session.close().then(()=>true),pause(30).then(()=>false)]),true);release();await assert.rejects(pending,/关闭/);await pause(0);assert.equal(device.opened,false);assert.equal(device.closes,1);
});
test('FGG device chooser is not limited by the packet response timeout',async()=>{
 const device=new FggFakeDevice();
 const session=await connect({model,timeoutMs:10,hid:{...fakeHid(device),getDevices:async()=>[],requestDevice:async()=>{await pause(40);return [device];}}});
 assert.equal(session.device.connected,true);await session.close();
});
test('FGG HID disconnect notifies the UI and releases the device for reconnect',async()=>{
 const device=new FggFakeDevice(),hid=new EventTarget();Object.assign(hid,fakeHid(device));
 hid.addEventListener=EventTarget.prototype.addEventListener;hid.removeEventListener=EventTarget.prototype.removeEventListener;
 const session=await connect({model,hid});let disconnected=0;session.onDisconnect(()=>disconnected++);
 const event=new Event('disconnect');event.device=device;hid.dispatchEvent(event);await pause(0);
 assert.equal(disconnected,1);assert.equal(session.device.connected,false);
 const next=await connect({model,hid});await next.close();assert.equal(device.closes,2);
});
