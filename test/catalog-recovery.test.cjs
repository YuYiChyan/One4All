'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDeviceCatalog}=require('../core/device-catalog.cjs');
test('one malformed brand does not block other devices and can be retried',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'one4all-catalog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const brand of ['atk','aula'])fs.mkdirSync(path.join(root,brand));
 const write=(brand,rows)=>fs.writeFileSync(path.join(root,brand,'catalog.json'),JSON.stringify({devices:rows}));
 write('atk',[{id:'fixture-atk',name:'fixture'}]);fs.writeFileSync(path.join(root,'aula','catalog.json'),'{');
 const catalog=createDeviceCatalog({resourceRoot:root});let result=catalog.list();assert.ok(result.devices.some(d=>d.id==='fixture-atk'));assert.deepEqual(result.warnings.map(w=>w.brand),['aula']);
 write('aula',[{id:'fixture-aula',name:'fixture'}]);result=catalog.list();assert.equal(result.warnings.length,0);assert.ok(result.devices.some(d=>d.id==='fixture-aula'));
 fs.writeFileSync(path.join(root,'aula','catalog.json'),'{');result=catalog.list();assert.ok(result.devices.some(d=>d.id==='fixture-aula'));assert.equal(result.warnings[0].usingPrevious,true);
});
