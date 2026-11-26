import { need } from '../../lib/dom';
import { COATS, DUTY, POSE_KEYS, POSES, STRIDE, muzzleX, type Coat, type CoatKey, type Pose, type PoseName } from './rig';
import { clamp, hash, rand, TAU } from './util';

let W = 320;
let H = 136;
let WALK_TOP = 74, WALK_BOTTOM = 124;
const WALK_LEFT = 16;
let WALK_RIGHT = W - 16;
export const YARN_R = 7;

type Mode = 'idle' | 'walk' | 'eat' | 'sleep' | 'groom' | 'beg' | 'play' | 'stalk' | 'wiggle' |
  'pounce' | 'petted' | 'swat' | 'hop' | 'stretch' | 'look' | 'spook' | 'held';
type Intent = 'wander' | 'errand';

export interface Cat {
  x: number; y: number; z: number; dir: number; mode: Mode; t: number; dur: number; intent: Intent;
  pose: PoseName; P: Pose; tx: number; ty: number; speed: number; moving: boolean; then: (() => void) | null;
  phase: number; follow: 'box' | 'dish' | null; floor: boolean; blinkAt: number; inBox: boolean; grumpy: number; overstim: number; lastPet: number; petAcc: number;
  purr: number; mouth: number; look: number; swipe: number; bats: number; cool: number; tick: number;
  jump: Jump | null;
  /** The solid the cat is sitting on top of, or -1 on the floor. */
  perch: number;
}

/** A hop or pounce: from (x0,y0) at height z0 to (x1,y1) on the ground, peaking h above the straight line. */
interface Jump { x0: number; y0: number; x1: number; y1: number; h: number; z0: number; z1: number; perch: number; into: boolean; then: (() => void) | null }

interface Yarn { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; roll: number; trail: [number, number][]; inBox: boolean; ox: number }
interface Dish { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; angle: number; spin: number; spill: number }
interface Kibble { x: number; y: number; z: number; vx: number; vy: number; vz: number; pour: boolean }
interface Scoop { left: number; acc: number; show: number }
/** Cardboard box; x is the centre of its front face, y the ground line under it. */
interface Box { x: number; y: number; z: number; vx: number; vy: number; vz: number; held: boolean; tipped: boolean; shake: number; angle: number; spin: number }
type ParticleKind = 'heart' | 'z' | 'note' | 'spark' | 'vein' | 'kibble';
interface Particle { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; kind: ParticleKind }

export type Sound = 'meow' | 'mew' | 'laowu' | 'beg' | 'trill' | 'hiss' | 'spook' | 'clatter' | 'pour' | 'crunch' | 'thud' | 'clink';

export interface Save { v: 1; coat: CoatKey; seed: number; t: number; full: number; rest: number; love: number; bowl: number }

export interface World {
  coat: Coat; coatKey: CoatKey; seed: number;
  hour: number; time: number; needs: { full: number; rest: number; love: number }; bowl: number;
  cat: Cat; yarn: Yarn; box: Box; dish: Dish; kibble: Kibble[]; scoop: Scoop; parts: Particle[];
  pointer: { x: number; y: number; on: boolean; energy: number; moved: number; hand: boolean; sx: number; sy: number; x0: number; y0: number };
  sounds: Sound[];
}

export function adopt(now: number, coat: CoatKey): Save {
  return { v: 1, coat, seed: Math.floor(Math.random() * 1e6), t: now, full: 0.32, rest: 0.8, love: 0.5, bowl: 0 };
}

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
      purr: 0, mouth: 0, look: 0, swipe: 0, bats: 0, cool: 0, tick: 0, jump: null, perch: -1,
    },
    yarn: { x: W / 2 - 64, y: WALK_BOTTOM - 6, z: 0, vx: 0, vy: 0, vz: 0, held: false, roll: 0, trail: [], inBox: false, ox: 0 },
    box: { x: W / 2 + 88, y: WALK_TOP - 2, z: 0, vx: 0, vy: 0, vz: 0, held: false, tipped: false, shake: 0, angle: 0, spin: 0 },
    dish: { x: W / 2 + 130, y: WALK_BOTTOM - 4, z: 0, vx: 0, vy: 0, vz: 0, held: false, angle: 0, spin: 0, spill: 0 },
    kibble: [], scoop: { left: 0, acc: 0, show: 0 }, parts: [], pointer: { x: 0, y: 0, on: false, energy: 0, moved: -9, hand: false, sx: 0, sy: 0, x0: 0, y0: 0 }, sounds: [],
  };
  const gone = (now - save.t) / 1000;
  if (gone > 60) elapse(w, gone);
  for (const o of [w.box, w.dish, w.yarn]) {
    const k = solidAt(o.x, o.y);
    if (k >= 0) o.y = SOLIDS[k].y1 + 12;
  }
  return w;
}

