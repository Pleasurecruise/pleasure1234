// Sunbeam: a pixel cat that keeps your local time and remembers you between visits.
// The cat is a procedural rig rather than a sprite sheet, so each visitor's coat is generated.
import { context2d, need } from '../lib/dom';

export let W = 320;
export let H = 136;
const TAU = Math.PI * 2;
let WALK_TOP = 74, WALK_BOTTOM = 124;
const WALK_LEFT = 16;
let WALK_RIGHT = W - 16;
const YARN_R = 7;

type Col = number;
const pack = (r: number, g: number, b: number): Col => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const hex = (h: string): Col => { const n = parseInt(h.slice(1), 16); return pack(n >> 16, (n >> 8) & 255, n & 255); };
const mix = (a: Col, b: Col, t: number): Col => {
  const ar = a & 255, ag = (a >> 8) & 255, ab = (a >> 16) & 255;
  return pack(
    Math.round(ar + ((b & 255) - ar) * t),
    Math.round(ag + (((b >> 8) & 255) - ag) * t),
    Math.round(ab + (((b >> 16) & 255) - ab) * t),
  );
};
const luma = (c: Col) => (c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + s * 7919, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const noise = (x: number, y: number, s: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const INK = hex('#2b2220');
const WHITE = hex('#ffffff');
const SHADOW = hex('#3b2a22');

function blend(buf: Uint32Array, i: number, c: Col, a: number) {
  const d = buf[i], da = (d >>> 24) / 255;
  if (da === 0) { buf[i] = ((Math.round(a * 255) << 24) | (c & 0xffffff)) >>> 0; return; }
  const oa = a + da * (1 - a);
  buf[i] = ((Math.round(oa * 255) << 24) | (mix(d, c, a / oa) & 0xffffff)) >>> 0;
}

type Paint = Col | ((x: number, y: number) => Col);
const at = (p: Paint, x: number, y: number) => (typeof p === 'number' ? p : p(x, y));

function ellipse(buf: Uint32Array, cx: number, cy: number, rx: number, ry: number, p: Paint) {
  if (rx < 0.3 || ry < 0.3) return;
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry, dy2 = dy * dy;
    if (dy2 > 1) continue;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy2 <= 1) buf[y * W + x] = at(p, x, y);
    }
  }
}

function capsule(buf: Uint32Array, ax: number, ay: number, bx: number, by: number, r: number, p: Paint) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
  const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-6, r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5 - ax, py = y + 0.5 - ay;
    const t = clamp((px * vx + py * vy) / len2, 0, 1);
    const dx = px - vx * t, dy = py - vy * t;
    if (dx * dx + dy * dy <= r2) buf[y * W + x] = at(p, x, y);
  }
}

/** Convex polygon fill. */
function poly(buf: Uint32Array, pts: number[], p: Paint) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
  }
  const n = pts.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; }
  const s = Math.sign(area) || 1;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(W - 1, Math.ceil(maxX)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = true;
      for (let i = 0; i < n && inside; i++) {
        const j = (i + 1) % n;
        const e = ((pts[j * 2] - pts[i * 2]) * (py - pts[i * 2 + 1]) - (pts[j * 2 + 1] - pts[i * 2 + 1]) * (px - pts[i * 2])) * s;
        if (e < 0) inside = false;
      }
      if (inside) buf[y * W + x] = at(p, x, y);
    }
  }
}

function put(buf: Uint32Array, x: number, y: number, c: Col) {
  x = Math.floor(x); y = Math.floor(y);
  if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c;
}

function tint(buf: Uint32Array, x: number, y: number, c: Col, a: number) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  if (a >= 1) buf[y * W + x] = c; else blend(buf, y * W + x, c, a);
}

function line(buf: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: Col, a: number) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 600; n++) {
    tint(buf, x0, y0, c, a);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

let MASK = new Uint8Array(W * H);

/** Outline a layer's silhouette. */
function outline(layer: Uint32Array, outer: Col) {
  for (let i = 0; i < W * H; i++) MASK[i] = layer[i] ? 1 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (MASK[i]) continue;
    if ((x > 0 && MASK[i - 1]) || (x < W - 1 && MASK[i + 1]) || (y > 0 && MASK[i - W]) || (y < H - 1 && MASK[i + W])) layer[i] = outer;
  }
}

/** Outline the silhouette, and draw inner lines where a part meets one drawn before it (except parts in `seamless`). */
function outlineParts(layer: Uint32Array, outer: Col, ids: Uint8Array, inner: Col, seamless: Set<number>) {
  outline(layer, outer);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!MASK[i] || seamless.has(ids[i])) continue;
    const a = ids[i];
    const behind = (j: number) => MASK[j] === 1 && ids[j] !== 0 && ids[j] < a;
    if ((x > 0 && behind(i - 1)) || (x < W - 1 && behind(i + 1)) || (y > 0 && behind(i - W)) || (y < H - 1 && behind(i + W))) layer[i] = inner;
  }
}

const SPRITES = {
  heart: { rows: ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'], col: hex('#e2566b') },
  z: { rows: ['xxxxx', '...x.', '..x..', '.x...', 'xxxxx'], col: hex('#7d90b8') },
  note: { rows: ['..xxx', '..x.x', '..x..', 'xxx..', 'xxx..'], col: hex('#6b5a55') },
  spark: { rows: ['..x..', '..x..', 'xxxxx', '..x..', '..x..'], col: hex('#f2b53c') },
  vein: { rows: ['xx.xx', 'x...x', '.....', 'x...x', 'xx.xx'], col: hex('#d8473f') },
  kibble: { rows: ['xx', 'xx'], col: hex('#9c5e33') },
};
type SpriteName = keyof typeof SPRITES;

function sprite(buf: Uint32Array, name: SpriteName, x: number, y: number, a: number) {
  const s = SPRITES[name], ox = Math.round(x - s.rows[0].length / 2), oy = Math.round(y - s.rows.length / 2);
  s.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'x') tint(buf, ox + i, oy + j, s.col, a); });
}

type Kind = 'tabby' | 'solid' | 'tux' | 'calico' | 'point';
interface Coat { kind: Kind; base: Col; mark: Col; mark2: Col; light: Col; eye: Col }
const coat = (kind: Kind, base: string, mark: string, mark2: string, light: string, eye: string): Coat =>
  ({ kind, base: hex(base), mark: hex(mark), mark2: hex(mark2), light: hex(light), eye: hex(eye) });

export const COATS = {
  ginger: coat('tabby', '#e8964f', '#c46c33', '#c46c33', '#f8e2c8', '#9cb648'),
  grey: coat('tabby', '#9da2aa', '#6c717b', '#6c717b', '#e9e6e0', '#d9a640'),
  black: coat('solid', '#37333c', '#37333c', '#37333c', '#37333c', '#e6c440'),
  tuxedo: coat('tux', '#37333c', '#37333c', '#37333c', '#f5f2ec', '#9ccf72'),
  calico: coat('calico', '#f6f2ea', '#e3914e', '#463e4c', '#f6f2ea', '#cf9f38'),
  cream: coat('tabby', '#efd9b5', '#dab585', '#dab585', '#fcf3e4', '#6da7d3'),
  siamese: coat('point', '#efe5d4', '#5e4839', '#5e4839', '#f8f2e8', '#5ba2e6'),
} satisfies Record<string, Coat>;
export type CoatKey = keyof typeof COATS;
const COAT_KEYS = Object.keys(COATS).filter(isCoatKey);
export function isCoatKey(k: string): k is CoatKey { return Object.hasOwn(COATS, k); }
export const randomCoat = (): CoatKey => COAT_KEYS[Math.floor(Math.random() * COAT_KEYS.length)];

type Part = 'body' | 'head' | 'ear' | 'leg' | 'tail' | 'haunch';

interface Pose {
  bx: number; by: number; brx: number; bry: number; tilt: number; hx: number; hy: number;
  legF: number; legB: number; haunch: number; tailA: number; tailC: number; tf: number;
  eye: number; ear: number; front: number; paw: number; pawX: number; pawY: number; wig: number;
}

type Blob = { x: number; y: number; rx: number; ry: number };

/**
 * The torso as chest, waist and rump strung along a spine that can tilt: level when standing,
 * rear-down when sitting, front-down in a stretch. brx is the spine length.
 */
function torso(P: Pose, bx: number, by: number, bry: number) {
  const ux = Math.cos(P.tilt), uy = Math.sin(P.tilt), s = Math.abs(uy), L = P.brx;
  const blob = (k: number, rx: number, ry: number): Blob =>
    ({ x: bx + ux * L * k, y: by + uy * L * k, rx: rx + (ry - rx) * s, ry: ry + (rx - ry) * s });
  const chest = blob(0.46, L * 0.46, bry * 1.02), waist = blob(0, L * 0.6, bry * 0.8), rump = blob(-0.5, L * 0.48, bry * 0.94);
  return {
    ux, uy, chest, waist, rump,
    shoulder: { x: chest.x + 0.5, y: chest.y + chest.ry * 0.45 },
    hip: { x: rump.x - 0.5, y: rump.y + rump.ry * 0.7 },
    neck: { x: chest.x + chest.rx * 0.35, y: chest.y - chest.ry * 0.5 },
    tail: { x: rump.x - ux * rump.rx * 0.8, y: rump.y - uy * rump.rx * 0.8 - rump.ry * 0.35 },
  };
}

/** Centre of the muzzle: forward in profile, centred when the cat looks at you. */
const muzzleX = (P: Pose) => P.hx + 5.2 * (1 - P.front);

function fur(c: Coat, part: Part, lx: number, ly: number, P: Pose, seed: number): Col {
  let col = c.base;
  const mx = muzzleX(P), ux = Math.cos(P.tilt), uy = Math.sin(P.tilt);
  const along = (lx - P.bx) * ux + (ly - P.by) * uy, down = -(lx - P.bx) * uy + (ly - P.by) * ux;
  const belly = part === 'body' && down > P.bry * 0.38;
  const chest = part === 'body' && along > P.brx * 0.3 && down > -P.bry * 0.2;
  const muzzle = part === 'head' && ((lx - mx) / (3.6 + P.front)) ** 2 + ((ly - P.hy - 3) / 3) ** 2 < 1;
  const chin = part === 'head' && ly > P.hy + 4.4 && Math.abs(lx - mx) < 4;
  switch (c.kind) {
    case 'tabby': {
      if (muzzle || chin || belly) col = c.light;
      else if (part === 'body' && down < P.bry * 0.2 && (Math.floor(along + 80) % 5) < 2) col = c.mark;
      else if (part === 'haunch' && (Math.floor(ly * 0.55 + lx * 0.3 + 80) % 4) < 1.3) col = c.mark;
      else if (part === 'tail' && (Math.floor((lx - ly) * 0.55 + 80) % 4) < 1.4) col = c.mark;
      else if (part === 'head' && ly < P.hy - 2.5 && Math.abs(lx - P.hx - 0.5) < 3.5 && (Math.floor(lx + 80) % 2) === 0) col = c.mark;
      else if (part === 'head' && ly > P.hy + 0.4 && ly < P.hy + 1.4 && lx < P.hx + 0.5 && lx > P.hx - 5) col = c.mark;
      else if (part === 'leg' && ly < -4 && (Math.floor(-ly) % 4) === 0) col = c.mark;
      break;
    }
    case 'tux':
      if (muzzle || chin || chest || belly) col = c.light;
      else if (part === 'leg' && ly > -4.5) col = c.light;
      break;
    case 'calico': {
      if (muzzle || chin || belly || chest) break;
      const n = noise(lx * 0.1 + 3, ly * 0.12 + 7, seed);
      if (n > 0.6) col = c.mark; else if (n < 0.3) col = c.mark2;
      break;
    }
    case 'point': {
      const d = part === 'head' ? Math.hypot(lx - mx, ly - P.hy - 2) : 99;
      if (part === 'ear' || (part === 'tail' && along < -P.brx * 0.9) || (part === 'leg' && ly > -8) || d < 4.2) col = c.mark;
      else if (d < 6.5 || part === 'tail') col = mix(c.base, c.mark, 0.45);
      break;
    }
  }
  return col;
}

