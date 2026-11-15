'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {attachPageNavigation}=require('../core/page-navigation.cjs');
function setup(){const contents=new EventEmitter(),loaded=[],opened=[],errors=[];contents.setWindowOpenHandler=handler=>contents.popup=handler;contents.loadURL=async url=>loaded.push(url);attachPageNavigation(contents,{inside:url=>url.startsWith('file:///device.html'),openExternal:async url=>opened.push(url),onError:error=>errors.push(error)});return {contents,loaded,opened,errors};}
test('ordinary external links open in the browser instead of silently disappearing',()=>{
 const {contents,opened}=setup();assert.deepEqual(contents.popup({url:'https://vendor.example/downloads'}),{action:'deny'});
 let prevented=false;contents.emit('will-navigate',{preventDefault(){prevented=true;}},'https://vendor.example/help');
 assert.ok(prevented);assert.deepEqual(opened,['https://vendor.example/downloads','https://vendor.example/help']);
});
test('local page transitions remain in the device panel',()=>{
 const {contents,loaded,opened}=setup();contents.popup({url:'file:///device.html#settings'});
 contents.emit('will-navigate',{preventDefault(){assert.fail('local page was blocked');}},'file:///device.html?theme=light');
 assert.deepEqual(loaded,['file:///device.html#settings']);assert.deepEqual(opened,[]);
});
test('external redirects are handed off and arbitrary local executables are not links',()=>{
 const {contents,opened}=setup();contents.emit('will-redirect',{preventDefault(){}},'https://cdn.vendor.example/manual');
 contents.popup({url:'file:///C:/program.exe'});assert.deepEqual(opened,['https://cdn.vendor.example/manual']);
});
