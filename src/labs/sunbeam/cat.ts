import type { Cat, World } from './world';
import { muzzleX, type Coat, type Part, type Pose, STRIDE, DUTY } from './rig';
import { clamp, hash, hex, luma, mix, noise, TAU, type Col } from './util';

const INK = hex('#2b2220');
const WHITE = hex('#ffffff');

function blend(buf: Uint32Array, i: number, c: Col, a: number) {
  const d = buf[i], da = (d >>> 24) / 255;
  if (da === 0) { buf[i] = ((Math.round(a * 255) << 24) | (c & 0xffffff)) >>> 0; return; }
  const oa = a + da * (1 - a);
  buf[i] = ((Math.round(oa * 255) << 24) | (mix(d, c, a / oa) & 0xffffff)) >>> 0;
}


// Primitives take world units and draw Q pixels per unit, clipped to a W×H world on an RW×RH target.
let W = 1, H = 1, Q = 1, RW = 1, RH = 1;

type Paint = Col | ((x: number, y: number) => Col);
const at = (p: Paint, x: number, y: number) => (typeof p === 'number' ? p : p(x, y));

function ellipse(buf: Uint32Array, cx: number, cy: number, rx: number, ry: number, p: Paint) {
  if (rx < 0.3 || ry < 0.3) return;
  cx *= Q; cy *= Q; rx *= Q; ry *= Q;
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(RH - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(RW - 1, Math.ceil(cx + rx));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry, dy2 = dy * dy;
    if (dy2 > 1) continue;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy2 <= 1) buf[y * RW + x] = at(p, x, y);
    }
  }
}

function capsule(buf: Uint32Array, ax: number, ay: number, bx: number, by: number, r: number, p: Paint) {
  ax *= Q; ay *= Q; bx *= Q; by *= Q; r *= Q;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(RW - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(RH - 1, Math.ceil(Math.max(ay, by) + r));
  const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-6, r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5 - ax, py = y + 0.5 - ay;
    const t = clamp((px * vx + py * vy) / len2, 0, 1);
    const dx = px - vx * t, dy = py - vy * t;
    if (dx * dx + dy * dy <= r2) buf[y * RW + x] = at(p, x, y);
  }
}

function taper(buf: Uint32Array, ax: number, ay: number, bx: number, by: number, ra: number, rb: number, p: Paint) {
  ax *= Q; ay *= Q; bx *= Q; by *= Q; ra *= Q; rb *= Q;
  const r = Math.max(ra, rb);
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(RW - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(RH - 1, Math.ceil(Math.max(ay, by) + r));
  const vx = bx - ax, vy = by - ay, len2 = Math.max(vx * vx + vy * vy, 1e-6);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5 - ax, py = y + 0.5 - ay;
    const t = clamp((px * vx + py * vy) / len2, 0, 1);
    const dx = px - vx * t, dy = py - vy * t, rr = ra + (rb - ra) * t;
    if (dx * dx + dy * dy <= rr * rr) buf[y * RW + x] = at(p, x, y);
  }
}

function poly(buf: Uint32Array, pts: number[], p: Paint) {
  if (Q !== 1) pts = pts.map((v) => v * Q);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
  }
  const n = pts.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; }
  const s = Math.sign(area) || 1;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(RH - 1, Math.ceil(maxY)); y++) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(RW - 1, Math.ceil(maxX)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = true;
      for (let i = 0; i < n && inside; i++) {
        const j = (i + 1) % n;
        const e = ((pts[j * 2] - pts[i * 2]) * (py - pts[i * 2 + 1]) - (pts[j * 2 + 1] - pts[i * 2 + 1]) * (px - pts[i * 2])) * s;
        if (e < 0) inside = false;
      }
      if (inside) buf[y * RW + x] = at(p, x, y);
    }
  }
}

function put(buf: Uint32Array, x: number, y: number, c: Col) {
  x = Math.floor(x) * Q; y = Math.floor(y) * Q;
  for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
    const px = x + i, py = y + j;
    if (px >= 0 && py >= 0 && px < RW && py < RH) buf[py * RW + px] = c;
  }
}

function tint(buf: Uint32Array, x: number, y: number, c: Col, a: number) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= RW || y >= RH) return;
  if (a >= 1) buf[y * RW + x] = c; else blend(buf, y * RW + x, c, a);
}