const base: Pose = {
  bx: 0, by: -17, brx: 22, bry: 7.5, tilt: 0, hx: 23, hy: -27.5, legF: 1, legB: 1, haunch: 0, tailA: 0.45, tailC: 0.08, tf: 0,
  eye: 1, ear: 0, front: 0, paw: 0, pawX: 0, pawY: 0, wig: 0,
};
const pose = (o: Partial<Pose>): Pose => ({ ...base, ...o });
const STRIDE = 10, DUTY = 0.62;
const sit = { bx: -2, by: -14.5, brx: 17, tilt: -1.05, hx: 4, hy: -33.5, legB: 0, haunch: 1, tailA: -1.3, tailC: -0.17, tf: 1, front: 0.35 };
const POSES = {
  stand: pose({}),
  walk: pose({ hx: 24, hy: -26, tailA: 0.75, tailC: 0.1 }),
  sit: pose(sit),
  beg: pose({ ...sit, front: 1 }),
  loaf: pose({ by: -9.5, brx: 21, bry: 7.4, hx: 19.5, hy: -17, legF: 0, legB: 0, tailA: -0.35, tailC: -0.13, tf: 1, eye: 0.5, front: 0.3 }),
  sleep: pose({ by: -8, brx: 19, bry: 7, hx: 12.5, hy: -8, legF: 0, legB: 0, tailA: -0.5, tailC: -0.28, tf: 1, eye: 0, ear: 0.15, front: 0.5 }),
  crouch: pose({ bx: -1, by: -10.5, brx: 22, bry: 6.4, tilt: 0.1, hx: 21.5, hy: -14, legF: 0.6, legB: 0.6, tailA: 0.05, tailC: 0.015, ear: 0.3 }),
  eat: pose({ tilt: 0.12, hx: 25, hy: -11, tailA: 0.5 }),
  groom: pose({ ...sit, hx: 6, hy: -30, eye: 0, paw: 1, pawX: 9, pawY: -28, front: 0.2 }),
  swat: pose({ ...sit, paw: 1, pawX: 18, pawY: -24, ear: 1, eye: 0.5 }),
  air: pose({ brx: 25, bry: 6.6, tilt: -0.12, hx: 27, hy: -24, tailA: 0.25, tailC: 0.015 }),
  stretch: pose({ by: -15, brx: 23, bry: 7, tilt: 0.32, hx: 25, hy: -10, tailA: 1.05, tailC: 0.04, eye: 0.2 }),
};
type PoseName = keyof typeof POSES;
const POSE_KEYS: readonly (keyof Pose)[] = [
  'bx', 'by', 'brx', 'bry', 'tilt', 'hx', 'hy', 'legF', 'legB', 'haunch', 'tailA', 'tailC', 'tf',
  'eye', 'ear', 'front', 'paw', 'pawX', 'pawY', 'wig',
];

type Mode = 'idle' | 'walk' | 'eat' | 'sleep' | 'groom' | 'beg' | 'play' | 'stalk' | 'wiggle' |
  'pounce' | 'petted' | 'swat' | 'hop' | 'stretch' | 'look';
/** What a walk is for, so interruptions can tell a stroll from an errand. */
type Intent = 'wander' | 'errand';

interface Cat {
  x: number; y: number; z: number; dir: number; mode: Mode; t: number; dur: number; intent: Intent;
  pose: PoseName; P: Pose; tx: number; ty: number; speed: number; moving: boolean; then: (() => void) | null;
  phase: number; follow: 'box' | 'dish' | null; floor: boolean; blinkAt: number; inBox: boolean; grumpy: number; overstim: number; lastPet: number; petAcc: number;
  purr: number; mouth: number; look: number; swipe: number; bats: number; cool: number; tick: number;
  jump: Jump | null;
}

/** gx/gy: where the pointer grabbed it; ox: offset from the box centre while it sits in the box. */
/** A hop or pounce: from (x0,y0) at height z0 to (x1,y1) on the ground, peaking h above the straight line. */
interface Jump { x0: number; y0: number; x1: number; y1: number; h: number; z0: number; into: boolean; then: (() => void) | null }

interface Yarn { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; roll: number; trail: [number, number][]; inBox: boolean; ox: number; gx: number; gy: number }
/** Food dish; like the box it can be lifted, swung and thrown, and spills when tipped. */
interface Dish { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; angle: number; spin: number; gx: number; gy: number; spill: number }
/** One piece of kibble with its own physics; `pour` means it is falling toward the dish. */
interface Kibble { x: number; y: number; z: number; vx: number; vy: number; vz: number; pour: boolean }
/** Cardboard box; x is the centre of its front face, y the ground line under it. */
interface Box { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; tipped: boolean; shake: number; angle: number; spin: number; gx: number; gy: number }
interface Particle { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; kind: SpriteName }

export type Sound = 'meow' | 'mew' | 'pour' | 'crunch' | 'hiss' | 'thud' | 'clink';

export interface Save { v: 1; coat: CoatKey; seed: number; t: number; full: number; rest: number; love: number; bowl: number }

export interface World {
  coat: Coat; coatKey: CoatKey; seed: number;
  hour: number; time: number; needs: { full: number; rest: number; love: number }; bowl: number;
  cat: Cat; yarn: Yarn; box: Box; dish: Dish; kibble: Kibble[]; parts: Particle[];
  pointer: { x: number; y: number; on: boolean; energy: number; moved: number };
  sounds: Sound[];
}

export function adopt(now: number, coat: CoatKey): Save {
  return { v: 1, coat, seed: Math.floor(Math.random() * 1e6), t: now, full: 0.32, rest: 0.8, love: 0.5, bowl: 0 };
}

/** Apply real time spent away: the cat naps, gets peckish, misses you, and eats what is in the bowl. */
export function elapse(w: World, seconds: number) {
  const h = seconds / 3600, n = w.needs;
  n.full = clamp(n.full - 0.07 * h, 0, 1);
  n.love = clamp(n.love - 0.04 * h, 0, 1);
  n.rest = clamp(n.rest + 0.15 * h, 0, 1);
  if (w.bowl > 0 && n.full < 0.75) {
    const bite = Math.min(w.bowl, (0.75 - n.full) * 0.7);
    w.bowl -= bite; n.full += bite / 0.7;
  }
}

export function create(save: Save, now: number): World {
  const coatKey = save.coat;
  const w: World = {
    coat: COATS[coatKey], coatKey, seed: save.seed,
    hour: 12, time: 0, needs: { full: save.full, rest: save.rest, love: save.love }, bowl: save.bowl,
    cat: {
      x: W / 2 + rand(-50, 20), y: rand(WALK_BOTTOM - 21, WALK_BOTTOM - 6), z: 0, dir: 1, mode: 'idle', t: 0, dur: 2, intent: 'wander',
      pose: 'sit', P: { ...POSES.sit }, tx: 0, ty: 0, speed: 0, moving: false, then: null,
      phase: 0, follow: null, floor: false, blinkAt: 2, inBox: false, grumpy: 0, overstim: 0, lastPet: -9, petAcc: 0,
      purr: 0, mouth: 0, look: 0, swipe: 0, bats: 0, cool: 0, tick: 0, jump: null,
    },
    yarn: { x: W / 2 - 64, y: WALK_BOTTOM - 6, z: 0, vx: 0, vy: 0, vz: 0, held: false, roll: 0, trail: [], inBox: false, ox: 0, gx: 0, gy: 0 },
    box: { x: W / 2 + 88, y: WALK_TOP - 2, z: 0, vx: 0, vy: 0, vz: 0, held: false, tipped: false, shake: 0, angle: 0, spin: 0, gx: 0, gy: 0 },
    dish: { x: W / 2 + 130, y: WALK_BOTTOM - 4, z: 0, vx: 0, vy: 0, vz: 0, held: false, angle: 0, spin: 0, gx: 0, gy: 0, spill: 0 },
    kibble: [], parts: [], pointer: { x: 0, y: 0, on: false, energy: 0, moved: -9 }, sounds: [],
  };
  const gone = (now - save.t) / 1000;
  if (gone > 60) elapse(w, gone);
  return w;
}

/** Where the ground sits: a little below the middle of the window, so there is room to throw things up. */
const groundFor = (h: number) => clamp(Math.round(h * 0.55 + 40), 124, h - 12);

/** Fit the scene to the window, keeping everything where it was relative to the centre and the ground. */
export function resize(w: World | null, width: number, height: number) {
  const nw = Math.max(240, Math.round(width)), nh = Math.max(136, Math.round(height));
  if (nw === W && nh === H) return;
  const dx = (nw - W) / 2, gb = groundFor(nh), dy = gb - WALK_BOTTOM;
  W = nw; H = nh; WALK_RIGHT = W - 16; WALK_BOTTOM = gb; WALK_TOP = gb - 50;
  MASK = new Uint8Array(W * H); TMP = new Uint32Array(W * H); IDS = new Uint8Array(W * H); GROUP = new Uint32Array(W * H);
  if (!w) return;
  const c = w.cat;
  c.x += dx; c.tx += dx; c.y += dy; c.ty += dy;
  if (c.jump) { c.jump.x0 += dx; c.jump.x1 += dx; c.jump.y0 += dy; c.jump.y1 += dy; }
  for (const o of [w.yarn, w.box, w.dish, ...w.kibble, ...w.parts]) { o.x += dx; o.y += dy; }
  w.yarn.trail = [];
}

export function snapshot(w: World, now: number): Save {
  return { v: 1, coat: w.coatKey, seed: w.seed, t: now, ...w.needs, bowl: w.bowl };
}

const BOX_HALF = 28, BOX_TALL = 20, TIPPED_TALL = 28, BOX_DX = 10, BOX_DY = -9;

const seat = (b: Box) => (b.tipped ? { x: b.x + 4, y: b.y - 2 } : { x: b.x + 3, y: b.y - 5 });
const boxDoor = (b: Box) => ({ x: clamp(b.x + 3, WALK_LEFT, WALK_RIGHT), y: clamp(b.y + 3, WALK_TOP, WALK_BOTTOM) });
const reachable = (b: Box) => b.x + 3 > WALK_LEFT + 8 && b.x + 3 < WALK_RIGHT - 8;

const isNight = (h: number) => h >= 21.5 || h < 6;

interface Beam { cx: number; top: number; L: number; s: number; half: number; a: number; col: Col }

/** A window-shaped patch of light on the ground. It drifts right to left over the day and stretches toward evening. */
function beamOf(h: number): Beam | null {
  const e = Math.sin(Math.PI * (h - 6.5) / 12);
  if (h > 6.5 && h < 18.5 && e > 0.04) {
    return {
      cx: W / 2 - 40 + (12.5 - h) * 11, top: WALK_TOP + 2, L: 26 + (1 - e) * 18, s: (12.5 - h) * 5, half: 34 + (1 - e) * 6,
      a: smooth(0.04, 0.3, e) * 0.5, col: mix(hex('#ffb36e'), hex('#ffe9a8'), smooth(0.1, 0.5, e)),
    };
  }
  if (isNight(h)) {
    const k = smooth(21.5, 22.5, h) + (h < 6 ? 1 - smooth(5, 6, h) : 0);
    return { cx: W / 2 - 50, top: WALK_TOP + 4, L: 28, s: -8, half: 28, a: 0.3 * clamp(k, 0, 1), col: hex('#a9bcff') };
  }
  return null;
}

function beamCover(b: Beam, x: number, y: number) {
  if (y < b.top || y > b.top + b.L) return 0;
  const t = (y - b.top) / b.L, c = b.cx + b.s * t;
  const dx = Math.abs(x - c), edge = Math.min(b.half - dx, y - b.top, b.top + b.L - y);
  if (edge < 0) return 0;
  if (dx < 1.5 || Math.abs(t - 0.5) * b.L < 1.2) return 0;
  return Math.min(1, Math.ceil(edge / 2) / 3);
}

function beamAt(h: number, x: number, y: number) {
  const b = beamOf(h);
  return b ? beamCover(b, x, y) * b.a : 0;
}

function beamSpot(h: number) {
  const b = beamOf(h);
  if (!b || isNight(h)) return null;
  const y = clamp(b.top + b.L * 0.62, WALK_TOP + 2, WALK_BOTTOM);
  if (y > b.top + b.L - 6) return null;
  const x = b.cx + b.s * (y - b.top) / b.L + 4;
  if (x < WALK_LEFT + 10 || x > WALK_RIGHT - 10) return null;
  return { x, y };
}

function setMode(w: World, mode: Mode, p: PoseName, dur: number) {
  const c = w.cat;
  c.mode = mode; c.pose = p; c.t = 0; c.dur = dur; c.moving = false; c.tick = 0;
}

function leap(w: World, x1: number, y1: number, h: number, into: boolean, then: (() => void) | null, mode: 'hop' | 'pounce', dur: number): Jump {
  const c = w.cat, j: Jump = { x0: c.x, y0: c.y, x1, y1, h, z0: c.z, into, then };
  c.jump = j;
  setMode(w, mode, 'air', dur);
  return j;
}

function hop(w: World, into: boolean, then: () => void) {
  const c = w.cat, s = into ? seat(w.box) : boxDoor(w.box);
  c.dir = into ? (s.x >= c.x ? 1 : -1) : Math.random() < 0.5 ? -1 : 1;
  return leap(w, s.x, s.y, w.box.tipped ? 6 : 18, into, then, 'hop', w.box.tipped ? 0.35 : 0.5);
}

function walkTo(w: World, x: number, y: number, speed: number, intent: Intent, then: () => void) {
  const c = w.cat;
  if (c.inBox) { hop(w, false, () => walkTo(w, x, y, speed, intent, then)); return; }
  setMode(w, 'walk', 'walk', 20);
  c.intent = intent; c.follow = null;
  c.tx = clamp(x, WALK_LEFT, WALK_RIGHT); c.ty = clamp(y, WALK_TOP, WALK_BOTTOM);
  c.speed = speed; c.then = then;
}

/** Sitting or loafing, whichever it feels like. */
const restPose = (): PoseName => (Math.random() < 0.5 ? 'loaf' : 'sit');

function idle(w: World, p: PoseName) {
  setMode(w, 'idle', w.cat.inBox && p === 'sit' && !w.box.tipped ? 'loaf' : p, rand(3, 8));
}