const groundFor = (h: number) => clamp(Math.round(h * 0.55 + 40), 124, h - 12);

export function setWorldSize(width: number, height: number) {
  W = width; H = height; WALK_RIGHT = W - 16; WALK_BOTTOM = groundFor(H); WALK_TOP = WALK_BOTTOM - 50;
}

export function floorBounds() {
  return { left: WALK_LEFT, right: WALK_RIGHT, top: WALK_TOP, bottom: WALK_BOTTOM };
}

export function setFloorDepth(depth: number) {
  WALK_TOP = WALK_BOTTOM - depth;
}

/** Something standing on the floor, in world units. Things land on its top if `perch`, and bounce off its sides. */
export interface Solid { x0: number; x1: number; y0: number; y1: number; top: number; perch: boolean }
let SOLIDS: Solid[] = [];
export function setRoom(solids: Solid[]) { SOLIDS = solids; }

const solidAt = (x: number, y: number) => SOLIDS.findIndex((o) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1);
export const groundAt = (x: number, y: number) => {
  const i = solidAt(x, y);
  return i >= 0 && SOLIDS[i].perch ? SOLIDS[i].top : 0;
};

function bumpSolids(o: { x: number; y: number; z: number; vx: number; vy: number }, px: number, py: number, r: number) {
  for (const s of SOLIDS) {
    if (o.z >= s.top - 0.5) continue;
    const inX = (x: number) => x + r > s.x0 && x - r < s.x1, inY = (y: number) => y + r / 2 > s.y0 && y - r / 2 < s.y1;
    if (!inX(o.x) || !inY(o.y)) continue;
    if (!inX(px)) { o.x = px; o.vx = -o.vx * 0.5; }
    else if (!inY(py)) { o.y = py; o.vy = -o.vy * 0.5; }
    else { o.y = s.y1 + r / 2; o.vy = Math.abs(o.vy) * 0.5; }
  }
}

function walls(o: { x: number; vx: number }) {
  if (o.x < WALK_LEFT) { o.x = WALK_LEFT; o.vx = Math.abs(o.vx) * 0.4; }
  if (o.x > WALK_RIGHT) { o.x = WALK_RIGHT; o.vx = -Math.abs(o.vx) * 0.4; }
}

/** Where the cat can stand next to a solid, on the floor in front of it. */
const frontOf = (s: Solid, x: number) => ({ x: clamp(x, s.x0 + 6, s.x1 - 6), y: clamp(s.y1 + 10, WALK_TOP, WALK_BOTTOM) });

export function snapshot(w: World, now: number): Save {
  return { v: 1, coat: w.coatKey, seed: w.seed, t: now, ...w.needs, bowl: w.bowl };
}

export const BOX_HALF = 28, BOX_TALL = 20, TIPPED_TALL = 28, BOX_DX = 10, BOX_DY = -16;

const seat = (b: Box) => ({ x: b.x + 3, y: b.y + BOX_DY / 2 });
const boxDoor = (b: Box) => ({ x: clamp(b.x + 3, WALK_LEFT, WALK_RIGHT), y: clamp(b.y + 3, WALK_TOP, WALK_BOTTOM) });
const reachable = (b: Box) => b.x + 3 > WALK_LEFT + 8 && b.x + 3 < WALK_RIGHT - 8;

const isNight = (h: number) => h >= 21.5 || h < 6;

/** Where the sun through the window lands on the floor at this hour, if it does. */
export function beamSpot(h: number) {
  const e = Math.sin(Math.PI * (h - 6.5) / 12);
  if (h <= 6.5 || h >= 18.5 || e <= 0.04) return null;
  const top = WALK_TOP + 2, L = 26 + (1 - e) * 18, cx = W / 2 - 40 + (12.5 - h) * 11, s = (12.5 - h) * 5;
  const y = clamp(top + L * 0.62, WALK_TOP + 2, WALK_BOTTOM);
  if (y > top + L - 6) return null;
  const x = cx + s * (y - top) / L + 4;
  if (x < WALK_LEFT + 10 || x > WALK_RIGHT - 10) return null;
  return { x, y };
}

function setMode(w: World, mode: Mode, p: PoseName, dur: number) {
  const c = w.cat;
  c.mode = mode; c.pose = p; c.t = 0; c.dur = dur; c.moving = false; c.tick = 0;
}

function leap(w: World, x1: number, y1: number, h: number, into: boolean, then: (() => void) | null, mode: 'hop' | 'pounce', dur: number, perch = -1): Jump {
  const c = w.cat, z1 = perch >= 0 ? SOLIDS[perch].top : 0;
  const j: Jump = { x0: c.x, y0: c.y, x1, y1, h, z0: c.z, z1, perch, into, then };
  c.perch = -1;
  c.jump = j;
  setMode(w, mode, mode === 'hop' ? 'tuck' : 'air', dur);
  return j;
}