function line(buf: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: Col, a: number) {
  x0 = Math.round(x0 * Q); y0 = Math.round(y0 * Q); x1 = Math.round(x1 * Q); y1 = Math.round(y1 * Q);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 600 * Q; n++) {
    tint(buf, x0, y0, c, a);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

let MASK: Uint8Array = new Uint8Array(1);
let LINE: Uint8Array | null = null;

const drawBuffers = new Map<number, { mask: Uint8Array; ids: Uint8Array }>();

/** Draws the cat onto any target at `scale` pixels per world unit, feet at (px, py), `z` above them; outline pixels are marked in `lines`. */
export function drawCatAt(target: Uint32Array, lines: Uint8Array, width: number, height: number, w: World, px: number, py: number, scale: number, z = w.cat.z) {
  let bufs = drawBuffers.get(width * height);
  if (!bufs) { bufs = { mask: new Uint8Array(width * height), ids: new Uint8Array(width * height) }; drawBuffers.set(width * height, bufs); }
  Q = scale; RW = width; RH = height; W = Math.ceil(width / scale) + 2; H = Math.ceil(height / scale) + 2;
  MASK = bufs.mask; IDS = bufs.ids; LINE = lines;
  const c = w.cat, cx = c.x, cy = c.y, cz = c.z;
  c.x = px; c.y = py; c.z = z;
  try { drawCat(target, w); } finally {
    c.x = cx; c.y = cy; c.z = cz;
  }
}

interface Rect { x0: number; y0: number; x1: number; y1: number }
const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)), x1: Math.min(W - 1, Math.ceil(x1)), y1: Math.min(H - 1, Math.ceil(y1)),
});
const FULL = (): Rect => ({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
const grow = (r: Rect): Rect => rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1);
const drawn = (r: Rect): Rect => {
  const g = grow(r);
  return { x0: g.x0 * Q, y0: g.y0 * Q, x1: Math.min(RW - 1, g.x1 * Q + Q - 1), y1: Math.min(RH - 1, g.y1 * Q + Q - 1) };
};

function outline(layer: Uint32Array, outer: Col, r: Rect = FULL()) {
  const g = drawn(r);
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) { const i = y * RW + x; MASK[i] = layer[i] ? 1 : 0; }
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    const i = y * RW + x;
    if (MASK[i]) continue;
    if ((x > g.x0 && MASK[i - 1]) || (x < g.x1 && MASK[i + 1]) || (y > g.y0 && MASK[i - RW]) || (y < g.y1 && MASK[i + RW])) {
      layer[i] = outer;
      if (LINE) LINE[i] = 1;
    }
  }
}

function outlineParts(layer: Uint32Array, outer: Col, ids: Uint8Array, inner: Col, seamless: Set<number>, r: Rect = FULL()) {
  outline(layer, outer, r);
  const g = drawn(r);
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    const i = y * RW + x;
    if (!MASK[i] || seamless.has(ids[i])) continue;
    const a = ids[i];
    const behind = (j: number) => MASK[j] === 1 && ids[j] !== 0 && ids[j] < a;
    if ((x > 0 && behind(i - 1)) || (x < RW - 1 && behind(i + 1)) || (y > 0 && behind(i - RW)) || (y < RH - 1 && behind(i + RW))) {
      layer[i] = inner;
      if (LINE) LINE[i] = 2;
    }
  }
}

type Blob = { x: number; y: number; rx: number; ry: number };

/**
 * The torso as chest, waist and rump strung along a spine that can tilt: level when standing,
 * rear-down when sitting, front-down in a stretch. brx is the spine length.
 */
function torso(P: Pose, bx: number, by: number, bry: number) {
  const ux = Math.cos(P.tilt), uy = Math.sin(P.tilt), s = Math.abs(uy), L = P.brx;
  const blob = (k: number, drop: number, rx: number, ry: number): Blob =>
    ({ x: bx + ux * L * k - uy * drop, y: by + uy * L * k + ux * drop, rx: rx + (ry - rx) * s, ry: ry + (rx - ry) * s });
  const chest = blob(0.46, bry * 0.12, L * 0.46, bry * 1.06), waist = blob(0, -bry * (0.12 + P.arch * 0.95), L * 0.6, bry * 0.78), rump = blob(-0.5, 0, L * 0.48, bry * 0.94);
  return {
    ux, uy, chest, waist, rump,
    shoulder: { x: chest.x + 0.5, y: chest.y + chest.ry * 0.35 },
    hip: { x: rump.x + 1, y: rump.y + rump.ry * 0.45 },
    neck: { x: chest.x + chest.rx * 0.35, y: chest.y - chest.ry * 0.5 },
    tail: { x: rump.x - ux * rump.rx * 0.8, y: rump.y - uy * rump.rx * 0.8 - rump.ry * 0.35 },
  };
}

