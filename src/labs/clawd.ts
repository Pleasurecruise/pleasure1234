// Frame sheets from Clawd 400 by 风花叶, CC BY 4.0: https://github.com/khiqwq/clawd-400

const GRID = 40;
const SCALE = 2;
const BURST_MS = 1200;
const WALK_PX_PER_S = 28;

interface Sheet {
  /** Clawd's body centre in each frame, in sheet px, so it can be anchored to one spot. */
  centre: readonly number[];
  /** The lowest row that has anything on it, which stands on the floor line. */
  bottom: number;
  faces: 1 | -1;
  /** How far the drawing reaches left and right of the body centre, in sheet px. */
  reach: readonly [number, number];
}

const SHEETS = {
  '018': { centre: Array(8).fill(18.5), bottom: 38, faces: 1, reach: [12, 22] },
  '026': {
    centre: [2, 3.5, 5, 6.5, 8, 9.5, 11, 13.5, 16.5, 19.5, 20.5, 22, 21.5, 22, 23.5, 22, 22, 22, 20.5],
    bottom: 35,
    faces: 1,
    reach: [13, 13],
  },
  '062': { centre: [20, 20, 20, 20, 21.5, 21.5, 21.5, 21.5, 21.5, 21.5, 20], bottom: 35, faces: 1, reach: [14, 15] },
  '147': { centre: Array(16).fill(20), bottom: 35, faces: 1, reach: [15, 17] },
} satisfies Record<string, Sheet>;

type SheetId = keyof typeof SHEETS;
const isSheetId = (key: string): key is SheetId => key in SHEETS;

interface Clip {
  sheet: SheetId;
  frames: readonly number[];
  ms: readonly number[];
  loop: boolean;
}

const CLIPS = {
  walk: { sheet: '026', frames: [1, 2, 3, 4, 5], ms: [110, 110, 110, 110, 110], loop: true },
  hello: { sheet: '026', frames: [11, 12, 11, 12, 11], ms: [220, 320, 220, 320, 220], loop: false },
  idle: { sheet: '026', frames: [15, 16], ms: [2600, 120], loop: true },
  typing: { sheet: '018', frames: [0, 1, 2, 3, 4, 5, 6, 7], ms: [110, 110, 110, 110, 110, 110, 110, 110], loop: true },
  send: { sheet: '062', frames: [4, 5, 6, 7, 8, 9], ms: [260, 130, 130, 130, 130, 130], loop: false },
  sleep: { sheet: '147', frames: Array.from({ length: 16 }, (_, i) => i), ms: Array(16).fill(200), loop: true },
} satisfies Record<string, Clip>;

type State = keyof typeof CLIPS;

export type Reaction = 'key' | 'space' | 'erase' | 'send';


export class Clawd {
  private sheets = new Map<SheetId, HTMLImageElement>();
  private state: State = 'idle';
  private since = performance.now();
  private x = 0.12;
  private goal = 0.12;
  private facing: 1 | -1 = 1;
  private burst: number[] = [];
  private lastKey = -Infinity;
  private lastActive = performance.now();

  constructor(base: string) {
    for (const id of Object.keys(SHEETS).filter(isSheetId)) {
      const img = new Image();
      img.src = `${base}${id}.png`;
      this.sheets.set(id, img);
    }
  }

  private enter(state: State, now = performance.now()) {
    if (this.state === state) return;
    this.state = state;
    this.since = now;
  }

  wave() {
    if (this.state === 'typing' || this.state === 'walk') return;
    this.lastActive = performance.now();
    this.state = 'idle';
    this.enter('hello');
  }

  react(kind: Reaction, x: number) {
    const now = performance.now();
    this.lastActive = now;
    if (kind === 'send') {
      this.burst = [];
      this.lastKey = -Infinity;
      this.state = 'idle';
      this.enter('send', now);
      return;
    }
    this.goal = this.x;
    this.lastKey = now;
    if (kind === 'key') {
      // Pick a side once, when a burst starts, so it does not flip mid-sentence.
      if (!this.burst.length) this.facing = x >= this.x ? 1 : -1;
      this.burst.push(x);
    }
    this.enter('typing', now);
  }

  update(dt: number, now: number, width: number, calm: boolean) {
    const clip = CLIPS[this.state];
    const length = clip.ms.reduce((a, b) => a + b, 0);
    if (!clip.loop && now - this.since >= length) this.enter('idle', now);

    if (this.state === 'typing' && now - this.lastKey >= BURST_MS) {
      const mean = this.burst.length ? this.burst.reduce((a, b) => a + b, 0) / this.burst.length : this.x;
      this.burst = [];
      if (Math.abs(mean - this.x) > 0.06) {
        this.goal = Math.min(0.92, Math.max(0.08, mean));
        this.facing = this.goal > this.x ? 1 : -1;
        this.enter('walk', now);
      } else this.enter('idle', now);
    }

    if (this.state === 'walk') {
      const gap = this.goal - this.x;
      const step = calm ? Math.abs(gap) : (WALK_PX_PER_S * dt) / Math.max(1, width);
      this.x += Math.min(Math.abs(gap), step) * Math.sign(gap);
      if (this.x === this.goal) this.enter('idle', now);
    }

    if (this.state === 'idle' && now - this.lastActive > 12000) this.enter('sleep', now);
  }

  span(left: number, width: number) {
    const sheet = SHEETS[CLIPS[this.state].sheet];
    const centre = left + this.x * width;
    const [back, front] = sheet.reach;
    const flip = this.facing !== sheet.faces;
    const l = (flip ? front : back) * SCALE;
    const r = (flip ? back : front) * SCALE;
    return [centre - l, centre + r] as const;
  }

  draw(ctx: CanvasRenderingContext2D, left: number, width: number, floor: number, now: number, calm: boolean) {
    const clip = CLIPS[this.state];
    const img = this.sheets.get(clip.sheet);
    if (!img?.complete || !img.naturalWidth) return;
    const frame = calm ? clip.frames[0] : this.frameAt(clip, now - this.since);
    const sheet = SHEETS[clip.sheet];
    const flip = this.facing !== sheet.faces;
    const anchor = Math.round(left + this.x * width);
    const top = Math.round(floor - (sheet.bottom + 1) * SCALE);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(anchor, top);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, frame * GRID, 0, GRID, GRID, -sheet.centre[frame] * SCALE, 0, GRID * SCALE, GRID * SCALE);
    ctx.restore();
  }

  private frameAt(clip: Clip, elapsed: number) {
    const length = clip.ms.reduce((a, b) => a + b, 0);
    let t = clip.loop ? elapsed % length : Math.min(elapsed, length - 1);
    for (let i = 0; i < clip.frames.length; i++) {
      if (t < clip.ms[i]) return clip.frames[i];
      t -= clip.ms[i];
    }
    return clip.frames[clip.frames.length - 1];
  }
}