function hop(w: World, into: boolean, then: () => void) {
  const c = w.cat, s = into ? seat(w.box) : boxDoor(w.box);
  c.dir = into ? (s.x >= c.x ? 1 : -1) : Math.random() < 0.5 ? -1 : 1;
  return leap(w, s.x, s.y, w.box.tipped ? 7 : BOX_TALL + 12, into, then, 'hop', w.box.tipped ? 0.35 : 0.55);
}

function walkTo(w: World, x: number, y: number, speed: number, intent: Intent, then: () => void) {
  const c = w.cat;
  if (c.inBox) { hop(w, false, () => walkTo(w, x, y, speed, intent, then)); return; }
  if (c.perch >= 0) { getDown(w, () => walkTo(w, x, y, speed, intent, then)); return; }
  setMode(w, 'walk', 'walk', 20);
  c.intent = intent; c.follow = null;
  c.tx = clamp(x, WALK_LEFT, WALK_RIGHT); c.ty = clamp(y, WALK_TOP, WALK_BOTTOM);
  const inside = solidAt(c.tx, c.ty);
  if (inside >= 0) { const f = frontOf(SOLIDS[inside], c.tx); c.tx = f.x; c.ty = f.y; }
  const z = boxZone(w), out = z && inZone(z, c.tx, c.ty) ? zoneExit(z, c.tx, c.ty) : null;
  if (out) { c.tx = out.x; c.ty = out.y; }
  c.speed = speed; c.then = then;
}

const restPose = (): PoseName => (Math.random() < 0.5 ? 'loaf' : 'sit');

function idle(w: World, p: PoseName) {
  setMode(w, 'idle', w.cat.inBox && p === 'sit' && !w.box.tipped ? 'loaf' : p, rand(3, 8));
}

