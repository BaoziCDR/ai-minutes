export class Recorder {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: AudioWorkletNode | null = null;
  meter = 0;
  private deviceId = "";
  private chunks = 0;
  onLevel: (v: number) => void = () => {};
  onDeviceError: () => void = () => {};
  async prepare(deviceId: string) {
    this.deviceId = deviceId;
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
        this.chunks++;
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
    await this.activate();
  }
  private async activate() {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.stream?.getAudioTracks().some((t) => t.readyState === "live")
    )
      throw Error("麦克风不可用");
    const before = this.chunks;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          ctx.resume(),
          new Promise<void>((resolve) => {
            interval = setInterval(() => {
              if (this.chunks > before) resolve();
            }, 50);
          }),
        ]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(Error("麦克风未恢复音频采集")),
            3000,
          );
        }),
      ]);
    } finally {
      clearInterval(interval);
      clearTimeout(timeout);
    }
  }
  async pause() {
    await this.flush();
    await this.ctx?.suspend();
    this.onLevel(0);
  }
  async resume() {
    try {
      await this.activate();
    } catch {
      // macOS input devices can leave a suspended context without PCM output.
      // Recreate the capture graph while the same meeting/WAV remains open.
      await this.release();
      try {
        await this.prepare(this.deviceId);
        await this.activate();
      } catch {
        await this.release();
        throw Error(
          "麦克风未能恢复，会议保持暂停。请检查设备连接后再次继续录音。",
        );
      }
    }
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
    await this.release();
  }
  private async release() {
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.onLevel(0);
    if (ctx && ctx.state !== "closed") {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        ctx.close().catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
      clearTimeout(timer);
    }
  }
}