/** Walk to the box, tracking it if it moves, and hop in only from right in front of it. */
function intoBox(w: World, then: () => void) {
  if (!reachable(w.box)) { idle(w, restPose()); return; }
  const d = boxDoor(w.box);
  walkTo(w, d.x, d.y, 36, 'errand', () => {
    const b = w.box, door = boxDoor(b);
    if (b.held || b.z > 1 || !reachable(b)) idle(w, restPose());
    else if (Math.hypot(door.x - w.cat.x, door.y - w.cat.y) > 6) intoBox(w, then);
    else hop(w, true, then);
  });
  w.cat.follow = 'box';
}

function goSleep(w: World) {
  const spot = beamSpot(w.hour);
  if (spot && Math.random() < 0.85) walkTo(w, spot.x, spot.y, 24, 'errand', () => setMode(w, 'sleep', 'sleep', rand(40, 110)));
  else if (w.cat.inBox) setMode(w, 'sleep', 'sleep', rand(40, 110));
  else if (Math.random() < 0.7) intoBox(w, () => setMode(w, 'sleep', 'sleep', rand(40, 110)));
  else setMode(w, 'sleep', 'sleep', rand(40, 110));
}

/** Where the cat stands to eat from (or stare at) the dish; it comes from whichever side has room. */
function dishSpot(w: World, reach: number) {
  const d = w.dish, side = d.x - reach >= WALK_LEFT ? 1 : -1;
  return { x: d.x - side * reach, y: clamp(d.y - 1, WALK_TOP, WALK_BOTTOM), side };
}
const dishBusy = (d: Dish) => d.held || d.z > 1;

function goEat(w: World) {
  const s0 = dishSpot(w, 31);
  walkTo(w, s0.x, s0.y, 34, 'errand', () => {
    const s1 = dishSpot(w, 31), c = w.cat;
    if (dishBusy(w.dish)) idle(w, 'sit');
    else if (Math.hypot(s1.x - c.x, s1.y - c.y) > 6) goEat(w);
    else { c.dir = s1.side; c.floor = false; setMode(w, 'eat', 'eat', 25); }
  });
  w.cat.follow = 'dish';
}

function goBeg(w: World) {
  const s0 = dishSpot(w, 28);
  walkTo(w, s0.x, s0.y + 3, 34, 'errand', () => { w.cat.dir = dishSpot(w, 28).side; setMode(w, 'beg', 'beg', 24); });
}

const settled = (k: Kibble) => !k.pour && k.z === 0 && k.vz === 0;

/** Go and eat kibble off the floor, nearest piece first. */
function goKibble(w: World) {
  const c = w.cat;
  let best: Kibble | null = null, bd = Infinity;
  for (const k of w.kibble) {
    if (!settled(k)) continue;
    const dd = Math.hypot(k.x - c.x, k.y - c.y);
    if (dd < bd) { bd = dd; best = k; }
  }
  if (!best) { idle(w, restPose()); return; }
  const side = best.x >= c.x ? 1 : -1, tx = best.x - side * 30;
  const side2 = tx < WALK_LEFT || tx > WALK_RIGHT ? -side : side;
  const k = best;
  walkTo(w, k.x - side2 * 30, k.y - 1, 30, 'errand', () => { c.dir = side2; c.floor = true; setMode(w, 'eat', 'eat', 30); });
}

function goGroom(w: World) { setMode(w, 'groom', 'groom', rand(2.5, 6)); }

function goPlay(w: World) {
  w.cat.bats = 0;
  if (w.cat.inBox) { hop(w, false, () => goPlay(w)); return; }
  setMode(w, 'play', 'stand', 14);
}

function goVisit(w: World) {
  walkTo(w, clamp(w.cat.x + rand(-50, 50), W / 2 - 70, W / 2 + 40), WALK_BOTTOM, 34, 'errand', () => {
    setMode(w, 'look', 'beg', 4);
    w.cat.mouth = 0.5; w.sounds.push('meow'); burst(w, 'note', 1);
  });
}

function decide(w: World) {
  const n = w.needs, night = isNight(w.hour);
  const opts: [number, () => void][] = [
    [(1 - n.rest) * 3 + (night ? 3.5 : 0) + 0.2, () => goSleep(w)],
    [0.6, () => goGroom(w)],
    [1.1, () => walkTo(w, rand(WALK_LEFT, WALK_RIGHT), rand(WALK_TOP, WALK_BOTTOM), 24, 'wander', () => idle(w, restPose()))],
    [0.8, () => idle(w, restPose())],
  ];
  if (n.full < 0.65 && w.bowl > 0.02) opts.push([(1 - n.full) * 6, () => goEat(w)]);
  const crumbs = w.kibble.some(settled);
  if (n.full < 0.45 && w.bowl <= 0.02 && !crumbs) opts.push([3, () => goBeg(w)]);
  if (n.full < 0.92 && crumbs) opts.push([(1 - n.full) * 8 + 0.8, () => goKibble(w)]);
  if (!night && n.rest > 0.3) opts.push([0.5 + n.rest * (0.4 + n.love), () => goPlay(w)]);
  if (n.love < 0.45) opts.push([1.4, () => goVisit(w)]);
  if (!w.cat.inBox) opts.push([0.35, () => intoBox(w, () => idle(w, 'loaf'))]);
  let r = Math.random() * opts.reduce((s, o) => s + o[0], 0);
  for (const [k, f] of opts) { if ((r -= k) <= 0) { f(); return; } }
  opts[0][1]();
}

const headPos = (c: Cat) => ({ x: c.x + muzzleX(c.P) * c.dir, y: c.y - c.z + c.P.hy });

function burst(w: World, kind: SpriteName, n: number) {
  const h = headPos(w.cat);
  for (let i = 0; i < n; i++) {
    w.parts.push({ x: h.x + rand(-5, 5), y: h.y - 14 + rand(-3, 2), vx: rand(-6, 6), vy: rand(-20, -12), g: 0, life: 1.4, max: 1.4, kind });
  }
}

function moveToward(c: Cat, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
  if (d < 1.2) { c.moving = false; return true; }
  const s = Math.min(d, speed * dt);
  c.x += dx / d * s; c.y += dy / d * s;
  if (Math.abs(dx) > 0.6) c.dir = dx > 0 ? 1 : -1;
  c.phase += s * TAU * DUTY / STRIDE; c.moving = true;
  return false;
}

const floorPointer = (w: World) => ({ x: clamp(w.pointer.x, WALK_LEFT, WALK_RIGHT), y: clamp(w.pointer.y, WALK_TOP, WALK_BOTTOM) });
const awake = (c: Cat) => c.mode !== 'sleep';
const busy = (c: Cat) => !(['idle', 'look', 'groom'].includes(c.mode) || (c.mode === 'walk' && c.intent === 'wander'));

export function stroke(w: World, dist: number) {
  const c = w.cat;
  if (c.mode === 'pounce' || c.mode === 'hop' || c.mode === 'swat') return;
  c.lastPet = w.time;
  c.petAcc += dist;
  if (c.mode === 'sleep') {
    c.purr = Math.max(c.purr, 0.6);
    w.needs.love = Math.min(1, w.needs.love + dist * 0.0008);
    if (c.petAcc > 60) { c.petAcc = 0; burst(w, 'heart', 1); }
    return;
  }
  if (c.grumpy > 0) {
    c.P.ear = 1;
    if (c.mode !== 'walk') walkTo(w, c.x + (c.x < W / 2 ? 100 : -100), rand(WALK_TOP, WALK_BOTTOM), 40, 'errand', () => goGroom(w));
    return;
  }
  if (c.mode !== 'petted') setMode(w, 'petted', c.inBox || c.pose === 'loaf' || c.pose === 'sleep' ? 'loaf' : 'sit', 0);
  w.needs.love = Math.min(1, w.needs.love + dist * 0.0014);
  if (c.petAcc > 38) { c.petAcc = 0; burst(w, 'heart', 1); }
  if (w.needs.love > 0.92) c.overstim += dist;
  if (c.overstim > 380 + hash(w.seed, Math.floor(w.time), 0) * 340) {
    c.overstim = 0; c.grumpy = 12; c.purr = 0;
    setMode(w, 'swat', 'swat', 0.55);
    burst(w, 'vein', 1); w.sounds.push('hiss');
  }
}

export function tap(w: World) {
  const c = w.cat;
  if (c.mode === 'pounce' || c.mode === 'hop') return;
  if (c.mode === 'sleep') {
    c.grumpy = Math.max(c.grumpy, 4); w.needs.rest = Math.max(0, w.needs.rest - 0.05);
    if (c.inBox) idle(w, 'loaf');
    else setMode(w, 'stretch', 'stretch', 1.4);
    burst(w, 'vein', 1);
    return;
  }
  c.mouth = 0.5; burst(w, 'note', 1); w.sounds.push('meow');
  if (!busy(c)) setMode(w, 'look', c.inBox && !w.box.tipped ? 'loaf' : 'beg', 2.5);
}

const KIB = 0.02, SCOOP = 20;

/** Tip a scoop over the dish. Each piece lands in it while there is room and rolls off once it is full. */
export function fillBowl(w: World) {
  const d = w.dish;
  w.sounds.push('pour');
  for (let i = 0; i < SCOOP; i++) {
    w.kibble.push({ x: d.x + rand(-7, 7), y: d.y - 1 + rand(-2.5, 2.5), z: d.z + rand(32, 64), vx: rand(-6, 6), vy: 0, vz: rand(-20, 0), pour: true });
  }
  const c = w.cat;
  if (!awake(c) || c.grumpy > 0 || c.mode === 'eat' || (busy(c) && c.mode !== 'beg')) return;
  if (w.needs.full < 0.95) goEat(w);
  else { c.mouth = 0.4; burst(w, 'note', 1); }
}

export function grabDish(w: World, px: number, py: number) {
  const d = w.dish;
  d.held = true; d.vx = d.vy = d.vz = 0; d.spin = 0;
  d.gx = d.x - px; d.gy = d.y - d.z - py;
}

export function dragDish(w: World, px: number, py: number, vx: number, dt: number) {
  const d = w.dish;
  d.x = px + d.gx;
  const base = py + d.gy;
  if (base >= d.y) { d.y = Math.min(base, WALK_BOTTOM + 8); d.z = 0; }
  else d.z = Math.min(d.y - base, 120);
  const tilt = d.z > 2 ? clamp(vx * 0.005, -1.5, 1.5) : 0;
  d.angle += (tilt - d.angle) * (1 - Math.exp(-dt * 10));
}

export function throwDish(w: World, vx: number, vy: number) {
  const d = w.dish, v = toss(vx, vy);
  d.held = false;
  d.vx = clamp(v.vx, -480, 480); d.vy = clamp(v.vy, -160, 160); d.vz = clamp(v.vz * 1.2, 0, 400);
  if (d.z > 2 || d.vz > 40) d.spin = clamp(d.vx * 0.02, -16, 16);
}

/** Tap on the box: an upright box rustles and invites the cat; a tipped one gets stood back up. */
export function tapBox(w: World) {
  const b = w.box, c = w.cat;
  b.shake = 0.5;
  if (b.tipped) {
    if (c.inBox) evict(w);
    spillYarn(w);
    b.vz = 150; b.spin = (Math.random() < 0.5 ? -1 : 1) * Math.PI / 2 / 0.55; w.sounds.push('thud');
    return;
  }
  if (!c.inBox && awake(c) && c.grumpy <= 0 && !busy(c)) intoBox(w, () => idle(w, 'loaf'));
}

function evict(w: World) {
  const c = w.cat, b = w.box;
  if (!c.inBox) return;
  c.inBox = false;
  c.grumpy = Math.max(c.grumpy, 6);
  burst(w, 'vein', 1); w.sounds.push('mew');
  const side = Math.abs(b.angle) > 0.2 ? Math.sign(b.angle) : c.x < W / 2 ? 1 : -1;
  c.dir = side;
  leap(w, clamp(c.x + side * 46, WALK_LEFT, WALK_RIGHT), clamp(b.y + 12, WALK_TOP, WALK_BOTTOM), 14, false, () => goGroom(w), 'hop', 0.45 + Math.min(0.3, c.z / 200));
}

function spillYarn(w: World) {
  const y = w.yarn, b = w.box;
  if (!y.inBox) return;
  y.inBox = false;
  y.x = b.x + y.ox; y.y = clamp(b.y + 4, WALK_TOP - 4, WALK_BOTTOM + 6); y.z = b.z + 10;
  y.vx = b.vx + rand(-60, 60); y.vy = rand(10, 40); y.vz = Math.max(60, b.vz);
  y.trail = [];
}

export function grabBox(w: World, px: number, py: number) {
  const b = w.box, c = w.cat;
  if (c.mode === 'hop' && c.jump !== null && c.jump.into) { c.inBox = true; c.jump = null; }
  if (c.inBox) { setMode(w, 'look', 'loaf', 99); c.grumpy = Math.max(c.grumpy, 3); }
  b.held = true; b.vx = b.vy = b.vz = 0; b.spin = 0;
  b.gx = b.x - px; b.gy = b.y - b.z - py;
}

