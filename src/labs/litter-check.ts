import { context2d } from '../lib/dom';

const UNIT_W = 150;
const UNIT_H = 135;
const S = 2;
const W = UNIT_W * S;
const H = UNIT_H * S;

const TEX = 256;
const INK = 0xff474747;
const PAPER = 0xfff4f4f4;
const BIN_INK = 0xffbdbdbd;
const BIN_PAPER = 0xffdedede;
const RAKE = 9;
const PUSH = 0.7;
const SETTLE = 2.2;

const BIN = { top: 84, bottom: 124, topL: 57, topR: 93, botL: 60, botR: 90 };

type Blob = { dx: number; dy: number; r: number };

interface Clump {
  x: number; y: number;
  homeX: number; homeY: number;
  blobs: Blob[];
  mask: Uint8Array;
  seed: number;
  state: 'litter' | 'drag' | 'return' | 'falling' | 'binned';
  vy: number; targetY: number;
}

const RP = 19 * S;
const SIDE = RP * 2 + 1;

function inLitter(x: number, y: number) {
  if (x >= 19 && x < 131 && y >= 9 && y < 48) {
    const rx = x < 23 ? 23 - x : x > 127 ? x - 127 : 0;
    const ry = y < 13 ? 13 - y : 0;
    return rx * rx + ry * ry <= 16;
  }
  if (y >= 48) return ((x - 75) / 24) ** 2 + ((y - 48) / 13) ** 2 <= 1;
  return false;
}

function inBin(x: number, y: number) {
  if (y < BIN.top + 2 || y > BIN.bottom - 2) return false;
  const t = (y - BIN.top) / (BIN.bottom - BIN.top);
  const l = BIN.topL + (BIN.botL - BIN.topL) * t + 1.5;
  const r = BIN.topR + (BIN.botR - BIN.topR) * t - 1.5;
  return x >= l && x <= r;
}

const litterMask = new Uint8Array(W * H);
const binMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  litterMask[y * W + x] = inLitter((x + 0.5) / S, (y + 0.5) / S) ? 1 : 0;
  binMask[y * W + x] = inBin((x + 0.5) / S, (y + 0.5) / S) ? 1 : 0;
}

function makeTexture() {
  const raw = Float32Array.from({ length: TEX * TEX }, () => Math.random());
  const v = new Float32Array(TEX * TEX);
  const m = TEX - 1;
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    let sum = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) sum += raw[((y + j) & m) * TEX + ((x + i) & m)];
    v[y * TEX + x] = raw[y * TEX + x] * 0.5 + (sum / 8) * 0.5;
  }
  const cut = Float32Array.from(v).sort()[Math.floor(v.length * 0.45)];
  return Uint8Array.from(v, (n) => (n < cut ? 1 : 0));
}

function field(blobs: Blob[], lx: number, ly: number) {
  let d = Infinity;
  for (const b of blobs) {
    const e = Math.hypot(lx - b.dx, ly - b.dy) - b.r;
    const h = Math.max(0, Math.min(1, 0.5 + (e - d) / 3));
    d = d === Infinity ? e : e * (1 - h) + d * h - 1.5 * h * (1 - h);
  }
  return d;
}

function log(): Blob[] {
  const out: Blob[] = [];
  const len = 16 + Math.random() * 14;
  const bend = (Math.random() - 0.5) * 0.25;
  const thick = 3.2 + Math.random() * 1.4;
  let a = Math.random() * Math.PI * 2, x = 0, y = 0;
  for (let t = 0; t <= len; t += 1.4) {
    const k = t / len;
    const taper = Math.min(1, k * 4, (1 - k) * 3 + 0.25);
    out.push({ dx: x, dy: y, r: thick * (0.55 + 0.45 * taper) * (0.9 + Math.random() * 0.2) });
    a += bend + (Math.random() - 0.5) * 0.18;
    x += Math.cos(a) * 1.4;
    y += Math.sin(a) * 1.4 * 0.75;
  }
  return out;
}

function nuggets(): Blob[] {
  let x = 0, y = 0;
  return Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => {
    const b = { dx: x, dy: y, r: 2.8 + Math.random() * 1.8 };
    const a = Math.random() * Math.PI * 2;
    x += Math.cos(a) * (5 + Math.random() * 2);
    y += Math.sin(a) * (4 + Math.random() * 2);
    return b;
  });
}

