'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {createAppearanceStore,validateAppearance}=require('../core/hid/appearance-store.cjs');
const id='a'.repeat(20),defaults={name:'',imageDataUrl:'',deviceType:'auto'};
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-appearance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function png(){const crc=buffer=>{let n=0xffffffff;for(const b of buffer){n^=b;for(let i=0;i<8;i++)n=n&1?(n>>>1)^0xedb88320:n>>>1;}return(n^0xffffffff)>>>0;};const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1500);ihdr.writeUInt32BE(1500,4);ihdr[8]=8;ihdr[9]=2;const raw=Buffer.alloc((1500*3+1)*1500);const compressed=zlib.deflateSync(raw,{level:0});return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0))]);}
test('local artwork accepts a real PNG above 2 MB and 1200 px, and a longer name',()=>{
 const image=png();assert(image.length>2000000);const name='键盘'.repeat(50);const value=validateAppearance({name,imageDataUrl:'data:image/png;base64,'+image.toString('base64')});assert.equal(value.name,name);assert.throws(()=>validateAppearance({name,imageDataUrl:'data:image/png;base64,YWJj'}),/格式/);
});
for(const content of ['{ broken json','null','false',JSON.stringify({salt:'bad',devices:[]})])test('corrupt appearance metadata does not prevent startup and original bytes are preserved',t=>{
 const dir=directory(t),file=path.join(dir,'keyboard-appearance.json');fs.writeFileSync(file,content);const store=createAppearanceStore(dir);assert.deepEqual(store.get(id),defaults);assert.equal(fs.readFileSync(file,'utf8'),content);assert.equal(fs.readdirSync(dir).length,1);
 store.set(id,{name:'Recovered',imageDataUrl:''});const backup=fs.readdirSync(dir).find(name=>name.includes('.preserved-'));assert(backup);assert.equal(fs.readFileSync(path.join(dir,backup),'utf8'),content);assert.equal(createAppearanceStore(dir).get(id).name,'Recovered');
});
test('one invalid saved appearance falls back without changing other saved devices',t=>{
 const dir=directory(t),file=path.join(dir,'keyboard-appearance.json'),other='b'.repeat(20),content=JSON.stringify({salt:'c'.repeat(64),devices:{[id]:{name:4},[other]:{name:'Kept',imageDataUrl:''}}});fs.writeFileSync(file,content);const store=createAppearanceStore(dir);assert.deepEqual(store.get(id),defaults);assert.equal(store.get(other).name,'Kept');assert.equal(fs.readFileSync(file,'utf8'),content);
});