/** Up lifts the box; below its footprint drags it nearer. Moving it sideways swings it, which can pour out the cat. */
export function dragBox(w: World, px: number, py: number, vx: number, dt: number) {
  const b = w.box;
  b.x = px + b.gx;
  const base = py + b.gy;
  if (base >= b.y) { b.y = Math.min(base, WALK_BOTTOM + 6); b.z = 0; }
  else b.z = Math.min(b.y - base, 90);
  const tilt = b.z > 2 ? clamp(vx * 0.0045, -1.3, 1.3) : 0;
  b.angle += (tilt - b.angle) * (1 - Math.exp(-dt * 10));
}

export function throwBox(w: World, vx: number, vy: number) {
  const b = w.box;
  b.held = false;
  const v = toss(vx, vy);
  b.vx = clamp(v.vx, -520, 520); b.vy = clamp(v.vy, -160, 160); b.vz = clamp(v.vz * 1.3, 0, 420);
  const flying = b.z > 2 || b.vz > 40;
  if (flying) b.spin = clamp(b.vx * 0.016 + (b.vz > 160 ? rand(-2, 2) : 0), -14, 14);
  else if (Math.abs(b.vx) > 240) { b.vz = 90; b.spin = Math.sign(b.vx) * 7; }
}

/** How high a ball pops up when knocked along the ground: harder knocks lift it more. */
const hopFor = (vx: number, vy: number) => 40 + Math.min(60, Math.hypot(vx, vy) * 0.15);

export function flingYarn(w: World, vx: number, vy: number, vz: number) {
  const y = w.yarn;
  y.vx = clamp(vx, -300, 300); y.vy = clamp(vy, -140, 140); y.vz = vz;
}

export function grabYarn(w: World, px: number, py: number) {
  const y = w.yarn;
  if (y.inBox) { y.inBox = false; y.x = w.box.x + y.ox; }
  y.held = true; y.vx = y.vy = y.vz = 0;
  y.gx = y.x - px; y.gy = y.y - y.z - py;
}

export function dragYarn(w: World, px: number, py: number) {
  const y = w.yarn;
  y.x = px + y.gx;
  const base = py + y.gy;
  if (base >= y.y) { y.y = Math.min(base, WALK_BOTTOM + 6); y.z = 0; }
  else y.z = Math.min(y.y - base, 100);
}

/**
 * A flick on a flat screen has to be read as 3D: upward speed becomes mostly height and partly
 * depth (a lob carries into the scene); a downward flick rolls it toward you.
 */
const toss = (vx: number, vy: number) => ({ vx, vy: vy < 0 ? vy * 0.4 : vy * 0.55, vz: vy < 0 ? -vy * 0.75 : 25 });

export function throwYarn(w: World, vx: number, vy: number) {
  const y = w.yarn, v = toss(vx * 0.85, vy * 0.85);
  y.held = false;
  flingYarn(w, v.vx, v.vy, clamp(v.vz, 0, 340));
}

export function hit(w: World, x: number, y: number, mask: Uint8Array): 'yarn' | 'bowl' | 'box' | 'cat' | null {
  const yn = w.yarn;
  if (Math.hypot(x - yn.x, y - (yn.y - YARN_R - yn.z)) < YARN_R + 4) return 'yarn';
  const dd = w.dish, dy0 = dd.y - dd.z;
  if (Math.abs(x - dd.x) < 16 && y > dy0 - 16 && y < dy0 + 3) return 'bowl';
  const xi = Math.floor(x), yi = Math.floor(y);
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const px = xi + i, py = yi + j;
    if (px >= 0 && py >= 0 && px < W && py < H && mask[py * W + px]) return 'cat';
  }
  const b = w.box, top = b.y - b.z - (b.tipped ? TIPPED_TALL : BOX_TALL) + BOX_DY - (b.tipped ? 0 : 10);
  if (x >= b.x - BOX_HALF - 14 && x <= b.x + BOX_HALF + BOX_DX + 14 && y >= top && y <= b.y - b.z + 6) return 'box';
  return null;
}

export function step(w: World, dt: number) {
  const c = w.cat, n = w.needs, p = w.pointer;
  w.time += dt;
  const hr = dt / 3600;
  n.full = clamp(n.full - 0.07 * hr, 0, 1);
  n.love = clamp(n.love - 0.04 * hr, 0, 1);
  if (c.mode !== 'sleep') n.rest = clamp(n.rest - (c.mode === 'play' || c.mode === 'pounce' ? 0.004 : 0.0004) * dt, 0, 1);

  c.t += dt;
  c.grumpy = Math.max(0, c.grumpy - dt);
  c.overstim = Math.max(0, c.overstim - dt * 22);
  c.mouth = Math.max(0, c.mouth - dt);
  c.swipe = Math.max(0, c.swipe - dt);
  p.energy *= Math.exp(-dt * 1.6);

  if (p.on && !busy(c) && !c.inBox && awake(c) && c.grumpy <= 0 && n.rest > 0.3 && w.time > c.cool && p.energy > 110 && p.y > WALK_TOP - 10) {
    setMode(w, 'stalk', 'crouch', 10);
  }

  let purr = 0;
  switch (c.mode) {
    case 'idle':
      if (p.on && w.time - p.moved < 1 && Math.abs(p.x - c.x) > 30 && !c.inBox && c.pose !== 'loaf') c.dir = p.x > c.x ? 1 : -1;
      if (c.t > c.dur) decide(w);
      break;
    case 'look':
      if (c.t > c.dur) idle(w, restPose());
      break;
    case 'walk': {
      const blocked = (c.follow === 'box' && (w.box.held || w.box.z > 1)) || (c.follow === 'dish' && dishBusy(w.dish));
      if (blocked) {
        c.moving = false;
        if (c.t > 4) { c.follow = null; c.then = null; idle(w, 'sit'); }
        break;
      }
      if (c.follow === 'box') { const d = boxDoor(w.box); c.tx = clamp(d.x, WALK_LEFT, WALK_RIGHT); c.ty = d.y; }
      if (c.follow === 'dish') { const d = dishSpot(w, 31); c.tx = clamp(d.x, WALK_LEFT, WALK_RIGHT); c.ty = d.y; }
      if (moveToward(c, c.tx, c.ty, c.speed, dt) || c.t > c.dur) { c.moving = false; c.follow = null; const f = c.then; c.then = null; f ? f() : idle(w, restPose()); }
      break;
    }
    case 'eat': {
      const mx = c.x + c.dir * 30, my = c.y + 1;
      if (c.floor) {
        if ((c.tick += dt) > 0.35) {
          c.tick = 0;
          const i = w.kibble.findIndex((k) => settled(k) && Math.abs(k.x - mx) < 7 && Math.abs(k.y - my) < 6);
          if (i >= 0) { w.kibble.splice(i, 1); n.full = Math.min(1, n.full + KIB / 0.7); w.sounds.push('crunch'); }
          else if (n.full < 0.97 && w.kibble.some((k) => settled(k) && Math.hypot(k.x - c.x, k.y - c.y) < 80)) goKibble(w);
          else goGroom(w);
        }
        if (n.full >= 0.99 || c.t > c.dur) goGroom(w);
        break;
      }
      const d = w.dish;
      if (dishBusy(d) || Math.abs(mx - d.x) > 6 || Math.abs(c.y - d.y + 1) > 5) {
        if (!dishBusy(d) && w.bowl > 0.02) goEat(w); else idle(w, 'sit');
        break;
      }
      if ((c.tick += dt) > 0.45) { c.tick = 0; w.sounds.push('crunch'); }
      n.full = Math.min(1, n.full + 0.05 * dt);
      w.bowl = Math.max(0, w.bowl - 0.035 * dt);
      if (w.bowl <= 0 || n.full >= 0.99 || c.t > c.dur) goGroom(w);
      break;
    }
    case 'beg':
      if ((c.tick += dt) > 4) { c.tick = 0; c.mouth = 0.5; burst(w, 'note', 1); w.sounds.push('mew'); }
      if (w.bowl > 0.05) goEat(w);
      else if (c.t > c.dur) idle(w, 'loaf');
      break;
    case 'sleep':
      n.rest = Math.min(1, n.rest + 0.006 * dt);
      if ((c.tick += dt) > 1.9) {
        c.tick = 0;
        const h = headPos(c);
        w.parts.push({ x: h.x + c.dir * 6, y: h.y - 10, vx: c.dir * 5, vy: -10, g: 0, life: 2.2, max: 2.2, kind: 'z' });
      }
      if (w.time - c.lastPet < 1.5) purr = 0.6;
      if (c.t > c.dur && n.rest > 0.5 && !isNight(w.hour)) {
        if (c.inBox) idle(w, 'loaf');
        else setMode(w, 'stretch', 'stretch', 1.4);
      } else if (c.t > c.dur) c.dur += 60;
      break;
    case 'stretch':
      if (c.t > c.dur) decide(w);
      break;
    case 'groom':
      if (c.t > c.dur) idle(w, restPose());
      break;
    case 'petted':
      purr = 1;
      if (w.time - c.lastPet > 1.8) { c.overstim *= 0.5; idle(w, c.pose); }
      break;
    case 'swat':
      if (c.t > c.dur) walkTo(w, c.x + (c.x < W / 2 ? 110 : -110), rand(WALK_TOP, WALK_BOTTOM), 40, 'errand', () => goGroom(w));
      break;
    case 'play': {
      const y = w.yarn, b = w.box;
      if (y.held || b.held) { c.moving = false; c.dir = y.x > c.x ? 1 : -1; if (!c.inBox) c.pose = 'crouch'; }
      else if (y.inBox && !b.tipped) {
        if (!c.inBox) { intoBox(w, () => setMode(w, 'play', 'loaf', 8)); break; }
        if ((c.tick += dt) > 0.8) {
          c.tick = 0; c.swipe = 0.3; c.bats++;
          spillYarn(w);
          y.z = b.z + BOX_TALL; flingYarn(w, (Math.random() < 0.5 ? -1 : 1) * rand(50, 110), rand(20, 50), 150);
        }
      } else {
        if (c.inBox) { hop(w, false, () => setMode(w, 'play', 'stand', 10)); break; }
        c.pose = c.moving ? 'walk' : 'stand';
        const tx = y.inBox ? b.x + y.ox : y.x, ty = y.inBox ? b.y + 6 : y.y;
        const near = Math.hypot(tx - c.x - c.dir * 28, ty - c.y);
        if (near < 10 && (y.inBox || y.z < 6) && c.swipe <= 0) {
          c.swipe = 0.3; c.bats++;
          if (y.inBox) { spillYarn(w); flingYarn(w, c.dir * rand(-40, 40), rand(60, 90), 60); }
          else flingYarn(w, c.dir * rand(80, 150), rand(-50, 50), hopFor(c.dir * rand(80, 150), rand(-50, 50)));
          n.rest = Math.max(0, n.rest - 0.02);
        } else if (c.swipe <= 0.1) moveToward(c, clamp(tx - (tx > c.x ? 28 : -28), WALK_LEFT, WALK_RIGHT), clamp(ty, WALK_TOP, WALK_BOTTOM), 62, dt);
      }
      if (c.bats >= 5 || c.t > c.dur || n.rest < 0.25) goGroom(w);
      break;
    }
    case 'stalk': {
      const f = floorPointer(w);
      c.dir = f.x > c.x ? 1 : -1;
      if (!p.on || c.t > c.dur || w.time - p.moved > 3) { c.cool = w.time + 8; idle(w, 'sit'); break; }
      if (Math.hypot(f.x - c.x, f.y - c.y) < 50) { setMode(w, 'wiggle', 'crouch', rand(0.6, 1.4)); break; }
      moveToward(c, f.x - c.dir * 40, f.y, 20, dt);
      c.dir = f.x > c.x ? 1 : -1;
      break;
    }
    case 'wiggle': {
      const f = floorPointer(w);
      c.dir = f.x > c.x ? 1 : -1;
      if (c.t > c.dur) {
        leap(w, clamp(f.x - c.dir * 24, WALK_LEFT, WALK_RIGHT), f.y, 20, false, null, 'pounce', 0.42);
      }
      break;
    }
    case 'pounce':
    case 'hop': {
      const j = need(c.jump, 'a jump while hopping');
      const k = Math.min(1, c.t / c.dur);
      if (j.into) {
        // Track a box that is nudged mid-hop; if it is snatched away, just land.
        const b = w.box, s = seat(b);
        if (b.held || b.z > 1 || Math.hypot(s.x - j.x1, s.y - j.y1) > 14) j.into = false;
        else { j.x1 = s.x; j.y1 = s.y; }
      }
      c.x = j.x0 + (j.x1 - j.x0) * k; c.y = j.y0 + (j.y1 - j.y0) * k; c.z = j.z0 * (1 - k) * (1 - k) + Math.sin(Math.PI * k) * j.h;
      if (k >= 1) {
        c.z = 0; c.jump = null;
        if (c.mode === 'hop') {
          c.inBox = !!j.into;
          if (c.inBox && w.box.tipped) c.dir = -1;
          if (j.then) j.then(); else idle(w, restPose());
          break;
        }
        c.cool = w.time + 6;
        const f = floorPointer(w);
        if (p.on && Math.hypot(f.x - c.x - c.dir * 24, f.y - c.y) < 20) {
          n.love = Math.min(1, n.love + 0.04); burst(w, 'spark', 2);
        }
        goGroom(w);
      }
      break;
    }
  }

  if (c.inBox && c.mode !== 'hop') { const s = seat(w.box); c.x = s.x; c.y = s.y; c.z = w.box.z; }

  if (w.time > c.blinkAt + 0.14) c.blinkAt = w.time + rand(2.5, 6);
  c.look = p.on && awake(c) ? clamp(Math.round((p.x - headPos(c).x) * c.dir / 50), -1, 1) : 0;

  c.purr += (purr - c.purr) * (1 - Math.exp(-dt * 4));

  const T: Pose = { ...POSES[c.pose] };
  if (c.mode === 'groom') T.paw = 0.55 + 0.45 * Math.sin(w.time * 7);
  if (c.swipe > 0) { T.paw = 1; T.pawX = 24; T.pawY = -8; }
  if (c.mode === 'wiggle') T.wig = 1;
  if (c.mode === 'petted') { T.eye = 0; T.ear = 0; }
  if (c.grumpy > 0) T.ear = 1;
  if (c.mode === 'stalk' || c.mode === 'wiggle') T.ear = 0.3;
  if (c.mode === 'look' || c.mode === 'beg') T.front = 1;
  if (c.inBox && c.pose === 'loaf') T.eye = c.mode === 'sleep' ? 0 : 0.85;
  const k = 1 - Math.exp(-dt * (c.mode === 'pounce' || c.mode === 'hop' || c.swipe > 0 ? 18 : 8));
  for (const key of POSE_KEYS) c.P[key] += (T[key] - c.P[key]) * k;

  stepBox(w, dt);
  stepDish(w, dt);
  stepKibble(w, dt);
  stepYarn(w, dt);

  for (let i = w.parts.length - 1; i >= 0; i--) {
    const q = w.parts[i];
    q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
    if (q.life <= 0) w.parts.splice(i, 1);
  }
}