function lump(): Blob[] {
  return Array.from({ length: 4 + Math.floor(Math.random() * 4) }, (_, i) => ({
    dx: i === 0 ? 0 : (Math.random() - 0.5) * 16,
    dy: i === 0 ? 0 : (Math.random() - 0.5) * 10,
    r: 2.6 + Math.random() * 3.6,
  }));
}

function makeClump(x: number, y: number): Clump {
  const kind = Math.random();
  const blobs = kind < 0.45 ? log() : kind < 0.7 ? nuggets() : lump();
  const mx = blobs.reduce((s, b) => s + b.dx, 0) / blobs.length;
  const my = blobs.reduce((s, b) => s + b.dy, 0) / blobs.length;
  for (const b of blobs) { b.dx -= mx; b.dy -= my; }

  const grain = Float32Array.from({ length: 36 }, () => Math.random() - 0.5);
  const rough = (i: number, j: number) => {
    const u = (i / SIDE) * 5, v = (j / SIDE) * 5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const g = (a: number, b: number) => grain[b * 6 + a];
    return (g(iu, iv) * (1 - fu) + g(iu + 1, iv) * fu) * (1 - fv) + (g(iu, iv + 1) * (1 - fu) + g(iu + 1, iv + 1) * fu) * fv;
  };
  const mask = new Uint8Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    mask[j * SIDE + i] = field(blobs, (i - RP) / S, (j - RP) / S) <= rough(i, j) * 2.2 + (Math.random() - 0.5) * 0.4 ? 1 : 0;
  }
  return { x, y, homeX: x, homeY: y, blobs, mask, seed: Math.floor(Math.random() * TEX), state: 'litter', vy: 0, targetY: 0 };
}

function eachPixel(c: Clump, fn: (px: number, py: number, i: number, j: number) => boolean | void) {
  const cx = Math.round(c.x * S), cy = Math.round(c.y * S);
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    if (c.mask[j * SIDE + i] && fn(cx + i - RP, cy + j - RP, i, j) === false) return false;
  }
  return true;
}

const fitsLitter = (c: Clump) =>
  eachPixel(c, (px, py) => px >= 0 && py >= 0 && px < W && py < H && litterMask[py * W + px] === 1);

const overlaps = (a: Clump, b: Clump) =>
  !eachPixel(a, (px, py, i, j) => (i + j) % 2 === 1 || field(b.blobs, px / S - b.x, py / S - b.y) > 1.5);

export interface LitterCheck {
  reset(): void;
  remaining(): number;
  removeOne(): void;
}

