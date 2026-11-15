/* Signalsmith Stretch adapter for live, independently controlled pitch and formants. */
(() => {
  'use strict';
  const moduleURL=new URL('voice-vendor/signalsmith/SignalsmithStretch.mjs',document.currentScript?.src||location.href).href;
  let library;
  async function create(context,initial={}) {
    library ||= import(moduleURL);
    const {default:SignalsmithStretch}=await library;
    // Use the bundled module directly, including on the AudioWorklet thread.
    SignalsmithStretch.moduleUrl=moduleURL;
    const node=await SignalsmithStretch(context,{
      numberOfInputs:1,numberOfOutputs:1,channelCount:1,
      channelCountMode:'explicit',outputChannelCount:[1]
    });
    let disposed=false;
    const values={pitch:0,formant:0,preserveFormants:true};
    function set(next={}) {
      if(disposed)return Promise.resolve();
      for(const key of ['pitch','formant'])if(Number.isFinite(Number(next[key])))values[key]=Number(next[key]);
      if(typeof next.preserveFormants==='boolean')values.preserveFormants=next.preserveFormants;
      return node.schedule({
        active:true,semitones:values.pitch,formantSemitones:values.formant,
        formantCompensation:values.preserveFormants,formantBaseHz:0,rate:1
      });
    }
    try {
      // A short speech window keeps the algorithm's delay bounded while spreading
      // work across callbacks. The actual algorithm delay is reported below.
      await node.configure({blockMs:40,intervalMs:10,splitComputation:true});
      const latencySeconds=await node.latency();
      await set(initial);
      return {
        input:node,output:node,set,latencySeconds,
        dispose(){if(disposed)return;disposed=true;node.stop();node.disconnect();node.port.close();}
      };
    } catch(error) {
      node.disconnect();node.port.close();throw error;
    }
  }
  window.One4AllNaturalPitch={create};
})();