const QUARTER = Math.PI / 2;

const footprint = (b: Box) => ({ x0: b.x - BOX_HALF, x1: b.x + BOX_HALF + BOX_DX, back: b.y + BOX_DY, front: b.y });

function stepBox(w: World, dt: number) {
  const b = w.box, y = w.yarn;
  b.shake = Math.max(0, b.shake - dt);
  if (b.held) { pour(w); return; }
  const wasUp = b.z > 0 || b.vz > 0;
  b.vz -= 560 * dt; b.z += b.vz * dt;
  if (b.z > 0) b.angle += b.spin * dt;
  if (b.z <= 0) {
    const impact = -b.vz;
    b.z = 0;
    if (wasUp && impact > 25) {
      const q = Math.round(b.angle / QUARTER), off = b.angle - q * QUARTER;
      w.sounds.push('thud'); b.shake = 0.35;
      if (impact > 90 && Math.abs(off) > 0.35) {
        // Landed on an edge: bounce and keep turning the way it was going.
        b.vz = impact * 0.38;
        b.spin = Math.sign(off) * Math.max(Math.abs(b.spin) * 0.55, 5);
      } else {
        if (Math.abs(q) % 2 === 1) b.tipped = !b.tipped;
        b.angle = off; b.spin = 0;
        b.vz = impact > 160 ? impact * 0.18 : 0;
        landed(w, impact);
      }
      b.vx *= 0.7;
    } else b.vz = 0;
  }
  if (b.z === 0 && b.vz === 0) b.angle *= Math.exp(-dt * 16);
  if (b.z === 0) { b.vx *= Math.exp(-dt * 4.5); b.vy *= Math.exp(-dt * 4.5); }
  b.x += b.vx * dt; b.y += b.vy * dt;
  if (b.y < WALK_TOP - 8) { b.y = WALK_TOP - 8; b.vy = Math.abs(b.vy) * 0.15; }
  if (b.y > WALK_BOTTOM + 6) { b.y = WALK_BOTTOM + 6; b.vy = -Math.abs(b.vy) * 0.15; }
  const m = BOX_HALF + BOX_DX + 12;
  if (b.x < -m) b.x += W + 2 * m;
  if (b.x > W + m) b.x -= W + 2 * m;

  const f = footprint(b);
  if (b.z < 6 && Math.abs(b.vx) > 1) {
    const dh = w.dish;
    if (!dh.held && dh.z < 6 && dh.x + 15 > f.x0 && dh.x - 15 < f.x1 && dh.y > f.back - 4 && dh.y - 6 < f.front + 2) {
      // The box shoves the dish along, and the jolt slops some kibble out.
      dh.x = b.vx > 0 ? f.x1 + 15.5 : f.x0 - 15.5;
      dh.vx = b.vx * 0.9; dh.vz = 30; dh.spin = Math.sign(b.vx) * 3;
      b.vx *= 0.35; b.shake = 0.3; w.sounds.push('clink');
    }
    if (!y.inBox && !y.held && y.z < 6 && y.x > f.x0 - YARN_R && y.x < f.x1 + YARN_R && y.y > f.back - 2 && y.y < f.front + 8) {
      y.x = b.vx > 0 ? f.x1 + YARN_R + 1 : f.x0 - YARN_R - 1;
      flingYarn(w, b.vx * 1.3, rand(-20, 20), 50);
    }
  }
  pour(w);
}

function pour(w: World) {
  const b = w.box, c = w.cat;
  if (Math.abs(b.angle) > 0.6) spillYarn(w);
  if (c.inBox && Math.abs(b.angle) > 0.55) evict(w);
}

function landed(w: World, impact: number) {
  const b = w.box, c = w.cat, f = footprint(b);
  if (c.inBox) { idle(w, 'loaf'); return; }
  if (c.mode === 'hop' || c.z > 1) return;
  if (c.x < f.x0 - 4 || c.x > f.x1 || c.y < f.back - 2 || c.y > f.front + 6) return;
  if (!b.tipped && impact < 260) {
    // Dropped right over the cat: it lives here now.
    hop(w, true, () => { setMode(w, 'look', 'loaf', 2.5); burst(w, 'note', 1); }).h = 4;
    c.dur = 0.25;
  } else {
    const side = c.x < b.x ? -1 : 1;
    c.dir = side; c.grumpy = Math.max(c.grumpy, 5);
    leap(w, clamp(c.x + side * 50, WALK_LEFT, WALK_RIGHT), clamp(c.y + 12, WALK_TOP, WALK_BOTTOM), 22, false, () => goGroom(w), 'hop', 0.45);
    burst(w, 'vein', 1); w.sounds.push('hiss');
  }
}

function emitSpill(w: World, side: number) {
  const d = w.dish;
  w.bowl = Math.max(0, w.bowl - KIB);
  w.kibble.push({
    x: d.x + side * 12 * Math.cos(d.angle), y: d.y + rand(-2, 2), z: d.z + 8 + side * 12 * Math.sin(d.angle) * -1,
    vx: d.vx * 0.6 + side * rand(15, 55), vy: rand(-12, 12), vz: rand(0, 30) + Math.max(0, d.vz) * 0.5, pour: false,
  });
}

function stepDish(w: World, dt: number) {
  const d = w.dish;
  // Tipped past the rim: kibble pours out of the low side, faster the further it leans.
  const lean = Math.abs(Math.sin(d.angle)), wrong = Math.cos(d.angle) < 0;
  if ((lean > 0.5 || wrong) && w.bowl >= KIB) {
    d.spill += dt * (wrong ? 40 : (lean - 0.5) * 60);
    while (d.spill >= 1 && w.bowl >= KIB) { d.spill -= 1; emitSpill(w, Math.sign(Math.sin(d.angle)) || 1); }
  } else d.spill = 0;
  if (d.held) return;
  const wasUp = d.z > 0 || d.vz > 0;
  d.vz -= 560 * dt; d.z += d.vz * dt;
  if (d.z > 0) d.angle += d.spin * dt;
  if (d.z <= 0) {
    const impact = -d.vz;
    d.z = 0;
    if (wasUp && impact > 25) {
      w.sounds.push('clink');
      if (impact > 150) { const n = Math.round((w.bowl / KIB) * clamp((impact - 150) / 250, 0.1, 0.6)); for (let i = 0; i < n; i++) emitSpill(w, Math.random() < 0.5 ? -1 : 1); }
      d.vz = impact > 120 ? impact * 0.25 : 0; d.spin *= 0.3; d.vx *= 0.7;
      // A dish always comes to rest the right way up.
      d.angle = Math.atan2(Math.sin(d.angle), Math.cos(d.angle));
    } else d.vz = 0;
  }
  if (d.z === 0 && d.vz === 0) { d.angle *= Math.exp(-dt * 12); d.spin = 0; d.vx *= Math.exp(-dt * 6); d.vy *= Math.exp(-dt * 6); }
  d.x += d.vx * dt; d.y += d.vy * dt;
  if (d.x < -20) d.x += W + 40;
  if (d.x > W + 20) d.x -= W + 40;
  if (d.y < WALK_TOP - 2) { d.y = WALK_TOP - 2; d.vy = Math.abs(d.vy) * 0.15; }
  if (d.y > WALK_BOTTOM + 8) { d.y = WALK_BOTTOM + 8; d.vy = -Math.abs(d.vy) * 0.15; }
}

function stepKibble(w: World, dt: number) {
  const d = w.dish, list = w.kibble;
  for (let i = list.length - 1; i >= 0; i--) {
    const k = list[i];
    if (settled(k)) continue;
    k.vz -= 320 * dt; k.z += k.vz * dt; k.x += k.vx * dt; k.y += k.vy * dt;
    if (k.pour && k.vz < 0) {
      const rim = d.z + 9;
      const over = ((k.x - d.x) / 12) ** 2 + ((k.y - d.y + 1) / 4.5) ** 2 < 1 && Math.abs(d.angle) < 0.4 && !d.held;
      if (over && k.z <= rim && k.z > rim - 10) {
        if (w.bowl < 1 - KIB / 2) { w.bowl = Math.min(1, w.bowl + KIB); list.splice(i, 1); continue; }
        // Full: it bounces off the heap and over the rim.
        const side = k.x >= d.x ? 1 : -1;
        k.pour = false; k.z = rim + 2; k.vx = side * rand(25, 60); k.vy = rand(-14, 14); k.vz = rand(30, 70);
      }
    }
    if (k.z <= 0) {
      k.z = 0; k.pour = false;
      if (k.vz < -40) { k.vz = -k.vz * 0.3; k.vx *= 0.6; k.vy *= 0.6; } else k.vz = 0;
    }
    if (k.z === 0) {
      k.vx *= Math.exp(-dt * 7); k.vy *= Math.exp(-dt * 7);
      if (k.vz === 0 && Math.hypot(k.vx, k.vy) < 2) { k.vx = k.vy = 0; }
    }
    k.y = clamp(k.y, WALK_TOP, WALK_BOTTOM + 3);
    if (k.x < -10 || k.x > W + 10) list.splice(i, 1);
  }
  if (list.length > 220) list.splice(0, list.length - 220);
}

function stepYarn(w: World, dt: number) {
  const y = w.yarn, b = w.box;
  if (y.inBox) {
    y.x = b.x + y.ox;
    y.y = b.y - (b.tipped ? 5 : 6);
    y.z = b.z + (b.tipped ? 0 : 9);
    y.vx = y.vy = y.vz = 0;
  } else if (!y.held) {
    const prevZ = y.z, prevX = y.x;
    y.vz -= 420 * dt; y.z += y.vz * dt;
    if (y.z <= 0) { y.z = 0; y.vz = y.vz < -30 ? -y.vz * 0.45 : 0; }
    const f = y.z === 0 ? Math.exp(-dt * 2) : 1;
    y.vx *= f; y.vy *= f;
    y.x += y.vx * dt; y.y += y.vy * dt;
    if (y.x < -12) { y.x += W + 24; y.trail = []; }
    if (y.x > W + 12) { y.x -= W + 24; y.trail = []; }
    if (y.y > WALK_BOTTOM + 6) { y.y = WALK_BOTTOM + 6; y.vy = -Math.abs(y.vy) * 0.15; }
    if (y.y < WALK_TOP - 4) { y.y = WALK_TOP - 4; y.vy = Math.abs(y.vy) * 0.15; }

    const fp = footprint(b), level = Math.abs(b.angle) < 0.25 && !b.held;
    const sy = y.y - y.z, ssx = y.x;
    if (level && !b.tipped) {
      // Coming down through the open top, judged on screen so a lob from the front still lands in.
      const top = b.y - b.z - BOX_TALL;
      const inX = ssx > fp.x0 + 6 && ssx < fp.x1 - 6;
      if (inX && y.vz < 0 && prevZ > y.z && sy > top + BOX_DY - 4 && sy < top + 6 && y.y > fp.back - 14 && y.y < fp.front + 46) {
        y.inBox = true; y.ox = clamp(ssx - b.x, -BOX_HALF + 8, BOX_HALF);
        b.shake = 0.3; w.sounds.push('thud'); y.trail = [];
      } else if (y.z < BOX_TALL + b.z && y.x > fp.x0 - YARN_R && y.x < fp.x1 + YARN_R && y.y > fp.back - 3 && y.y < fp.front + 5) {
        if (prevX <= fp.x0 - YARN_R + 1 || prevX >= fp.x1 + YARN_R - 1) { y.x = prevX; y.vx = -y.vx * 0.5; }
        else if (y.y > b.y - 3) { y.y = fp.front + 5; y.vy = Math.abs(y.vy) * 0.5 + 10; }
        else { y.y = fp.back - 3; y.vy = -Math.abs(y.vy) * 0.5 - 10; }
      }
    } else if (level && b.tipped) {
      if (y.x > b.x - BOX_HALF + 6 && y.x < b.x + BOX_HALF - 6 && y.y > b.y - 9 && y.y < b.y + 9 && y.z < TIPPED_TALL - 8) {
        y.inBox = true; y.ox = clamp(y.x - b.x, -BOX_HALF + 9, BOX_HALF - 9); y.trail = [];
      }
    }
    const dh = w.dish, bx = y.x - dh.x, by = (y.y - dh.y + 3) * 2, bd = Math.hypot(bx, by);
    if (!dh.held && bd < 22 && y.z < dh.z + 12 && y.z + 2 * YARN_R > dh.z) { const s = 22 / (bd || 1); y.x = dh.x + bx * s; y.y = dh.y - 3 + by * s / 2; y.vx = bx / (bd || 1) * 60; y.vy = by / (bd || 1) * 30; dh.vx -= y.vx * 0.1; }
    y.roll += y.vx * dt * 0.35;
  }
  const last = y.trail[y.trail.length - 1];
  if (!y.inBox && (!last || Math.hypot(last[0] - y.x, last[1] - y.y) > 4)) {
    y.trail.push([y.x, y.y]);
    if (y.trail.length > 16) y.trail.shift();
  }

  const c = w.cat, speed = Math.hypot(y.vx, y.vy, y.vz);
  if ((speed > 70 || y.inBox) && !y.held && awake(c) && c.grumpy <= 0 && w.needs.rest > 0.3 &&
      ['idle', 'look', 'groom'].includes(c.mode) && Math.hypot(y.x - c.x, y.y - c.y) < 130 && (!y.inBox || Math.random() < dt * 0.4)) goPlay(w);
}