function fur(c: Coat, part: Part, lx: number, ly: number, P: Pose, seed: number): Col {
  let col = c.base;
  const mx = muzzleX(P), ux = Math.cos(P.tilt), uy = Math.sin(P.tilt);
  const along = (lx - P.bx) * ux + (ly - P.by) * uy, down = -(lx - P.bx) * uy + (ly - P.by) * ux;
  const bw = part === 'body' ? clamp((down - P.bry * 0.3) / (P.bry * 0.35), 0, 1) * clamp((P.brx * 0.36 - Math.abs(along)) / (P.brx * 0.14), 0, 1) : 0;
  const belly = bw > 0.6;
  const chest = part === 'body' && along > P.brx * 0.3 && down > -P.bry * 0.2;
  const muzzle = part === 'head' && ((lx - mx) / (3.6 + P.front)) ** 2 + ((ly - P.hy - 3) / 3) ** 2 < 1;
  const chin = part === 'head' && ly > P.hy + 4.4 && Math.abs(lx - mx) < 4;
  switch (c.kind) {
    case 'tabby': {
      if (muzzle || chin || belly) col = c.light;
      else if (bw > 0.25) col = mix(c.base, c.light, 0.5);
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

const C = { pink: hex('#e7909c'), pupil: hex('#1d1818') };
let IDS: Uint8Array = new Uint8Array(1);
const catRect = (c: Cat) => rect(c.x - 58, c.y - c.z - 66, c.x + 58, c.y - c.z + 4);

function drawCat(layer: Uint32Array, w: World) {
  layer.fill(0); IDS.fill(0); LINE?.fill(0);
  const c = w.cat, P = c.P, d = c.dir, t = w.time, cc = w.coat;
  const ax = Math.round(c.x), ay = Math.round(c.y - c.z);
  const X = (lx: number) => ax + lx * d, Y = (ly: number) => ay + ly;
  const dark = luma(cc.base) < 90;
  const outer = dark ? hex('#17141a') : mix(cc.base, INK, 0.7);
  const inner = dark ? hex('#201c23') : mix(cc.base, INK, 0.34);
  let id = 0;
  const paintAs = (me: number, part: Part, cy: number, ry: number, far: boolean) => (x: number, y: number) => {
    IDS[y * RW + x] = me;
    const lx = ((x + 0.5) / Q - ax) * d, ly = (y + 0.5) / Q - ay;
    let col = fur(cc, part, lx, ly, P, w.seed);
    const k = (ly - cy) / ry;
    if (k > (part === 'body' ? 0.85 : 0.5)) col = mix(col, INK, 0.12);
    else if (k < -0.65) col = mix(col, WHITE, 0.1);
    return far ? mix(col, INK, 0.3) : col;
  };
  const paint = (part: Part, cy: number, ry: number, far: boolean) => paintAs(++id, part, cy, ry, far);
  const blob = (b: Blob, p: Paint) => ellipse(layer, X(b.x), Y(b.y), b.rx, b.ry, p);

  const asleep = c.mode === 'sleep';
  const breath = asleep ? 1 + Math.sin(t * 1.7) * 0.05 : 1;
  const bob = c.moving ? (1 - Math.cos(2 * c.phase)) * 0.4 : 0;
  const T = torso(P, P.bx + P.wig * Math.sin(t * 24) * 2, P.by - bob, P.bry * breath);
  const f = P.front, hx = P.hx;
  const hy = P.hy - bob * 0.2 + (c.mode === 'eat' ? Math.abs(Math.sin(t * 7)) * 1.5 : 0) + (asleep ? (breath - 1) * 6 : 0);
  const mx = hx + 5.2 * (1 - f);
  const air = c.z > 1 && c.mode !== 'spook';

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
  // The near legs share the body's part id so no seam is drawn where they join it.
  const leg = (j: { x: number; y: number }, vis: number, off: number, far: boolean, front: boolean, paw: number, me: number) => {
    if (vis < 0.06 && paw < 0.06) return;
    const [gx, lift] = gait(off);
    let fx = j.x + (front ? 1.5 : -1) + (far ? (front ? -2.5 : 2.5) : 0) + gx, fy = -lift - 1.2;
    if (air) { fx = j.x + (front ? 11 : -11); fy = j.y + 7; }
    fx += (P.pawX - fx) * paw; fy += (P.pawY - fy) * paw;
    const k = Math.max(Math.min(1, vis * 2), paw), ex = j.x + (fx - j.x) * k, ey = j.y + (fy - j.y) * k;
    const pt = paintAs(me, 'leg', ey, 9, far);
    const [kx, ky] = ik(j.x, j.y, ex, ey, front ? 7.8 : 8.8, front ? 7 : 6.6, front ? -1 : 1);
    if (front) {
      taper(layer, X(j.x), Y(j.y), X(kx), Y(ky), 3.6, 2.2, pt);
      taper(layer, X(kx), Y(ky), X(ex), Y(ey), 2.1, 1.6, pt);
    } else {
      const mx2 = j.x + (kx - j.x) * 0.45 + 1.2, my2 = j.y + (ky - j.y) * 0.45;
      taper(layer, X(j.x), Y(j.y), X(mx2), Y(my2), 5.2, 3.6, pt);
      taper(layer, X(mx2), Y(my2), X(kx), Y(ky), 3.6, 1.8, pt);
      taper(layer, X(kx), Y(ky), X(ex), Y(ey), 1.8, 1.6, pt);
    }
    ellipse(layer, X(ex + 1.2), Y(ey + 0.3), 2.6, 1.5, pt);
  };
  const tail = () => {
    const agitated = c.grumpy > 0 || c.mode === 'stalk' || c.mode === 'wiggle';
    const amp = asleep || P.bristle > 0.5 ? 0.02 : agitated ? 0.16 : c.moving ? 0.07 : 0.09;
    const freq = asleep ? 0.7 : agitated ? 6 : c.moving ? 3 : 1.4;
    const N = 12, seg = 2.6;
    let a = P.tailA + amp * 0.8 * Math.sin(t * freq * 0.5 + 0.7), x = T.tail.x, y = T.tail.y;
    const pt = paint('tail', 0, 1, false);
    for (let i = 1; i <= N; i++) {
      const k0 = (i - 1) / N, k = i / N;
      a += P.tailC * (0.3 + 1.2 * k) + amp * (0.35 + k) * Math.sin(t * freq - i * 0.45);
      const nx = x - Math.cos(a) * seg, ny = Math.min(-2, y - Math.sin(a) * seg);
      const puff = 1 + P.bristle * 0.9;
      taper(layer, X(x), Y(y), X(nx), Y(ny), (2.7 - 1.3 * k0) * puff, (2.7 - 1.3 * k) * puff, pt);
      x = nx; y = ny;
    }
  };
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

  leg(T.hip, P.legB, 0.5, true, false, 0, ++id);
  leg(T.shoulder, P.legF, 0.75, true, true, 0, ++id);
  if (P.tf < 0.5) tail();
  ear(1); ear(-1);
  const bodyId = ++id;
  leg(T.hip, P.legB, 0, false, false, 0, bodyId);
  const pawUp = P.paw > 0.3;
  if (!pawUp) leg(T.shoulder, P.legF, 0.25, false, true, P.paw, bodyId);
  const body = paintAs(bodyId, 'body', T.waist.y, P.bry, false);
  blob(T.rump, body); blob(T.waist, body); blob(T.chest, body);
  if (P.bristle > 0.05) {
    const blobs = [T.rump, T.waist, T.chest];
    const top = (lx: number) => blobs.reduce((m, b) => {
      const u = (lx - b.x) / b.rx;
      return Math.abs(u) < 1 ? Math.min(m, b.y - b.ry * Math.sqrt(1 - u * u)) : m;
    }, Infinity);
    for (let lx = T.rump.x - T.rump.rx * 0.55, i = 0; lx < T.chest.x + T.chest.rx * 0.25; lx += 2.4, i++) {
      const ty = top(lx);
      if (ty === Infinity) continue;
      const h = P.bristle * (2.4 + 1.8 * hash(i, 9, 0));
      poly(layer, [X(lx - 1.5), Y(ty + 1.6), X(lx + 1.5), Y(ty + 1.6), X(lx - 0.9), Y(ty - h)], body);
    }
  }
  if (P.haunch > 0.05) {
    ellipse(layer, X(T.rump.x - 0.5), Y(T.rump.y + 0.5), 8.5 * P.haunch, 7.5 * P.haunch, paint('haunch', T.rump.y, 8, false));
    ellipse(layer, X(T.rump.x + 7), Y(-2), 6 * P.haunch, 2 * P.haunch, paint('leg', -2, 3, false));
  }
  const neckId = id + 1;
  capsule(layer, X(T.neck.x), Y(T.neck.y), X(hx - 2.5 + f), Y(hy + 3.2), 4.6, paint('body', T.waist.y, P.bry, false));
  if (pawUp) leg(T.shoulder, P.legF, 0.25, false, true, P.paw, ++id);
  if (P.legF < 0.2 && P.haunch < 0.5 && !asleep) ellipse(layer, X(T.chest.x + T.chest.rx * 0.55), Y(-1.8), 3.2, 1.7, paint('leg', -1.8, 2, false));
  const head = paint('head', hy + 1, 7, false);
  ellipse(layer, X(hx), Y(hy), 6.4, 5.8, head);
  ellipse(layer, X(hx + 1.6 * (1 - f)), Y(hy + 2.8), 5.4 + f, 3.9, head);
  ellipse(layer, X(mx), Y(hy + 2.6), 2.9 + 0.8 * f, 2.5, head);
  if (P.tf >= 0.5) tail();

  outlineParts(layer, outer, IDS, inner, new Set([neckId]), catRect(c));

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
