/**
 * Plays PCM16 frames as they arrive. Each channel keeps its own playback clock and
 * stereo panner so two sides of a call can be heard left/right.
 */
const START_DELAY = 0.12; // seconds of jitter buffer
const MAX_LAG = 0.6; // if we fall further behind than this, skip ahead

interface Track {
  nextTime: number;
  panner: StereoPannerNode;
}

export class LivePlayer {
  private ctx?: AudioContext;
  private tracks = new Map<string, Track>();
  volume = 1;
  private master?: GainNode;

  /** Must be called from a user gesture (click) so the browser allows audio. */
  async resume() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  play(key: string, sampleRate: number, pcm: Int16Array, pan: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || pcm.length === 0) return;
    let track = this.tracks.get(key);
    if (!track) {
      const panner = ctx.createStereoPanner();
      panner.connect(this.master);
      track = { nextTime: 0, panner };
      this.tracks.set(key, track);
    }
    track.panner.pan.value = pan;

    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;

    const now = ctx.currentTime;
    if (track.nextTime < now || track.nextTime > now + MAX_LAG) track.nextTime = now + START_DELAY;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(track.panner);
    src.start(track.nextTime);
    track.nextTime += buffer.duration;
  }

  stop(key: string) {
    const t = this.tracks.get(key);
    if (!t) return;
    t.panner.disconnect();
    this.tracks.delete(key);
  }
}