const C = {
  boxIn: hex('#7d5632'), boxInWall: hex('#a5763f'), boxFront: hex('#d4a465'), boxSide: hex('#b98b52'), boxTop: hex('#ddb377'),
  boxFlap: hex('#e2b97c'), boxFlapIn: hex('#c79a5f'), boxLine: hex('#8a6236'), tape: hex('#efd9a8'),
  bowl: hex('#7fa8d4'), bowlShade: hex('#6890bd'), bowlRim: hex('#b4cfea'), bowlIn: hex('#4d77a3'), bowlBand: hex('#f6f1e7'), bowlLine: hex('#3e5f86'),
  kib: hex('#a2633a'), kib2: hex('#c07d46'), kib3: hex('#7e4a2a'),
  yarn: hex('#e07489'), yarnHi: hex('#f6aebb'), yarnLo: hex('#b9506a'), yarnLine: hex('#8e3550'),
  pink: hex('#e7909c'), pupil: hex('#1d1818'),
};

function drawKibble(buf: Uint32Array, k: Kibble) {
  const h = hash(Math.floor(k.x * 0.37 + k.y * 5.1), 3, 0), col = h > 0.66 ? C.kib2 : h > 0.33 ? C.kib : C.kib3;
  const x = Math.round(k.x), y = Math.round(k.y - k.z);
  put(buf, x, y, col); put(buf, x + 1, y, col); put(buf, x, y - 1, mix(col, WHITE, 0.15));
}

function drawShadow(buf: Uint32Array, x: number, y: number, rx: number, ry: number, a: number) {
  for (let yy = Math.floor(y - ry); yy <= Math.ceil(y + ry); yy++) for (let xx = Math.floor(x - rx); xx <= Math.ceil(x + rx); xx++) {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const d = ((xx + 0.5 - x) / rx) ** 2 + ((yy + 0.5 - y) / ry) ** 2;
    if (d <= 1) blend(buf, yy * W + xx, SHADOW, d < 0.5 ? a : a * 0.6);
  }
}

function drawBeam(buf: Uint32Array, hour: number) {
  const b = beamOf(hour);
  if (!b || b.a <= 0.001) return;
  for (let y = b.top; y <= Math.min(H - 1, b.top + b.L); y++) for (let x = 0; x < W; x++) {
    const k = beamCover(b, x + 0.5, y + 0.5);
    if (k > 0) blend(buf, y * W + x, b.col, k * b.a);
  }
}

function boxFrame(b: Box) {
  const sx = b.shake > 0 ? Math.round(Math.sin(b.shake * 40) * 1.5) : 0;
  const x0 = Math.round(b.x - BOX_HALF + sx), x1 = Math.round(b.x + BOX_HALF + sx), f = Math.round(b.y - b.z);
  return { x0, x1, f, dx: BOX_DX, dy: BOX_DY };
}

function boxBack(layer: Uint32Array, b: Box) {
  const { x0, x1, f, dx, dy } = boxFrame(b);
  if (b.tipped) {
    const t = f - TIPPED_TALL;
    poly(layer, [x0, t, x1, t, x1 + dx, t + dy, x0 + dx, t + dy], C.boxTop);
    poly(layer, [x1, t, x1 + dx, t + dy, x1 + dx, f + dy, x1, f], C.boxSide);
    poly(layer, [x0, t, x0, f, x0 - 13, f + 3, x0 - 13, t + 4], C.boxFlapIn);
    poly(layer, [x0, t, x1, t, x1, f, x0, f], C.boxIn);
    poly(layer, [x0 + 3 + dx * 0.6, t + 3 + dy * 0.6, x1 - 3, t + 3 + dy * 0.6, x1 - 3, f - 3, x0 + 3 + dx * 0.6, f - 3], (x, y) => (y > f - 7 ? C.boxInWall : mix(C.boxIn, C.boxInWall, 0.35)));
    return;
  }
  const m = f - BOX_TALL;
  poly(layer, [x0 + dx, m + dy, x1 + dx, m + dy, x1 + dx + 2, m + dy - 9, x0 + dx + 2, m + dy - 9], C.boxFlap);
  poly(layer, [x0, m, x0 + dx, m + dy, x0 + dx - 18, m + dy + 1, x0 - 18, m + 1], C.boxFlapIn);
  poly(layer, [x0, m, x1, m, x1 + dx, m + dy, x0 + dx, m + dy], C.boxIn);
  poly(layer, [x0 + 2, m - 1, x1 + 2, m - 1, x1 + dx, m + dy, x0 + dx, m + dy], (x, y) => (y < m + dy + 4 ? C.boxInWall : C.boxIn));
  poly(layer, [x1, m, x1 + dx, m + dy, x1 + dx + 16, m + dy + 4, x1 + 16, m + 4], C.boxFlap);
}

function boxFront(layer: Uint32Array, b: Box) {
  const { x0, x1, f, dx, dy } = boxFrame(b);
  if (b.tipped) {
    const t = f - TIPPED_TALL;
    for (let y = t; y <= f; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (x < x0 + 3 || x > x1 - 3 || y < t + 3 || y > f - 3) layer[y * W + x] = y < t + 3 ? mix(C.boxFront, WHITE, 0.2) : C.boxFront;
    }
    poly(layer, [x0 + 2, f, x1 - 2, f, x1 - 6, f + 6, x0 + 6, f + 6], C.boxFlap);
    for (let y = f - 14; y < f - 6; y++) for (let x = x1 - 3; x <= x1; x++) if (x < W && y >= 0) layer[y * W + x] = C.tape;
    return;
  }
  const m = f - BOX_TALL;
  poly(layer, [x1, m, x1 + dx, m + dy, x1 + dx, f + dy, x1, f], C.boxSide);
  poly(layer, [x0, m, x1, m, x1, f, x0, f], (x, y) => (y === m ? mix(C.boxFront, WHITE, 0.25) : y >= f - 2 ? mix(C.boxFront, INK, 0.1) : C.boxFront));
  const tx = Math.round((x0 + x1) / 2);
  for (let y = m; y < m + 8; y++) for (let x = tx - 4; x < tx + 4; x++) if (x >= 0 && x < W && y >= 0) layer[y * W + x] = C.tape;
  for (const [ax, ay, bx2] of [[x0 + 7, m + 9, x0 + 15], [x0 + 7, m + 12, x0 + 12]]) line(layer, ax, ay, bx2, ay, C.boxSide, 1);
  line(layer, x1 - 12, f - 6, x1 - 9, f - 9, C.boxSide, 1); line(layer, x1 - 9, f - 9, x1 - 6, f - 6, C.boxSide, 1);
}

function drawBowl(layer: Uint32Array, w: World) {
  const x = Math.round(w.dish.x), y = Math.round(w.dish.y - w.dish.z);
  poly(layer, [x - 15, y - 10, x + 15, y - 10, x + 11, y - 1, x - 11, y - 1], (px, py) => {
    if (py >= y - 7 && py <= y - 6) return C.bowlBand;
    return px > x + 6 ? C.bowlShade : C.bowl;
  });
  ellipse(layer, x, y - 1.5, 11, 2.5, C.bowlShade);
  ellipse(layer, x, y - 10, 15, 4.2, C.bowlRim);
  ellipse(layer, x, y - 10, 12.5, 3, C.bowlIn);
  if (w.bowl > 0.01) {
    const n = Math.ceil(w.bowl * 46), mound = w.bowl * 3.5;
    for (let i = 0; i < n; i++) {
      const a = hash(i, 4, 0) * TAU, r = Math.sqrt(hash(i, 5, 0));
      const px = x + Math.cos(a) * r * 11, py = y - 10 + Math.sin(a) * r * 2.4 - mound * (1 - r * r);
      const col = i % 3 === 0 ? C.kib2 : i % 5 === 0 ? C.kib3 : C.kib;
      put(layer, px, py, col); put(layer, px + 1, py, col);
    }
  }
}

function drawYarn(layer: Uint32Array, w: World) {
  const y = w.yarn, r = YARN_R;
  const cx = y.x, cy = y.y - r - y.z;
  ellipse(layer, cx, cy, r, r, (px, py) => {
    const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
    const a = y.roll, u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    const band = Math.abs(((u + v * v * 0.06) % 3.2 + 3.2) % 3.2 - 1.6);
    const cross = Math.abs(((v * 0.9 + u * 0.3) % 5 + 5) % 5 - 2.5) < 0.55 && dx * dx + dy * dy < r * r * 0.7;
    const lit = dx * -0.55 + dy * -0.8;
    if (cross) return C.yarnHi;
    let col = band < 0.55 ? C.yarnLo : C.yarn;
    if (lit > r * 0.45) col = mix(col, C.yarnHi, 0.55);
    else if (lit < -r * 0.5) col = mix(col, C.yarnLo, 0.6);
    return col;
  });
}

function drawTrail(buf: Uint32Array, w: World) {
  const y = w.yarn, tr = y.trail;
  let px = y.x, py = y.y - 1;
  if (y.z > 1 && !y.inBox) {
    // A lifted ball trails its thread straight down to where it lies on the ground.
    const top = y.y - y.z, sway = clamp(-y.vx * 0.02, -4, 4);
    let qx = y.x, qy = top;
    for (let k = 1; k <= 6; k++) {
      const f = k / 6, nx = y.x + sway * Math.sin(Math.PI * f), ny = top + (y.y - 1 - top) * f;
      line(buf, qx, qy, nx, ny, C.yarn, 0.9);
      qx = nx; qy = ny;
    }
  }
  for (let i = tr.length - 1; i >= 0; i--) {
    const [tx, ty] = tr[i];
    const wob = Math.sin(i * 1.7) * 1.5;
    line(buf, px, py, tx + wob, ty - 1, C.yarn, 0.85 * (i / tr.length) + 0.1);
    px = tx + wob; py = ty - 1;
  }
}

let TMP = new Uint32Array(W * H);
let IDS = new Uint8Array(W * H);

let GROUP = new Uint32Array(W * H);

function rotateInto(dst: Uint32Array, src: Uint32Array, cx: number, cy: number, ang: number) {
  const cos = Math.cos(ang), sin = Math.sin(ang), R = 64;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, Math.ceil(cx + R)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = Math.floor(cos * dx + sin * dy + cx), sy = Math.floor(-sin * dx + cos * dy + cy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const v = src[sy * W + sx];
      if (v) dst[y * W + x] = v;
    }
  }
}

function stamp(buf: Uint32Array, draw: (l: Uint32Array) => void, outer: Col) {
  TMP.fill(0);
  draw(TMP);
  outline(TMP, outer);
  for (let i = 0; i < W * H; i++) if (TMP[i]) buf[i] = TMP[i];
}

