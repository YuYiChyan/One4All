/* Dynamic split-band de-essing. This is local DSP, not breath/speech recognition. */
'use strict';

class One4AllDeesser extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name:'amount',defaultValue:0,minValue:0,maxValue:12,automationRate:'k-rate'},
      {name:'threshold',defaultValue:-30,minValue:-60,maxValue:0,automationRate:'k-rate'},
      {name:'frequency',defaultValue:6000,minValue:3000,maxValue:10000,automationRate:'k-rate'}
    ];
  }

  constructor() {
    super();
    this.previousInput=new Float64Array(2);
    this.lowBand=new Float64Array(2);
    this.highBand=new Float64Array(2);
    this.inputSample=new Float64Array(2);
    this.envelope=0;
    this.gain=1;
    this.attack=Math.exp(-1/(sampleRate*0.002));
    this.release=Math.exp(-1/(sampleRate*0.060));
    this.lastFrequency=-1;
    this.lastAmount=-1;
    this.b=0;
    this.a=0;
    this.minimumGain=1;
    this.meterFrames=0;
    this.meterInterval=Math.max(1,Math.round(sampleRate/10));
    this.meter={type:'meter',reductionDb:0};
  }

  process(inputs,outputs,parameters) {
    const input=inputs[0],output=outputs[0];
    if(!output||!output.length)return true;
    const channels=Math.min(2,output.length),frames=output[0].length;
    let amount=parameters.amount[0],threshold=parameters.threshold[0],frequency=parameters.frequency[0];
    amount=Number.isFinite(amount)?Math.max(0,Math.min(12,amount)):0;
    threshold=Number.isFinite(threshold)?Math.max(-60,Math.min(0,threshold)):-30;
    frequency=Number.isFinite(frequency)?Math.max(3000,Math.min(10000,frequency)):6000;
    frequency=Math.min(frequency,sampleRate*0.45);
    if(frequency!==this.lastFrequency) {
      // Complementary first-order low/high branches sum to the original sample.
      // Unlike a full-band gate, high-band gain never mutes the low voice body.
      const tangent=Math.tan(Math.PI*frequency/sampleRate);
      this.b=tangent/(1+tangent);
      this.a=(1-tangent)/(1+tangent);
      this.lastFrequency=frequency;
    }
    if(amount!==this.lastAmount) {
      this.minimumGain=Math.pow(10,-amount/20);
      this.lastAmount=amount;
    }
    for(let i=0;i<frames;i++) {
      let peak=0;
      for(let ch=0;ch<channels;ch++) {
        const source=input&&input[ch];
        let value=source?source[i]:0;
        if(!Number.isFinite(value))value=0;
        const low=this.b*(value+this.previousInput[ch])+this.a*this.lowBand[ch];
        this.previousInput[ch]=value;
        this.lowBand[ch]=low;
        this.inputSample[ch]=value;
        const high=value-low;
        this.highBand[ch]=high;
        peak=Math.max(peak,Math.abs(high));
      }
      // Stereo-linked detector avoids independently moving the stereo image.
      const detectorRate=peak>this.envelope?this.attack:this.release;
      this.envelope=peak+detectorRate*(this.envelope-peak);
      if(amount===0) {
        this.gain=1;
      } else {
        const level=this.envelope>1e-12?20*Math.log10(this.envelope):-240;
        const over=level-threshold;
        // 4:1 high-band compression with a 6 dB soft knee, capped by amount.
        let reduction=over<=-3?0:over<3?0.75*(over+3)*(over+3)/12:0.75*over;
        reduction=Math.min(amount,reduction);
        const target=Math.pow(10,-reduction/20);
        const gainRate=target<this.gain?this.attack:this.release;
        this.gain=Math.max(this.minimumGain,target+gainRate*(this.gain-target));
      }
      for(let ch=0;ch<channels;ch++) {
        // Exact bypass also avoids round-off when the detector requests no cut.
        output[ch][i]=this.gain===1?this.inputSample[ch]:this.lowBand[ch]+this.gain*this.highBand[ch];
      }
    }
    for(let ch=channels;ch<output.length;ch++)output[ch].fill(0);
    this.meterFrames+=frames;
    if(this.meterFrames>=this.meterInterval) {
      this.meterFrames%=this.meterInterval;
      this.meter.reductionDb=this.gain===1?0:-20*Math.log10(this.gain);
      // No sample/block allocations: only the platform's infrequent meter clone.
      this.port.postMessage(this.meter);
    }
    return true;
  }
}

registerProcessor('one4all-deesser',One4AllDeesser);