function intoBox(w: World, then: () => void) {
  if (!reachable(w.box)) { idle(w, restPose()); return; }
  const d = boxDoor(w.box);
  walkTo(w, d.x, d.y, 52, 'errand', () => {
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

function dishSpot(w: World, reach: number) {
  const d = w.dish, side = d.x - reach >= WALK_LEFT ? 1 : -1;
  return { x: d.x - side * reach, y: clamp(d.y - 1, WALK_TOP, WALK_BOTTOM), side };
}
const dishBusy = (d: Dish) => d.held || d.z > 1;

function goEat(w: World) {
  const s0 = dishSpot(w, 31);
  walkTo(w, s0.x, s0.y, 54, 'errand', () => {
    const s1 = dishSpot(w, 31), c = w.cat;
    if (dishBusy(w.dish)) idle(w, 'sit');
    else if (Math.hypot(s1.x - c.x, s1.y - c.y) > 6) goEat(w);
    else { c.dir = s1.side; c.floor = false; setMode(w, 'eat', 'eat', 25); }
  });
  w.cat.follow = 'dish';
}

function goBeg(w: World) {
  const s0 = dishSpot(w, 28);
  walkTo(w, s0.x, s0.y + 3, 48, 'errand', () => { w.cat.dir = dishSpot(w, 28).side; setMode(w, 'beg', 'beg', 24); });
}

const settled = (k: Kibble) => !k.pour && k.z === 0 && k.vz === 0;

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
  walkTo(w, k.x - side2 * 30, k.y - 1, 50, 'errand', () => { c.dir = side2; c.floor = true; setMode(w, 'eat', 'eat', 30); });
}

function goGroom(w: World) { setMode(w, 'groom', 'groom', rand(2.5, 6)); }

function spook(w: World, fromX: number) {
  const c = w.cat;
  if (c.inBox || c.jump !== null || c.mode === 'spook') return;
  c.dir = fromX >= c.x ? 1 : -1;
  c.grumpy = Math.max(c.grumpy, 5); c.purr = 0; c.moving = false; c.follow = null; c.then = null;
  setMode(w, 'spook', 'arch', rand(1.5, 2.1));
  burst(w, 'vein', 1); w.sounds.push('spook');
}

function goPlay(w: World) {
  w.cat.bats = 0;
  if (w.cat.inBox) { hop(w, false, () => goPlay(w)); return; }
  if (w.cat.perch >= 0) { getDown(w, () => goPlay(w)); return; }
  setMode(w, 'play', 'stand', 14);
}

function getDown(w: World, then: () => void) {
  const c = w.cat;
  if (c.perch < 0) { then(); return; }
  const f = frontOf(SOLIDS[c.perch], c.x);
  c.dir = Math.random() < 0.5 ? -1 : 1;
  leap(w, f.x, f.y, 10, false, then, 'hop', 0.5);
}

function goPerch(w: World, then: () => void) {
  const tops = SOLIDS.map((s, i) => [s, i] as const).filter(([s]) => s.perch && s.x1 - s.x0 > 40);
  if (!tops.length) return;
  const [s, i] = tops[Math.floor(Math.random() * tops.length)];
  const x = rand(s.x0 + 16, s.x1 - 16), f = frontOf(s, x);
  walkTo(w, f.x, f.y, 30, 'errand', () => {
    w.cat.dir = x >= w.cat.x ? 1 : -1;
    leap(w, x, (s.y0 + s.y1) / 2, 16, false, then, 'hop', 0.6, i);
  });
}

function goVisit(w: World) {
  walkTo(w, clamp(w.cat.x + rand(-50, 50), W / 2 - 70, W / 2 + 40), WALK_BOTTOM, 34, 'errand', () => {
    setMode(w, 'look', 'beg', 4);
    w.cat.mouth = 0.5; w.sounds.push(Math.random() < 0.5 ? 'trill' : 'laowu'); burst(w, 'note', 1);
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
  if (SOLIDS.some((o) => o.perch && o.x1 - o.x0 > 40) && w.cat.perch < 0 && !w.cat.inBox) {
    opts.push([0.7 + (1 - n.rest) * 0.8, () => goPerch(w, () => (Math.random() < 0.5 ? setMode(w, 'sleep', 'sleep', rand(30, 80)) : idle(w, 'loaf')))]);
  }
  let r = Math.random() * opts.reduce((s, o) => s + o[0], 0);
  for (const [k, f] of opts) { if ((r -= k) <= 0) { f(); return; } }
  opts[0][1]();
}

const headPos = (c: Cat) => ({ x: c.x + muzzleX(c.P) * c.dir, y: c.y - c.z + c.P.hy });

function burst(w: World, kind: ParticleKind, n: number) {
  const h = headPos(w.cat);
  for (let i = 0; i < n; i++) {
    w.parts.push({ x: h.x + rand(-5, 5), y: h.y - 14 + rand(-3, 2), vx: rand(-6, 6), vy: rand(-20, -12), g: 0, life: 1.4, max: 1.4, kind });
  }
}

type Zone = { x0: number; x1: number; y0: number; y1: number };
const BOX_REACH = 28;

function boxZone(w: World): Zone | null {
  const b = w.box, c = w.cat;
  if (b.held || b.z > 1 || c.inBox || c.jump !== null) return null;
  const fp = footprint(b);
  return { x0: fp.x0 - BOX_REACH, x1: fp.x1 + BOX_REACH, y0: fp.back - 1, y1: fp.front + 2 };
}
const inZone = (z: Zone, x: number, y: number) => x > z.x0 && x < z.x1 && y > z.y0 && y < z.y1;
const onFloor = ([x, y]: number[]) => x >= WALK_LEFT && x <= WALK_RIGHT && y >= WALK_TOP && y <= WALK_BOTTOM;

function zoneExit(z: Zone, x: number, y: number) {
  const opts = [[x, z.y0 - 1], [x, z.y1 + 1], [z.x0 - 1, y], [z.x1 + 1, y]].filter(onFloor);
  if (!opts.length) return null;
  const [ex, ey] = opts.reduce((a, o) => (Math.hypot(o[0] - x, o[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? o : a));
  return { x: ex, y: ey };
}

function crosses(z: Zone, ax: number, ay: number, bx: number, by: number) {
  for (let i = 1; i <= 24; i++) if (inZone(z, ax + (bx - ax) * i / 24, ay + (by - ay) * i / 24)) return true;
  return false;
}

function steer(w: World, tx: number, ty: number) {
  const c = w.cat, z = boxZone(w);
  if (!z) return { x: tx, y: ty };
  if (inZone(z, c.x, c.y)) return zoneExit(z, c.x, c.y) ?? { x: tx, y: ty };
  if (!crosses(z, c.x, c.y, tx, ty)) return { x: tx, y: ty };
  let best: number[] | null = null, cost = Infinity;
  for (const k of [[z.x0 - 2, z.y0 - 2], [z.x1 + 2, z.y0 - 2], [z.x0 - 2, z.y1 + 2], [z.x1 + 2, z.y1 + 2]]) {
    if (!onFloor(k) || Math.hypot(k[0] - c.x, k[1] - c.y) < 1 || crosses(z, c.x, c.y, k[0], k[1])) continue;
    const d = Math.hypot(k[0] - c.x, k[1] - c.y) + Math.hypot(tx - k[0], ty - k[1]) + (crosses(z, k[0], k[1], tx, ty) ? 1e3 : 0);
    if (d < cost) { cost = d; best = k; }
  }
  return best ? { x: best[0], y: best[1] } : { x: tx, y: ty };
}

function moveToward(w: World, c: Cat, tx: number, ty: number, speed: number, dt: number) {
  if (Math.hypot(tx - c.x, ty - c.y) < 1.2) { c.moving = false; return true; }
  const g = steer(w, tx, ty);
  const dx = g.x - c.x, dy = g.y - c.y, d = Math.max(Math.hypot(dx, dy), 1e-6);
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
  c.mouth = 0.5; burst(w, 'note', 1); w.sounds.push(Math.random() < 0.35 ? 'laowu' : 'meow');
  if (!busy(c)) setMode(w, 'look', c.inBox && !w.box.tipped ? 'loaf' : 'beg', 2.5);
}

const KIB = 0.02, SCOOP = 12, POUR_RATE = 22, SCOOP_Z = 38;

export function fillBowl(w: World) {
  const s = w.scoop;
  w.sounds.push('pour');
  s.left = Math.min(s.left + SCOOP, SCOOP * 3);
  s.show = s.left / POUR_RATE + 0.4;
  const c = w.cat;
  if (!awake(c) || c.grumpy > 0 || c.mode === 'eat' || (busy(c) && c.mode !== 'beg')) return;
  if (w.needs.full < 0.95) goEat(w);
  else { c.mouth = 0.4; burst(w, 'note', 1); }
}

export function grabCat(w: World) {
  const c = w.cat;
  c.inBox = false; c.jump = null; c.perch = -1; c.follow = null; c.then = null;
  setMode(w, 'held', 'air', 99);
  c.mouth = 0.5; w.sounds.push('mew');
}

export function carryCat(w: World, x: number, y: number, z: number) {
  const c = w.cat;
  if (Math.abs(x - c.x) > 0.5) c.dir = x > c.x ? 1 : -1;
  c.x = clamp(x, WALK_LEFT, WALK_RIGHT); c.y = clamp(y, WALK_TOP, WALK_BOTTOM); c.z = z;
}

/** Lets go: the cat drops onto whatever is under it, or in front of something it can't stand on. */
export function dropCat(w: World) {
  const c = w.cat, i = solidAt(c.x, c.y), perch = i >= 0 && SOLIDS[i].perch ? i : -1;
  const y = i >= 0 && perch < 0 ? frontOf(SOLIDS[i], c.x).y : c.y;
  const fall = Math.max(0, c.z - (perch >= 0 ? SOLIDS[perch].top : 0));
  c.grumpy = Math.max(c.grumpy, 1.5);
  leap(w, c.x, y, 0, false, () => goGroom(w), 'hop', Math.max(0.15, Math.sqrt(fall / 280)), perch);
}

export function grabDish(w: World) {
  const d = w.dish;
  d.held = true; d.vx = d.vy = d.vz = 0; d.spin = 0;
}

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

export function grabBox(w: World) {
  const b = w.box, c = w.cat;
  if (c.mode === 'hop' && c.jump !== null && c.jump.into) { c.inBox = true; c.jump = null; }
  if (c.inBox) { setMode(w, 'look', 'loaf', 99); c.grumpy = Math.max(c.grumpy, 3); }
  b.held = true; b.vx = b.vy = b.vz = 0; b.spin = 0;
}

const hopFor = (vx: number, vy: number) => 40 + Math.min(60, Math.hypot(vx, vy) * 0.15);

export function flingYarn(w: World, vx: number, vy: number, vz: number) {
  const y = w.yarn;
  y.vx = clamp(vx, -300, 300); y.vy = clamp(vy, -140, 140); y.vz = vz;
}

export function grabYarn(w: World) {
  const y = w.yarn;
  if (y.inBox) { y.inBox = false; y.x = w.box.x + y.ox; }
  y.held = true; y.vx = y.vy = y.vz = 0;
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

  if (p.on && !busy(c) && !c.inBox && c.perch < 0 && awake(c) && c.grumpy <= 0 && n.rest > 0.3 && w.time > c.cool && p.energy > 110 && p.y > WALK_TOP - 10) {
    setMode(w, 'stalk', 'crouch', 10);
  }

  const zone = boxZone(w);
  if (zone && inZone(zone, c.x, c.y) && !['walk', 'hop', 'pounce', 'spook', 'swat', 'held'].includes(c.mode)) {
    const out = zoneExit(zone, c.x, c.y);
    if (out) walkTo(w, out.x, out.y, 46, 'wander', () => idle(w, restPose()));
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
      if (moveToward(w, c, c.tx, c.ty, c.speed, dt) || c.t > c.dur) { c.moving = false; c.follow = null; const f = c.then; c.then = null; f ? f() : idle(w, restPose()); }
      break;
    }
    case 'eat': {
      const mx = c.x + c.dir * 30, my = c.y + 1;
      if (c.floor) {
        if ((c.tick += dt) > 0.22) {
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
      if ((c.tick += dt) > 0.35) { c.tick = 0; w.sounds.push('crunch'); }
      n.full = Math.min(1, n.full + 0.07 * dt);
      w.bowl = Math.max(0, w.bowl - 0.05 * dt);
      if (w.bowl <= 0 || n.full >= 0.99 || c.t > c.dur) goGroom(w);
      break;
    }
    case 'beg':
      if ((c.tick += dt) > 4) { c.tick = 0; c.mouth = 0.5; burst(w, 'note', 1); w.sounds.push(Math.random() < 0.3 ? 'laowu' : Math.random() < 0.5 ? 'beg' : 'mew'); }
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
    case 'spook':
      c.z = Math.sin(Math.PI * ((c.t * 2.6) % 1)) * 3;
      c.x = clamp(c.x - c.dir * 16 * dt, WALK_LEFT, WALK_RIGHT);
      if (c.t > c.dur) {
        c.z = 0;
        walkTo(w, clamp(c.x - c.dir * 90, WALK_LEFT, WALK_RIGHT), rand(WALK_TOP, WALK_BOTTOM), 44, 'errand', () => goGroom(w));
      }
      break;
    case 'swat':
      if (c.t > c.dur) walkTo(w, c.x + (c.x < W / 2 ? 110 : -110), rand(WALK_TOP, WALK_BOTTOM), 40, 'errand', () => goGroom(w));
      break;
    case 'play': {
      const y = w.yarn, b = w.box;
      if (y.held || b.held) { c.moving = false; c.dir = y.x > c.x ? 1 : -1; if (!c.inBox) c.pose = 'crouch'; }
      else if (y.inBox && !b.tipped) {
        if (!c.inBox) { intoBox(w, () => setMode(w, 'play', 'loaf', 8)); break; }
        if ((c.tick += dt) > 0.55) {
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
        } else if (c.swipe <= 0.1) moveToward(w, c, clamp(tx - (tx > c.x ? 28 : -28), WALK_LEFT, WALK_RIGHT), clamp(ty, WALK_TOP, WALK_BOTTOM), 62, dt);
      }
      if (c.bats >= 5 || c.t > c.dur || n.rest < 0.25) goGroom(w);
      break;
    }
    case 'stalk': {
      const f = floorPointer(w);
      c.dir = f.x > c.x ? 1 : -1;
      if (!p.on || c.t > c.dur || w.time - p.moved > 3) { c.cool = w.time + 8; idle(w, 'sit'); break; }
      if (Math.hypot(f.x - c.x, f.y - c.y) < 50) { setMode(w, 'wiggle', 'crouch', rand(0.6, 1.4)); break; }
      moveToward(w, c, f.x - c.dir * 40, f.y, 20, dt);
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
        const b = w.box, s = seat(b);
        if (b.held || b.z > 1 || Math.hypot(s.x - j.x1, s.y - j.y1) > 14) j.into = false;
        else { j.x1 = s.x; j.y1 = s.y; }
      }
      c.x = j.x0 + (j.x1 - j.x0) * k; c.y = j.y0 + (j.y1 - j.y0) * k;
      c.z = j.z1 > 0 ? j.z0 + (j.z1 - j.z0) * k + Math.sin(Math.PI * k) * j.h : j.z0 * (1 - k) * (1 - k) + Math.sin(Math.PI * k) * j.h;
      if (k >= 1) {
        c.z = j.z1; c.perch = j.perch; c.jump = null;
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

  skirtBox(w, dt);
  if (c.inBox && c.mode !== 'hop') { const s = seat(w.box); c.x = s.x; c.y = s.y; c.z = w.box.z; }
  if (c.jump === null && !c.inBox && c.mode !== 'held') {
    if (c.perch >= 0) c.z = SOLIDS[c.perch].top;
    else {
      const i = solidAt(c.x, c.y);
      if (i >= 0) { const f = frontOf(SOLIDS[i], c.x); c.y = f.y; }
    }
  }

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
  stepScoop(w, dt);
  stepKibble(w, dt);
  stepYarn(w, dt);

  for (let i = w.parts.length - 1; i >= 0; i--) {
    const q = w.parts[i];
    q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
    if (q.life <= 0) w.parts.splice(i, 1);
  }
}

const QUARTER = Math.PI / 2;

function skirtBox(w: World, dt: number) {
  const c = w.cat, b = w.box;
  if (c.inBox || c.jump !== null || c.z > 0 || b.held || b.z > 1 || Math.abs(b.angle) > 0.25) return;
  const fp = footprint(b), x0 = fp.x0 - 4, x1 = fp.x1 + 4, back = fp.back - 3, front = fp.front + 2;
  if (c.x <= x0 || c.x >= x1 || c.y <= back || c.y >= front) return;
  const edge = c.y > (back + front) / 2 ? front : back;
  c.y += clamp(edge - c.y, -90 * dt, 90 * dt);
  if (c.moving) {
    const goal = c.mode === 'walk' ? c.tx : c.x, end = Math.abs(goal - x0) < Math.abs(goal - x1) ? x0 : x1;
    c.x += Math.sign(end - c.x) * 24 * dt;
  }
}

const footprint = (b: Box) => ({ x0: b.x - BOX_HALF, x1: b.x + BOX_HALF + BOX_DX, back: b.y + BOX_DY, front: b.y });

function stepBox(w: World, dt: number) {
  const b = w.box, y = w.yarn;
  b.shake = Math.max(0, b.shake - dt);
  if (b.held) { pour(w); return; }
  const bg = groundAt(b.x + 5, b.y - 4);
  const wasUp = b.z > bg || b.vz > 0;
  b.vz -= 560 * dt; b.z += b.vz * dt;
  if (b.z > bg) b.angle += b.spin * dt;
  if (b.z <= bg) {
    const impact = -b.vz;
    b.z = bg;
    if (wasUp && impact > 25) {
      const q = Math.round(b.angle / QUARTER), off = b.angle - q * QUARTER;
      w.sounds.push('thud'); b.shake = 0.35;
      if (impact > 90 && Math.abs(off) > 0.35) {
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
  if (b.z === bg && b.vz === 0) b.angle *= Math.exp(-dt * 16);
  if (b.z === bg) { b.vx *= Math.exp(-dt * 4.5); b.vy *= Math.exp(-dt * 4.5); }
  const bpx = b.x, bpy = b.y;
  b.x += b.vx * dt; b.y += b.vy * dt;
  bumpSolids(b, bpx, bpy, BOX_HALF + 5);
  if (b.y < WALK_TOP - 8) { b.y = WALK_TOP - 8; b.vy = Math.abs(b.vy) * 0.15; }
  if (b.y > WALK_BOTTOM + 6) { b.y = WALK_BOTTOM + 6; b.vy = -Math.abs(b.vy) * 0.15; }
  walls(b);

  const f = footprint(b);
  if (b.z < 6 && Math.abs(b.vx) > 1) {
    const dh = w.dish;
    if (!dh.held && dh.z < 6 && dh.x + 15 > f.x0 && dh.x - 15 < f.x1 && dh.y > f.back - 4 && dh.y - 6 < f.front + 2) {
      dh.x = b.vx > 0 ? f.x1 + 15.5 : f.x0 - 15.5;
      dh.vx = b.vx * 0.9; dh.vz = 30; dh.spin = Math.sign(b.vx) * 3;
      b.vx *= 0.35; b.shake = 0.3; w.sounds.push('clatter');
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
    hop(w, true, () => { setMode(w, 'look', 'loaf', 2.5); burst(w, 'note', 1); }).h = 4;
    c.dur = 0.25;
  } else {
    const side = c.x < b.x ? -1 : 1;
    c.dir = side; c.grumpy = Math.max(c.grumpy, 5);
    leap(w, clamp(c.x + side * 50, WALK_LEFT, WALK_RIGHT), clamp(c.y + 12, WALK_TOP, WALK_BOTTOM), 22, false, () => spook(w, b.x), 'hop', 0.45);
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
  const lean = Math.abs(Math.sin(d.angle)), wrong = Math.cos(d.angle) < 0;
  if ((lean > 0.5 || wrong) && w.bowl >= KIB) {
    d.spill += dt * (wrong ? 40 : (lean - 0.5) * 60);
    while (d.spill >= 1 && w.bowl >= KIB) { d.spill -= 1; emitSpill(w, Math.sign(Math.sin(d.angle)) || 1); }
  } else d.spill = 0;
  if (d.held) return;
  const dg = groundAt(d.x, d.y);
  const wasUp = d.z > dg || d.vz > 0;
  d.vz -= 560 * dt; d.z += d.vz * dt;
  if (d.z > dg) d.angle += d.spin * dt;
  if (d.z <= dg) {
    const impact = -d.vz;
    d.z = dg;
    if (wasUp && impact > 25) {
      w.sounds.push('clink');
      const c = w.cat;
      if (impact > 120 && Math.hypot(c.x - d.x, (c.y - d.y) * 2) < 46) spook(w, d.x);
      if (impact > 150) { const n = Math.round((w.bowl / KIB) * clamp((impact - 150) / 250, 0.1, 0.6)); for (let i = 0; i < n; i++) emitSpill(w, Math.random() < 0.5 ? -1 : 1); }
      d.vz = impact > 120 ? impact * 0.25 : 0; d.spin *= 0.3; d.vx *= 0.7;
      d.angle = Math.atan2(Math.sin(d.angle), Math.cos(d.angle));
    } else d.vz = 0;
  }
  if (d.z === dg && d.vz === 0) { d.angle *= Math.exp(-dt * 12); d.spin = 0; d.vx *= Math.exp(-dt * 6); d.vy *= Math.exp(-dt * 6); }
  const dpx = d.x, dpy = d.y;
  d.x += d.vx * dt; d.y += d.vy * dt;
  bumpSolids(d, dpx, dpy, 15);
  walls(d);
  if (d.y < WALK_TOP - 2) { d.y = WALK_TOP - 2; d.vy = Math.abs(d.vy) * 0.15; }
  if (d.y > WALK_BOTTOM + 8) { d.y = WALK_BOTTOM + 8; d.vy = -Math.abs(d.vy) * 0.15; }
}

function stepScoop(w: World, dt: number) {
  const s = w.scoop, d = w.dish;
  s.show = Math.max(0, s.show - dt);
  if (s.left <= 0) return;
  s.acc += POUR_RATE * dt;
  while (s.acc >= 1 && s.left > 0) {
    s.acc -= 1; s.left--;
    w.kibble.push({ x: d.x + 3 + rand(-1.5, 1.5), y: d.y - 1 + rand(-1.5, 1.5), z: d.z + SCOOP_Z, vx: rand(-14, 4), vy: rand(-3, 3), vz: rand(-10, 4), pour: true });
  }
  if (s.left <= 0) s.acc = 0;
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
        const side = k.x >= d.x ? 1 : -1;
        k.pour = false; k.z = rim + 2; k.vx = side * rand(25, 60); k.vy = rand(-14, 14); k.vz = rand(30, 70);
      }
    }
    const kg = groundAt(k.x, k.y);
    if (k.z <= kg) {
      k.z = kg; k.pour = false;
      if (k.vz < -40) { k.vz = -k.vz * 0.3; k.vx *= 0.6; k.vy *= 0.6; } else k.vz = 0;
    }
    if (k.z === kg) {
      k.vx *= Math.exp(-dt * 7); k.vy *= Math.exp(-dt * 7);
      if (k.vz === 0 && Math.hypot(k.vx, k.vy) < 2) { k.vx = k.vy = 0; }
      k.y = clamp(k.y, WALK_TOP, WALK_BOTTOM + 3);
    }
    k.x = clamp(k.x, WALK_LEFT, WALK_RIGHT);
  }
  if (list.length > 220) list.splice(0, list.length - 220);
}

function stepYarn(w: World, dt: number) {
  const y = w.yarn, b = w.box;
  if (y.inBox) {
    y.x = b.x + y.ox;
    y.y = b.y + BOX_DY / 2;
    y.z = b.z + (b.tipped ? 0 : 9);
    y.vx = y.vy = y.vz = 0;
  } else if (!y.held) {
    const prevZ = y.z, prevX = y.x, prevY = y.y, yg = groundAt(y.x, y.y);
    y.vz -= 420 * dt; y.z += y.vz * dt;
    if (y.z <= yg) { y.z = yg; y.vz = y.vz < -30 ? -y.vz * 0.45 : 0; }
    const f = y.z === yg ? Math.exp(-dt * 2) : 1;
    y.vx *= f; y.vy *= f;
    y.x += y.vx * dt; y.y += y.vy * dt;
    bumpSolids(y, prevX, prevY, YARN_R);
    walls(y);
    if (y.y > WALK_BOTTOM + 6) { y.y = WALK_BOTTOM + 6; y.vy = -Math.abs(y.vy) * 0.15; }
    if (y.y < WALK_TOP - 4) { y.y = WALK_TOP - 4; y.vy = Math.abs(y.vy) * 0.15; }

    const fp = footprint(b), level = Math.abs(b.angle) < 0.25 && !b.held;
    if (level && !b.tipped) {
      const rim = b.z + BOX_TALL;
      const overOpening = y.x > fp.x0 + 6 && y.x < fp.x1 - 6 && y.y > fp.back + 2 && y.y < fp.front - 2;
      if (overOpening && y.vz < 0 && prevZ >= rim && y.z < rim) {
        y.inBox = true; y.ox = clamp(y.x - b.x, -BOX_HALF + 8, BOX_HALF);
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
  if (!y.held && !y.inBox && speed > 170 && y.z < 22 && Math.abs(y.x - c.x) < 18 && Math.abs(y.y - c.y) < 8 &&
      !['play', 'stalk', 'wiggle', 'pounce'].includes(c.mode)) spook(w, y.x);
  if ((speed > 70 || y.inBox) && !y.held && awake(c) && c.grumpy <= 0 && w.needs.rest > 0.3 &&
      ['idle', 'look', 'groom'].includes(c.mode) && Math.hypot(y.x - c.x, y.y - c.y) < 130 && (!y.inBox || Math.random() < dt * 0.4)) goPlay(w);
}

export function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