function drawCat(layer: Uint32Array, w: World) {
  layer.fill(0); IDS.fill(0);
  const c = w.cat, P = c.P, d = c.dir, t = w.time, cc = w.coat;
  const ax = Math.round(c.x), ay = Math.round(c.y - c.z);
  const X = (lx: number) => ax + lx * d, Y = (ly: number) => ay + ly;
  const dark = luma(cc.base) < 90;
  const outer = dark ? hex('#17141a') : mix(cc.base, INK, 0.7);
  const inner = dark ? hex('#201c23') : mix(cc.base, INK, 0.34);
  let id = 0;
  const paint = (part: Part, cy: number, ry: number, far: boolean) => {
    const me = ++id;
    return (x: number, y: number) => {
      IDS[y * W + x] = me;
      const lx = (x + 0.5 - ax) * d, ly = y + 0.5 - ay;
      let col = fur(cc, part, lx, ly, P, w.seed);
      const k = (ly - cy) / ry;
      if (k > 0.5) col = mix(col, INK, 0.14);
      else if (k < -0.65) col = mix(col, WHITE, 0.1);
      return far ? mix(col, INK, 0.3) : col;
    };
  };
  const blob = (b: Blob, p: Paint) => ellipse(layer, X(b.x), Y(b.y), b.rx, b.ry, p);

  const asleep = c.mode === 'sleep';
  const breath = 1 + Math.sin(t * (asleep ? 1.7 : 2.6)) * (asleep ? 0.05 : 0.02);
  const bob = c.moving ? (1 - Math.cos(2 * c.phase)) * 0.4 : 0;
  const T = torso(P, P.bx + P.wig * Math.sin(t * 24) * 2, P.by - bob, P.bry * breath);
  const f = P.front, hx = P.hx;
  const hy = P.hy - bob * 0.2 + (c.mode === 'eat' ? Math.abs(Math.sin(t * 7)) * 1.5 : 0) + (asleep ? (breath - 1) * 6 : 0);
  const mx = hx + 5.2 * (1 - f);
  const air = c.z > 1;

  const gait = (off: number): [number, number] => {
    if (!c.moving) return [0, 0];
    const u = (((c.phase / TAU + off) % 1) + 1) % 1;
    if (u < DUTY) return [STRIDE / 2 - STRIDE * (u / DUTY), 0];
    const v = (u - DUTY) / (1 - DUTY);
    return [-STRIDE / 2 + STRIDE * v * v * (3 - 2 * v), Math.sin(Math.PI * v) * 3.2];
  };
  const ik = (jx: number, jy: number, fx: number, fy: number, a: number, b: number, bend: number): [number, number] => {
    const dist = Math.hypot(fx - jx, fy - jy);
    if (dist >= a + b - 0.01) return [(jx + fx) / 2, (jy + fy) / 2];
    const A = Math.acos(clamp((a * a + dist * dist - b * b) / (2 * a * Math.max(dist, 0.01)), -1, 1));
    const ang = Math.atan2(fy - jy, fx - jx) + bend * A;
    return [jx + Math.cos(ang) * a, jy + Math.sin(ang) * a];
  };
  // Front legs fold forward at the wrist, hind legs back at the hock. Each leg is one part, drawn
  // behind the body so the body's lower edge reads as the belly line rather than a seam.
  const leg = (j: { x: number; y: number }, vis: number, off: number, far: boolean, front: boolean, paw: number) => {
    if (vis < 0.06 && paw < 0.06) return;
    const [gx, lift] = gait(off);
    let fx = j.x + (front ? 1 : -0.5) + (far ? (front ? -2.5 : 2.5) : 0) + gx, fy = -lift - 1.5;
    if (air) { fx = j.x + (front ? 11 : -11); fy = j.y + 6; }
    fx += (P.pawX - fx) * paw; fy += (P.pawY - fy) * paw;
    const k = Math.max(Math.min(1, vis * 2), paw), ex = j.x + (fx - j.x) * k, ey = j.y + (fy - j.y) * k;
    const pt = paint('leg', ey, 8, far);
    const [kx, ky] = ik(j.x, j.y, ex, ey, front ? 7.4 : 6.8, front ? 7.2 : 6.4, front ? -1 : 1);
    capsule(layer, X(j.x), Y(j.y), X(kx), Y(ky), front ? 2.3 : 2.4, pt);
    capsule(layer, X(kx), Y(ky), X(ex), Y(ey), 1.8, pt);
    ellipse(layer, X(ex + 1.1), Y(ey + 0.5), 2.6, 1.6, pt);
  };
  const tail = () => {
    let a = P.tailA, x = T.tail.x, y = T.tail.y;
    const amp = asleep ? 0.01 : c.grumpy > 0 || c.mode === 'stalk' || c.mode === 'wiggle' ? 0.11 : 0.035;
    const freq = asleep ? 0.8 : c.grumpy > 0 || c.mode === 'wiggle' ? 7 : 2;
    const pt = paint('tail', 0, 1, false);
    for (let i = 1; i <= 11; i++) {
      a += P.tailC + amp * Math.sin(t * freq - i * 0.55);
      const nx = x - Math.cos(a) * 2.8, ny = Math.min(-2, y - Math.sin(a) * 2.8);
      capsule(layer, X(x), Y(y), X(nx), Y(ny), 2.5 - i * 0.07, pt);
      x = nx; y = ny;
    }
  };
  // Ears: in profile the near ear stands at the back of the skull and the far one peeks past it;
  // facing you they spread symmetrically. e folds them flat.
  const earPts = (side: -1 | 1) => {
    const e = P.ear, lerp = (a: number, b: number) => a + (b - a) * f;
    const prof = side < 0 ? [-4.2, -3.6, 1.2, -5.4, -2.6, -12] : [0.6, -5.4, 4.6, -3.4, 3.4, -10.6];
    const face = side < 0 ? [-6.6, -2.6, -1.4, -5.6, -4.8, -12.2] : [1.4, -5.6, 6.6, -2.6, 4.8, -12.2];
    const p = prof.map((v, i) => lerp(v, face[i]));
    const tipX = p[4] + (side * 8 - p[4]) * e, tipY = p[5] + (-6.5 - p[5]) * e;
    return [hx + p[0], hy + p[1], hx + p[2], hy + p[3], hx + tipX, hy + tipY];
  };
  const ear = (side: -1 | 1) => {
    const [a1, a2, b1, b2, t1, t2] = earPts(side);
    poly(layer, [X(a1), Y(a2), X(b1), Y(b2), X(t1), Y(t2)], paint('ear', hy - 9, 5, side > 0 && f < 0.5));
  };

  leg(T.hip, P.legB, 0.5, true, false, 0);
  leg(T.shoulder, P.legF, 0.75, true, true, 0);
  if (P.tf < 0.5) tail();
  ear(1); ear(-1);
  leg(T.hip, P.legB, 0, false, false, 0);
  const pawUp = P.paw > 0.3;
  if (!pawUp) leg(T.shoulder, P.legF, 0.25, false, true, P.paw);
  const body = paint('body', T.waist.y, P.bry, false);
  blob(T.rump, body); blob(T.waist, body); blob(T.chest, body);
  if (P.legB > 0.3 && P.haunch < 0.5) ellipse(layer, X(T.hip.x + 1), Y(T.hip.y - 1.5), 4.6, 5.4 * Math.min(1, P.legB), body);
  if (P.haunch > 0.05) {
    ellipse(layer, X(T.rump.x - 0.5), Y(T.rump.y + 0.5), 8.5 * P.haunch, 7.5 * P.haunch, paint('haunch', T.rump.y, 8, false));
    ellipse(layer, X(T.rump.x + 7), Y(-2), 6 * P.haunch, 2 * P.haunch, paint('leg', -2, 3, false));
  }
  const neckId = id + 1;
  capsule(layer, X(T.neck.x), Y(T.neck.y), X(hx - 2.5 + f), Y(hy + 3.2), 4.6, paint('body', T.waist.y, P.bry, false));
  if (pawUp) leg(T.shoulder, P.legF, 0.25, false, true, P.paw);
  if (P.legF < 0.2 && P.haunch < 0.5 && !asleep) ellipse(layer, X(T.chest.x + T.chest.rx * 0.55), Y(-1.8), 3.2, 1.7, paint('leg', -1.8, 2, false));
  const head = paint('head', hy + 1, 7, false);
  ellipse(layer, X(hx), Y(hy), 6.4, 5.8, head);
  ellipse(layer, X(hx + 1.6 * (1 - f)), Y(hy + 2.8), 5.4 + f, 3.9, head);
  ellipse(layer, X(mx), Y(hy + 2.6), 2.9 + 0.8 * f, 2.5, head);
  if (P.tf >= 0.5) tail();

  outlineParts(layer, outer, IDS, inner, new Set([neckId]));

  // Face details go on after the outline so they never get one.
  const fp = (lx: number) => Math.round(X(lx) - (d < 0 ? 1 : 0));
  const pink = mix(C.pink, cc.base, 0.4);
  for (const side of [-1, 1] as const) {
    if (side > 0 && f < 0.5) continue;
    const [a1, a2, b1, b2, t1, t2] = earPts(side);
    const cxp = (a1 + b1 + t1) / 3, cyp = (a2 + b2 + t2) / 3, k = 0.42, sh = f < 0.5 ? 0.8 : 0;
    poly(layer, [X(cxp + (a1 - cxp) * k + sh), Y(cyp + (a2 - cyp) * k + 1), X(cxp + (b1 - cxp) * k + sh), Y(cyp + (b2 - cyp) * k + 1), X(cxp + (t1 - cxp) * k + sh), Y(cyp + (t2 - cyp) * k + 1)], pink);
  }
  const blink = w.time > c.blinkAt && w.time < c.blinkAt + 0.14;
  const open = blink ? 0 : P.eye;
  const ey = Y(hy - 0.3), lid = dark ? hex('#121014') : outer;
  const iris = cc.eye, slit = C.pupil;
  const eyes = f > 0.5 ? [hx - 2.8, hx + 2.8] : [hx + 3.4];
  for (const lx of eyes) {
    const ex = fp(lx) + (f > 0.5 ? c.look : 0), corner = f > 0.5 ? (lx < hx ? -1 : 1) : d;
    if (open > 0.6) {
      put(layer, ex - 1, ey, iris); put(layer, ex, ey, slit); put(layer, ex + 1, ey, iris);
      put(layer, ex - 1, ey + 1, mix(iris, INK, 0.3)); put(layer, ex, ey + 1, slit); put(layer, ex + 1, ey + 1, mix(iris, INK, 0.3));
      for (let i = -1; i <= 1; i++) put(layer, ex + i, ey - 1, lid);
      put(layer, ex + corner * 2, ey, lid);
      put(layer, ex - corner, ey, mix(iris, WHITE, 0.5));
    } else if (open > 0.3) {
      for (let i = -1; i <= 1; i++) put(layer, ex + i, ey, lid);
      put(layer, ex - 1, ey + 1, iris); put(layer, ex, ey + 1, slit); put(layer, ex + 1, ey + 1, iris);
    } else {
      for (let i = -1; i <= 1; i++) put(layer, ex + i, ey + 1, lid);
      put(layer, ex + corner * 2, ey, lid);
    }
  }
  if (f > 0.5) {
    const nx = fp(hx), ny = Y(hy + 2.2);
    put(layer, nx, ny, C.pink); put(layer, nx + 1, ny, C.pink);
    if (c.mouth > 0) { put(layer, nx, ny + 2, lid); put(layer, nx + 1, ny + 2, lid); put(layer, nx, ny + 3, C.pink); }
    else { put(layer, nx, ny + 1, lid); put(layer, nx - 1, ny + 2, lid); put(layer, nx + 1, ny + 2, lid); }
  } else {
    const nx = fp(mx + 2.4), ny = Y(hy + 1.4);
    put(layer, nx, ny, C.pink); put(layer, nx - d, ny, C.pink);
    if (c.mouth > 0) { put(layer, nx - d, ny + 3, lid); put(layer, nx - 2 * d, ny + 3, lid); put(layer, nx - d, ny + 4, C.pink); }
    else { put(layer, nx - d, ny + 3, lid); put(layer, nx - 2 * d, ny + 3, lid); }
  }
  if (!asleep) {
    const wc = dark ? hex('#d6cfc4') : mix(INK, cc.base, 0.55);
    for (const side of f > 0.5 ? [-1, 1] : [1]) for (const dy of [-1.4, 0, 1.5]) {
      const sx = fp(mx + side * 2.2), sy = Y(hy + 3.2);
      line(layer, sx, sy, sx + side * d * 8, sy + dy * 1.8, wc, 0.9);
    }
  }
}

