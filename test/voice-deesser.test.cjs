'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sampleRate=48000,block=128;
const source=fs.readFileSync(path.join(__dirname,'../app/voice-deesser-processor.js'),'utf8');

function create() {
  let Processor;
  const messages=[];
  vm.runInNewContext(source,{
    sampleRate,
    AudioWorkletProcessor:class {constructor(){this.port={postMessage:value=>messages.push({...value})};}},
    registerProcessor(name,ctor){assert.equal(name,'one4all-deesser');Processor=ctor;}
  });
  return {processor:new Processor(),messages};
}
function render({seconds=0.6,channels=1,signal,amount=6,threshold=-40,frequency=4000}) {
  const {processor,messages}=create();
  const size=Math.ceil(seconds*sampleRate/block)*block;
  const input=Array.from({length:channels},()=>new Float32Array(block));
  const output=Array.from({length:channels},()=>new Float32Array(block));
  const original=Array.from({length:channels},()=>new Float32Array(size));
  const result=Array.from({length:channels},()=>new Float32Array(size));
  const params={amount:new Float32Array([amount]),threshold:new Float32Array([threshold]),frequency:new Float32Array([frequency])};
  for(let offset=0;offset<size;offset+=block) {
    for(let ch=0;ch<channels;ch++)for(let i=0;i<block;i++)input[ch][i]=signal(offset+i,ch);
    assert.equal(processor.process([input],[output],params),true);
    for(let ch=0;ch<channels;ch++){original[ch].set(input[ch],offset);result[ch].set(output[ch],offset);}
  }
  return {processor,params,input,output,original,result,messages};
}
const tone=(frequency,amplitude,time)=>amplitude*Math.sin(2*Math.PI*frequency*time/sampleRate);
function rms(values,from=Math.floor(values.length/2)) {
  let sum=0;for(let i=from;i<values.length;i++)sum+=values[i]*values[i];return Math.sqrt(sum/(values.length-from));
}
function amplitude(values,frequency,from=sampleRate/5) {
  // Use an integral 0.2-second section to separate the low/high synthetic tones.
  const count=sampleRate/5;let real=0,imaginary=0;
  for(let i=from;i<from+count;i++){const angle=2*Math.PI*frequency*i/sampleRate;real+=values[i]*Math.cos(angle);imaginary+=values[i]*Math.sin(angle);}
  return 2*Math.hypot(real,imaginary)/count;
}

test('amount zero is an exact mono/stereo bypass, including transients',()=>{
  for(const channels of [1,2]) {
    const {original,result}=render({channels,amount:0,signal:(i,ch)=>tone(230+ch*110,0.3,i)+tone(11000,0.25,i)+(i%313===0?0.8:0)});
    for(let ch=0;ch<channels;ch++)assert.deepEqual(result[ch],original[ch]);
  }
});

test('de-essing attenuates high frequency without exceeding the chosen maximum',()=>{
  const {original,result,messages}=render({amount:6,signal:i=>tone(10000,0.45,i)});
  const attenuation=20*Math.log10(rms(original[0])/rms(result[0]));
  assert.ok(attenuation>3&&attenuation<=6.05,`High-band attenuation: ${attenuation} dB`);
  assert.ok(messages.length>0&&messages.length<=7);
  assert.ok(messages.every(m=>m.type==='meter'&&m.reductionDb>=0&&m.reductionDb<=6.00001));
});

test('voice-body frequencies survive even while a sibilant triggers reduction',()=>{
  const {original,result}=render({amount:12,signal:i=>tone(300,0.2,i)+tone(10000,0.4,i)});
  const lowDifference=20*Math.log10(amplitude(result[0],300)/amplitude(original[0],300));
  const highReduction=20*Math.log10(amplitude(original[0],10000)/amplitude(result[0],10000));
  assert.ok(Math.abs(lowDifference)<0.15,`Low-frequency difference: ${lowDifference} dB`);
  assert.ok(highReduction>6&&highReduction<=12.05,`High-frequency reduction: ${highReduction} dB`);
});

test('quiet high frequencies below the soft knee remain unchanged',()=>{
  const {original,result}=render({threshold:-30,amount:12,signal:i=>tone(10000,0.001,i)});
  assert.deepEqual(result[0],original[0]);
});

test('stereo stays linked and invalid input does not poison later samples',()=>{
  const {result,processor,params,input,output}=render({channels:2,signal:(i,ch)=>(ch?-0.5:1)*(tone(250,0.2,i)+tone(10000,0.4,i))});
  for(let i=0;i<result[0].length;i++)assert.equal(result[1][i],-0.5*result[0][i]);
  input[0].fill(NaN);input[1].fill(Infinity);
  processor.process([input],[output],params);
  for(const channel of output)assert.ok(channel.every(Number.isFinite));
  input[0].fill(0);input[1].fill(0);
  for(let i=0;i<200;i++)processor.process([input],[output],params);
  for(const channel of output)assert.ok(channel.every(Number.isFinite));
  params.amount[0]=0;
  input[0][0]=0.25;input[1][0]=-0.125;
  processor.process([input],[output],params);
  assert.deepEqual(output[0],input[0]);assert.deepEqual(output[1],input[1]);
});