export function mountLitterCheck(
  cv: HTMLCanvasElement,
  onProgress: (removed: number, total: number) => void,
): LitterCheck {
  cv.width = W;
  cv.height = H;
  const ctx = context2d(cv, {});
  const image = ctx.createImageData(W, H);
  const buf = new Uint32Array(image.data.buffer);

  const litterTex = makeTexture();
  const clumpTex = makeTexture();
  const offX = new Float32Array(W * H);
  const offY = new Float32Array(W * H);

  let clumps: Clump[] = [];
  let binned = 0;

  function reset() {
    clumps = [];
    binned = 0;
    offX.fill(0);
    offY.fill(0);
    const want = 3 + Math.floor(Math.random() * 2);
    for (let tries = 0; tries < 300 && clumps.length < want; tries++) {
      const c = makeClump(24 + Math.random() * 102, 14 + Math.random() * 42);
      if (fitsLitter(c) && !clumps.some((o) => overlaps(c, o))) clumps.push(c);
    }
    onProgress(0, clumps.length);
  }

  function binClump(c: Clump) {
    c.state = 'falling';
    c.vy = 0;
    c.x = BIN.topL + 18 + (Math.random() - 0.5) * 6;
    c.targetY = BIN.bottom - 12 - binned * 5;
    binned++;
    onProgress(binned, clumps.length);
  }

  function rake(x: number, y: number, dx: number, dy: number) {
    const r = RAKE * S, px = x * S, py = y * S;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(W - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(H - 1, Math.ceil(py + r));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const i = gy * W + gx;
      if (!litterMask[i]) continue;
      const d = Math.hypot(gx + 0.5 - px, gy + 0.5 - py) / r;
      if (d >= 1) continue;
      const w = (1 - d) * (1 - d) * PUSH * S;
      offX[i] += dx * w;
      offY[i] += dy * w;
    }
  }

  let drag: { c: Clump; ox: number; oy: number; id: number } | null = null;
  const lastAt = new Map<number, { x: number; y: number }>();

  const toUnits = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * UNIT_W, y: ((e.clientY - r.top) / r.height) * UNIT_H };
  };
  const clumpAt = (x: number, y: number) => {
    for (let i = clumps.length - 1; i >= 0; i--) {
      const c = clumps[i];
      if ((c.state === 'litter' || c.state === 'return') && field(c.blobs, x - c.x, y - c.y) <= 2) return c;
    }
    return null;
  };
  const overBin = (x: number, y: number) => x >= BIN.topL - 6 && x <= BIN.topR + 6 && y >= BIN.top - 10 && y <= BIN.bottom;

  cv.addEventListener('pointerdown', (e) => {
    const p = toUnits(e);
    lastAt.set(e.pointerId, p);
    cv.setPointerCapture(e.pointerId);
    const c = clumpAt(p.x, p.y);
    if (!c) return;
    e.preventDefault();
    c.state = 'drag';
    clumps.splice(clumps.indexOf(c), 1);
    clumps.push(c);
    drag = { c, ox: c.x - p.x, oy: c.y - p.y, id: e.pointerId };
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    const p = toUnits(e);
    if (drag && e.pointerId === drag.id) {
      drag.c.x = p.x + drag.ox;
      drag.c.y = p.y + drag.oy;
      return;
    }
    const prev = lastAt.get(e.pointerId);
    lastAt.set(e.pointerId, p);
    if (prev && (e.pointerType === 'mouse' || e.buttons)) rake(p.x, p.y, p.x - prev.x, p.y - prev.y);
    cv.style.cursor = clumpAt(p.x, p.y) ? 'grab' : 'default';
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') lastAt.delete(e.pointerId);
    if (!drag || e.pointerId !== drag.id) return;
    const { c } = drag, p = toUnits(e);
    drag = null;
    cv.style.cursor = 'default';
    if (overBin(p.x, p.y)) binClump(c);
    else if (e.type === 'pointerup' && fitsLitter(c) && !clumps.some((o) => o !== c && o.state === 'litter' && overlaps(c, o))) {
      c.state = 'litter';
      c.homeX = c.x;
      c.homeY = c.y;
    } else c.state = 'return';
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  cv.addEventListener('pointerleave', (e) => lastAt.delete(e.pointerId));

  function stamp(c: Clump, ink: number, paper: number, clip: Uint8Array | null) {
    eachPixel(c, (px, py, i, j) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const k = py * W + px;
      if (clip && !clip[k]) return;
      buf[k] = clumpTex[(j & (TEX - 1)) * TEX + ((i + c.seed) & (TEX - 1))] ? ink : paper;
    });
  }

  let last = performance.now() / 1000;
  function frame(ms: number) {
    const now = ms / 1000, dt = Math.min(0.05, now - last);
    last = now;
    const settle = Math.exp(-dt * SETTLE);

    for (const c of clumps) {
      if (c.state === 'return') {
        const k = 1 - Math.exp(-dt * 12);
        c.x += (c.homeX - c.x) * k;
        c.y += (c.homeY - c.y) * k;
        if (Math.hypot(c.homeX - c.x, c.homeY - c.y) < 0.3) { c.x = c.homeX; c.y = c.homeY; c.state = 'litter'; }
      } else if (c.state === 'falling') {
        c.vy += 220 * dt;
        c.y += c.vy * dt;
        if (c.y >= c.targetY) { c.y = c.targetY; c.state = 'binned'; }
      }
    }

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!litterMask[i]) { buf[i] = 0; continue; }
      offX[i] *= settle;
      offY[i] *= settle;
      const sx = (x - Math.round(offX[i])) & (TEX - 1), sy = (y - Math.round(offY[i])) & (TEX - 1);
      buf[i] = litterTex[sy * TEX + sx] ? INK : PAPER;
    }
    for (const c of clumps) if (c.state === 'binned') stamp(c, BIN_INK, BIN_PAPER, binMask);
    for (const c of clumps) if (c.state === 'litter') stamp(c, INK, PAPER, litterMask);
    for (const c of clumps) if (c.state === 'drag' || c.state === 'return' || c.state === 'falling') stamp(c, INK, PAPER, null);

    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);

  return {
    reset,
    remaining: () => clumps.filter((c) => c.state === 'litter' || c.state === 'drag' || c.state === 'return').length,
    removeOne() {
      const c = clumps.find((o) => o.state === 'litter');
      if (c) binClump(c);
    },
  };
}