export function render(w: World, buf: Uint32Array, layer: Uint32Array, hitMask: Uint8Array) {
  buf.fill(0);
  drawBeam(buf, w.hour);

  const c = w.cat, b = w.box;
  const bs = Math.max(0.5, 1 - b.z * 0.012);
  drawShadow(buf, b.x + BOX_DX / 2 + 2, b.y - 1, (BOX_HALF + 12) * bs, 5 * bs, 0.13);
  const dh = w.dish, ds = Math.max(0.4, 1 - dh.z * 0.012);
  drawShadow(buf, dh.x, dh.y, 16 * ds, 3.5 * ds, 0.14);
  for (const k of w.kibble) if (k.z === 0) drawKibble(buf, k);
  drawShadow(buf, w.yarn.x, w.yarn.y, YARN_R * Math.max(0.4, 1 - w.yarn.z * 0.02), 2.5, 0.14);
  if (!c.inBox) {
    const s = Math.max(0.4, 1 - c.z * 0.03);
    drawShadow(buf, c.x + c.P.bx * c.dir * 0.4, c.y, c.P.brx * 0.95 * s, 3.4 * s, 0.13);
  }
  drawTrail(buf, w);

  drawCat(layer, w);
  const lit = beamAt(w.hour, c.x, c.y - 2), beam = beamOf(w.hour);
  const fr = boxFrame(b);
  const catPixels = (dst: Uint32Array, clip: boolean) => {
    for (let i = 0; i < W * H; i++) {
      let v = layer[i];
      if (v && clip) {
        const x = i % W, y = (i - x) / W;
        if (x < fr.x0 + 3 || x > fr.x1 - 3 || y < fr.f - TIPPED_TALL + 3 || y > fr.f - 3) v = 0;
      }
      hitMask[i] = v ? 1 : 0;
      if (v) dst[i] = lit && beam ? mix(v, beam.col, lit * 0.5) : v;
    }
  };
  const yarnIn = w.yarn.inBox, catIn = c.inBox && c.mode !== 'hop';
  const items: [number, () => void][] = [[dh.y, () => {
    if (Math.abs(dh.angle) < 0.02) { stamp(buf, (l) => drawBowl(l, w), C.bowlLine); return; }
    GROUP.fill(0);
    stamp(GROUP, (l) => drawBowl(l, w), C.bowlLine);
    rotateInto(buf, GROUP, dh.x, dh.y - dh.z - 5, dh.angle);
  }]];
  if (Math.abs(b.angle) > 0.02) {
    // A swinging or tumbling box is drawn as one piece, with whatever is inside, then rotated.
    items.push([b.y, () => {
      GROUP.fill(0);
      stamp(GROUP, (l) => boxBack(l, b), C.boxLine);
      if (yarnIn) stamp(GROUP, (l) => drawYarn(l, w), C.yarnLine);
      if (catIn) catPixels(GROUP, b.tipped);
      stamp(GROUP, (l) => boxFront(l, b), C.boxLine);
      rotateInto(buf, GROUP, b.x + BOX_DX / 2, fr.f - (b.tipped ? TIPPED_TALL : BOX_TALL) / 2, b.angle);
    }]);
  } else {
    items.push([b.y - TIPPED_TALL, () => stamp(buf, (l) => boxBack(l, b), C.boxLine)]);
    items.push([b.y, () => stamp(buf, (l) => boxFront(l, b), C.boxLine)]);
    if (yarnIn) items.push([b.y - 6, () => stamp(buf, (l) => drawYarn(l, w), C.yarnLine)]);
    if (catIn) items.push([b.y - 2, () => catPixels(buf, b.tipped)]);
  }
  if (!yarnIn) items.push([w.yarn.y, () => stamp(buf, (l) => drawYarn(l, w), C.yarnLine)]);
  if (!catIn) items.push([c.y, () => catPixels(buf, false)]);
  items.sort((a, z) => a[0] - z[0]).forEach(([, f]) => f());

  for (const k of w.kibble) if (k.z > 0) drawKibble(buf, k);
  for (const q of w.parts) sprite(buf, q.kind, q.x, q.y, Math.min(1, q.life / q.max * 2));
}

export function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** Render one still frame without a page, for the lab poster. */
export function still(coatKey: CoatKey, hour: number, setup: (w: World) => void) {
  const world = create({ ...adopt(0, coatKey), seed: 7, full: 0.9, rest: 0.4, love: 0.9, bowl: 0.7 }, 0);
  world.hour = hour;
  setup(world);
  world.cat.P = { ...POSES[world.cat.pose] };
  if (world.cat.mode === 'look' || world.cat.mode === 'beg') world.cat.P.front = 1;
  if (world.cat.inBox) { const s = seat(world.box); world.cat.x = s.x; world.cat.y = s.y; }
  world.time = 1;
  world.cat.blinkAt = 99;
  const buf = new Uint32Array(W * H), layer = new Uint32Array(W * H), hm = new Uint8Array(W * H);
  render(world, buf, layer, hm);
  return buf;
}
export { POSES, beamSpot };

/** The audio graph, built on the first user gesture (browsers refuse audio before one). */
interface Rig { ctx: AudioContext; master: GainNode; purr: GainNode; noise: AudioBuffer }

class Sfx {
  private rig: Rig | null = null;

  unlock() {
    if (!this.rig) this.rig = Sfx.build();
    if (this.rig.ctx.state === 'suspended') void this.rig.ctx.resume();
  }

  private static build(): Rig {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, noise = ctx.createBuffer(1, len, ctx.sampleRate), data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; data[i] = last * 3.2; }
    // Purr: brown noise through a low-pass, chopped ~25 times a second.
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 25;
    const depth = ctx.createGain(); depth.gain.value = 0.45;
    lfo.connect(depth).connect(am.gain);
    const purr = ctx.createGain(); purr.gain.value = 0;
    src.connect(lp).connect(am).connect(purr).connect(master);
    src.start(); lfo.start();
    return { ctx, master, purr, noise };
  }

  purr(level: number, t: number) {
    if (!this.rig) return;
    const breath = 0.7 + 0.3 * Math.sin(t * 2.4);
    this.rig.purr.gain.setTargetAtTime(level * breath * 0.9, this.rig.ctx.currentTime, 0.08);
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
    if (sound === 'meow' || sound === 'mew') {
      const k = sound === 'mew' ? 1.25 : 1, len = sound === 'mew' ? 0.38 : 0.62, p = k * rand(0.92, 1.08);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(480 * p, t); o.frequency.linearRampToValueAtTime(780 * p, t + len * 0.3); o.frequency.linearRampToValueAtTime(520 * p, t + len);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
      f.frequency.setValueAtTime(800, t); f.frequency.linearRampToValueAtTime(1700, t + len * 0.35); f.frequency.linearRampToValueAtTime(700, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(sound === 'mew' ? 0.18 : 0.3, t + 0.07);
      g.gain.linearRampToValueAtTime(0.2, t + len * 0.6); g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(f).connect(g).connect(rig.master);
      o.start(t); o.stop(t + len + 0.05);
    } else if (sound === 'crunch') {
      this.burst(rig, t, 0.05, 'bandpass', 1900, 0.12);
      this.burst(rig, t + 0.08, 0.04, 'bandpass', 2400, 0.08);
    } else if (sound === 'pour') {
      for (let i = 0; i < 14; i++) this.burst(rig, t + Math.random() * 0.5, 0.025, 'bandpass', rand(2600, 4200), 0.1);
    } else if (sound === 'hiss') {
      this.burst(rig, t, 0.5, 'highpass', 3200, 0.16);
    } else if (sound === 'clink') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(rand(1500, 1900), t);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(rig.master); o.start(t); o.stop(t + 0.3);
      this.burst(rig, t, 0.05, 'bandpass', 3000, 0.08);
    } else if (sound === 'thud') {
      this.burst(rig, t, 0.16, 'lowpass', 260, 0.5);
      this.burst(rig, t + 0.01, 0.06, 'bandpass', 900, 0.12);
    }
  }
}

const KEY = 'lab:sunbeam';

/** `?hour=20` pins the clock for testing; anything unparseable is ignored. */
function hourParam(raw: string | null): number | null {
  if (raw === null) return null;
  const h = Number(raw);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The saved cat, if there is a valid one. Storage can be blocked or hold an older format. */
function loadSave(): Save | null {
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (raw === null) return null;
  let data: Json;
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { v, coat, seed, t, full, rest, love, bowl } = data;
  const nums = [seed, t, full, rest, love, bowl];
  if (v !== 1 || typeof coat !== 'string' || !isCoatKey(coat)) return null;
  if (!nums.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;
  return { v: 1, coat, seed: nums[0], t: nums[1], full: nums[2], rest: nums[3], love: nums[4], bowl: nums[5] };
}

export function mountSunbeam(cv: HTMLCanvasElement, stage: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const forcedHour = hourParam(params.get('hour'));
  const coatParam = params.get('coat');
  const forcedCoat = coatParam !== null && isCoatKey(coatParam) ? coatParam : null;
  const saved = loadSave();

  const scaleFor = (css: number) => (css >= 900 ? 3 : css >= 560 ? 2 : Math.max(1, css / 320));
  const view = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  resize(null, view().w / scaleFor(view().w), view().h / scaleFor(view().w));

  const now = Date.now();
  let save = saved === null ? adopt(now, randomCoat()) : saved;
  if (forcedCoat !== null) save = { ...save, coat: forcedCoat };
  const w = create(save, now);
  const sfx = new Sfx();

  const persist = () => {
    try {
      const s = snapshot(w, Date.now());
      if (forcedCoat !== null && saved !== null) s.coat = saved.coat;
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch { /* ignore */ }
  };

  const ctx = context2d(cv, {});
  let image = ctx.createImageData(W, H);
  let buf = new Uint32Array(image.data.buffer);
  let layer = new Uint32Array(W * H), hitMask = new Uint8Array(W * H);

  function fit() {
    const v = view(), k = scaleFor(v.w);
    resize(w, v.w / k, v.h / k);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      image = ctx.createImageData(W, H);
      buf = new Uint32Array(image.data.buffer);
      layer = new Uint32Array(W * H); hitMask = new Uint8Array(W * H);
    }
    cv.style.width = `${W * k}px`;
    cv.style.height = `${H * k}px`;
  }
  cv.width = W; cv.height = H;
  fit();
  new ResizeObserver(fit).observe(stage);

  const toWorld = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };
  type Drag = { kind: 'yarn' | 'cat' | 'box' | 'bowl'; x: number; y: number; total: number; vx: number; vy: number; t: number; grabbed: boolean };
  let drag: Drag | null = null;

  cv.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    const p = toWorld(e);
    Object.assign(w.pointer, { x: p.x, y: p.y, on: true });
    const what = hit(w, p.x, p.y, hitMask);
    if (what) {
      drag = { kind: what, x: p.x, y: p.y, total: 0, vx: 0, vy: 0, t: performance.now(), grabbed: false };
      cv.setPointerCapture(e.pointerId);
      if (what === 'yarn') grabYarn(w, p.x, p.y);
      cv.style.cursor = 'grabbing';
    }
    e.preventDefault();
  });

  cv.addEventListener('pointermove', (e) => {
    const p = toWorld(e), ptr = w.pointer;
    const d = ptr.on ? Math.hypot(p.x - ptr.x, p.y - ptr.y) : 0;
    Object.assign(ptr, { x: p.x, y: p.y, on: true, moved: w.time });
    if (!drag) {
      ptr.energy += d;
      const what = hit(w, p.x, p.y, hitMask);
      cv.style.cursor = what ? 'grab' : 'default';
      return;
    }
    const nowMs = performance.now(), dts = Math.max(1, nowMs - drag.t) / 1000;
    drag.vx = drag.vx * 0.5 + (p.x - drag.x) / dts * 0.5; drag.vy = drag.vy * 0.5 + (p.y - drag.y) / dts * 0.5;
    drag.x = p.x; drag.y = p.y; drag.t = nowMs; drag.total += d;
    if (drag.kind === 'yarn') dragYarn(w, p.x, p.y);
    else if (drag.kind === 'box') {
      if (drag.total > 3 && !drag.grabbed) { drag.grabbed = true; grabBox(w, p.x, p.y); }
      if (drag.grabbed) dragBox(w, p.x, p.y, drag.vx, dts);
    } else if (drag.kind === 'bowl') {
      if (drag.total > 3 && !drag.grabbed) { drag.grabbed = true; grabDish(w, p.x, p.y); }
      if (drag.grabbed) dragDish(w, p.x, p.y, drag.vx, dts);
    } else if (drag.total > 3) stroke(w, d);
  });

  const release = () => {
    if (!drag) return;
    if (drag.kind === 'yarn') throwYarn(w, drag.vx, drag.vy);
    else if (drag.kind === 'box') { if (drag.grabbed) throwBox(w, drag.vx * 0.9, drag.vy * 0.9); else tapBox(w); }
    else if (drag.kind === 'bowl') { if (drag.grabbed) throwDish(w, drag.vx * 0.9, drag.vy * 0.9); else fillBowl(w); }
    else if (drag.total <= 3) tap(w);
    drag = null;
    cv.style.cursor = 'grab';
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) w.pointer.on = false; });

  cv.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    sfx.unlock();
    if (k === 'enter') stroke(w, 30);
    else if (k === ' ') { grabYarn(w, w.yarn.x, w.yarn.y); throwYarn(w, rand(-220, 220), -rand(80, 220)); }
    else if (k === 'f') fillBowl(w);
    else if (k === 'm') tap(w);
    else if (k === 'b') tapBox(w);
    else if (k === 't') { grabBox(w, w.box.x, w.box.y); throwBox(w, (Math.random() < 0.5 ? -1 : 1) * 260, -260); }
    else return;
    e.preventDefault();
  });

  let last = performance.now(), lastWall = Date.now(), saveT = 0;
  function frame(t: number) {
    const wall = Date.now();
    if (wall - lastWall > 5000) elapse(w, (wall - lastWall) / 1000);
    lastWall = wall;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    w.hour = forcedHour === null ? localHour() : forcedHour;
    step(w, dt);
    for (const s of w.sounds) sfx.play(s);
    w.sounds.length = 0;
    sfx.purr(w.cat.purr, w.time);
    render(w, buf, layer, hitMask);
    ctx.putImageData(image, 0, 0);
    if ((saveT += dt) > 4) { saveT = 0; persist(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  persist();
}
