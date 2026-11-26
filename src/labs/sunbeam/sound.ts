import { rand } from './util';
import type { Sound } from './world';

const CLIPS = ['meow', 'mew', 'laowu', 'beg', 'trill', 'hiss', 'spook', 'clatter', 'purr'] as const;
type Clip = (typeof CLIPS)[number];
const CLIP_VOLUME: Record<Exclude<Clip, 'purr'>, number> = { meow: 0.8, mew: 0.7, laowu: 0.9, beg: 0.65, trill: 0.8, hiss: 0.6, spook: 0.7, clatter: 0.6 };

/** The audio graph, built on the first user gesture (browsers refuse audio before one). Cat voices are Sonilo recordings. */
interface Rig { ctx: AudioContext; master: GainNode; purr: GainNode; noise: AudioBuffer; clips: Record<Clip, AudioBuffer | null> }

export class Sfx {
  private rig: Rig | null = null;

  constructor(private readonly root: string) {}

  unlock() {
    if (!this.rig) this.rig = Sfx.build(this.root);
    if (this.rig.ctx.state === 'suspended') void this.rig.ctx.resume();
  }

  private static build(root: string): Rig {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, noise = ctx.createBuffer(1, len, ctx.sampleRate), data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const purr = ctx.createGain(); purr.gain.value = 0;
    purr.connect(master);
    const clips: Record<Clip, AudioBuffer | null> = { meow: null, mew: null, laowu: null, beg: null, trill: null, hiss: null, spook: null, clatter: null, purr: null };
    for (const name of CLIPS) {
      fetch(`${root}${name}.m4a`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} for ${name}`))))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buf) => {
          clips[name] = buf;
          if (name === 'purr') { const loop = ctx.createBufferSource(); loop.buffer = buf; loop.loop = true; loop.connect(purr); loop.start(); }
        })
        .catch((e: Error) => console.warn(`sunbeam: could not load the ${name} sound: ${e.message}`));
    }
    return { ctx, master, purr, noise, clips };
  }

  purr(level: number) {
    if (!this.rig) return;
    this.rig.purr.gain.setTargetAtTime(level * 1.1, this.rig.ctx.currentTime, 0.15);
  }

  private clip(rig: Rig, name: Exclude<Clip, 'purr'>) {
    const buf = rig.clips[name];
    if (buf === null) return;
    const { ctx } = rig, s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; s.playbackRate.value = rand(0.96, 1.04);
    g.gain.value = CLIP_VOLUME[name];
    s.connect(g).connect(rig.master);
    s.start();
  }

  private burst(rig: Rig, at: number, dur: number, type: BiquadFilterType, freq: number, vol: number) {
    const { ctx } = rig, s = ctx.createBufferSource(); s.buffer = rig.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + Math.min(0.03, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(rig.master);
    s.start(at, Math.random()); s.stop(at + dur + 0.05);
  }

  play(sound: Sound) {
    const rig = this.rig;
    if (!rig || rig.ctx.state !== 'running') return;
    const { ctx } = rig;
    const t = ctx.currentTime;
    if (sound === 'crunch') {
      this.burst(rig, t, 0.05, 'bandpass', 1900, 0.12);
      this.burst(rig, t + 0.08, 0.04, 'bandpass', 2400, 0.08);
    } else if (sound === 'pour') {
      for (let i = 0; i < 14; i++) this.burst(rig, t + Math.random() * 0.5, 0.025, 'bandpass', rand(2600, 4200), 0.1);
    } else if (sound === 'clink') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(rand(1500, 1900), t);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(rig.master); o.start(t); o.stop(t + 0.3);
      this.burst(rig, t, 0.05, 'bandpass', 3000, 0.08);
    } else if (sound === 'thud') {
      this.burst(rig, t, 0.16, 'lowpass', 260, 0.5);
      this.burst(rig, t + 0.01, 0.06, 'bandpass', 900, 0.12);
    } else this.clip(rig, sound);
  }
}
