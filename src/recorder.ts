export class Recorder {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: AudioWorkletNode | null = null;
  meter = 0;
  onLevel: (v: number) => void = () => {};
  onDeviceError: () => void = () => {};
  async prepare(deviceId: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.stream
      .getAudioTracks()
      .forEach((t) => (t.onended = () => this.onDeviceError()));
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule(
      new URL("../public/pcm-worklet.js", import.meta.url).href,
    );
    this.node = new AudioWorkletNode(this.ctx, "pcm-recorder");
    this.node.port.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const samples = new Int16Array(e.data);
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s) / 32768);
        this.onLevel(peak);
        window.shengye.audio(e.data);
      }
    };
    await this.ctx.suspend();
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.node.connect(gain).connect(this.ctx.destination);
  }
  async start() {
    await this.ctx?.resume();
  }
  async pause() {
    await this.flush();
    await this.ctx?.suspend();
    this.onLevel(0);
  }
  async resume() {
    await this.ctx?.resume();
  }
  async flush() {
    const node = this.node;
    if (!node) return;
    await new Promise<void>((resolve) => {
      const previous = node.port.onmessage;
      const timer = setTimeout(() => {
        node.port.onmessage = previous;
        resolve();
      }, 1000);
      node.port.onmessage = (e) => {
        if (e.data === "flushed") {
          clearTimeout(timer);
          node.port.onmessage = previous;
          resolve();
        } else previous?.call(node.port, e);
      };
      node.port.postMessage("flush");
    });
  }
  async close() {
    if (this.ctx?.state === "running") await this.flush();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.onLevel(0);
  }
}
