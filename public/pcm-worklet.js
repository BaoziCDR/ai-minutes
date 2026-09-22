class PCMRecorder extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Int16Array(3200);this.pos=0;this.port.onmessage=e=>{if(e.data==='flush'&&this.pos){this.port.postMessage(this.buffer.slice(0,this.pos).buffer);this.pos=0;this.port.postMessage('flushed');}else if(e.data==='flush')this.port.postMessage('flushed');};}
 process(inputs){const ch=inputs[0]?.[0];if(ch){for(let i=0;i<ch.length;i++){const v=Math.max(-1,Math.min(1,ch[i]));this.buffer[this.pos++]=v<0?v*32768:v*32767;if(this.pos===3200){this.port.postMessage(this.buffer.buffer,[this.buffer.buffer]);this.buffer=new Int16Array(3200);this.pos=0;}}}return true;}
}
registerProcessor('pcm-recorder',PCMRecorder);
