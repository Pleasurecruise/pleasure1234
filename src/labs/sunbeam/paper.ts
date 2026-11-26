import { hash, noise } from './util';

type RGB = [number, number, number];
export type Pt = [number, number];

const PAPER: RGB = [247, 241, 230];
const INK: RGB = [46, 37, 35];
const SUN: RGB = [255, 214, 140];
const SHADE: RGB = [120, 100, 92];
export const BOILS = 3;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export interface Sheet {
  w: number; h: number; q: number;
  fill: Uint32Array;
  /** 1 cat pen line, 2 faint pencil, 3 room pen line. */
  line: Uint8Array;
  room: Uint8Array;
  pool: Float32Array;
  tones: [RGB, number][];
  sun: Float32Array;
  shade: Float32Array;
}

export function sheet(w: number, h: number, q: number): Sheet {
  const n = w * h;
  return {
    w, h, q, fill: new Uint32Array(n), line: new Uint8Array(n), room: new Uint8Array(n), pool: new Float32Array(n),
    tones: [[PAPER, 0]], sun: new Float32Array(n), shade: new Float32Array(n),
  };
}

interface Grain { fibre: Float32Array; gran: Float32Array[]; washX: Int8Array[]; washY: Int8Array[]; lineX: Int8Array[]; lineY: Int8Array[]; thick: Uint8Array; speck: Float32Array }

export function grain(w: number, h: number, q: number): Grain {
  const n = w * h, g: Grain = { fibre: new Float32Array(n), gran: [], washX: [], washY: [], lineX: [], lineY: [], thick: new Uint8Array(n), speck: new Float32Array(n) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    g.fibre[i] = 0.975 + 0.025 * noise(x / 2.2, y / 11, 1) + (hash(x, y, 5) - 0.5) * 0.02;
    g.thick[i] = noise(x / 22, y / 22, 23) > 0.42 ? 1 : 0;
    g.speck[i] = 0.8 + 0.2 * hash(x, y, 29);
  }
  for (let b = 0; b < BOILS; b++) {
    const gr = new Float32Array(n), wx = new Int8Array(n), wy = new Int8Array(n), lx = new Int8Array(n), ly = new Int8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gr[i] = 0.9 + 0.16 * noise(x / 1.6, y / 1.6, 7 + b);
      wx[i] = Math.round((noise(x / 14, y / 14, 11 + b) - 0.5) * q * 0.8);
      wy[i] = Math.round((noise(x / 14, y / 14, 13 + b) - 0.5) * q * 0.8);
      lx[i] = Math.round((noise(x / 10, y / 10, 17 + b) - 0.5) * q * 0.7);
      ly[i] = Math.round((noise(x / 10, y / 10, 19 + b) - 0.5) * q * 0.7);
    }
    g.gran.push(gr); g.washX.push(wx); g.washY.push(wy); g.lineX.push(lx); g.lineY.push(ly);
  }
  return g;
}

function blur(w: number, h: number, r: number, on: (i: number) => number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x < w; x++) {
      if (x + r < w) acc += on(y * w + x + r);
      if (x - r - 1 >= 0) acc -= on(y * w + x - r - 1);
      if (x >= 0) tmp[y * w + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y < h; y++) {
      if (y + r < h) acc += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * w + x];
      if (y >= 0) out[y * w + x] = acc / ((2 * r + 1) * (2 * r + 1));
    }
  }
  return out;
}

function pooling(s: Sheet) {
  const { w, h, room } = s, edge = new Uint8Array(room.length);
  for (let i = w; i < room.length - w; i++) {
    const p = room[i];
    if (p && (room[i - 1] !== p || room[i + 1] !== p || room[i - w] !== p || room[i + w] !== p)) edge[i] = 1;
  }
  s.pool = blur(w, h, Math.round(s.q * 1.5), (i) => edge[i]);
}

export function paint(s: Sheet, g: Grain, img: ImageData, boil: number) {
  pooling(s);
  const { w, h, q } = s, data = img.data;
  const cov = blur(w, h, Math.round(q * 1.4), (i) => (s.fill[i] ? 1 : 0));
  const off = Math.round(q * 0.6), offY = Math.round(off / 2);
  const gran = g.gran[boil], wX = g.washX[boil], wY = g.washY[boil], lX = g.lineX[boil], lY = g.lineY[boil];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i0 = y * w + x, o = i0 * 4, gr = gran[i0];
    let r = PAPER[0] * g.fibre[i0], gg = PAPER[1] * g.fibre[i0], b = PAPER[2] * g.fibre[i0];
    const mul = (c: RGB, k: number) => { r *= 1 - k * (1 - c[0] / 255); gg *= 1 - k * (1 - c[1] / 255); b *= 1 - k * (1 - c[2] / 255); };

    const part = s.room[i0];
    if (part) { const [col, a] = s.tones[part]; mul(col, a * gr * (1 + clamp01(s.pool[i0] * 2.5) * 0.45)); }
    if (s.sun[i0] > 0) mul(SUN, s.sun[i0] * 0.6 * gr);
    if (s.shade[i0] > 0) mul(SHADE, s.shade[i0] * 0.24 * gr);

    const wx = x - off + wX[i0], wy = y - offY + wY[i0];
    if (wx >= 0 && wy >= 0 && wx < w && wy < h) {
      const f = s.fill[wy * w + wx];
      if (f) {
        const dark = 1 - clamp01((1 - cov[wy * w + wx]) * 2.2) * 0.28;
        const fr = (f & 255) * 0.86 + PAPER[0] * 0.14, fg = ((f >> 8) & 255) * 0.86 + PAPER[1] * 0.14, fb = ((f >> 16) & 255) * 0.86 + PAPER[2] * 0.14;
        mul([fr * dark, fg * dark, fb * dark], 0.94 * gr);
      }
    }

    const still = s.line[i0];
    let ink = still === 2 ? 0.22 : still === 3 ? 0.5 : 0;
    const lx = x + lX[i0], ly = y + lY[i0];
    if (!ink && lx > 0 && ly > 0 && lx < w - 1 && ly < h - 1) {
      const i = ly * w + lx;
      if (s.line[i] === 1) ink = 1;
      else if (g.thick[i0] && (s.line[i - 1] === 1 || s.line[i + 1] === 1 || s.line[i - w] === 1 || s.line[i + w] === 1)) ink = 0.75;
    }
    if (ink > 0) {
      const a = ink * g.speck[i0];
      r += (INK[0] - r) * a; gg += (INK[1] - gg) * a; b += (INK[2] - b) * a;
    }
    data[o] = r; data[o + 1] = gg; data[o + 2] = b; data[o + 3] = 255;
  }
}

export function tone(s: Sheet, hexCol: string, a: number) {
  s.tones.push([hex(hexCol), a]);
  return s.tones.length - 1;
}

export function face(s: Sheet, pts: Pt[], part: number, edge = true) {
  const { q, w, h } = s;
  const xs = pts.map((p) => p[0] * q), ys = pts.map((p) => p[1] * q);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(h, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(w, Math.ceil(Math.max(...xs))); x++) {
      let inside = false;
      for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
        if ((ys[i] > y + 0.5) !== (ys[j] > y + 0.5) && x + 0.5 < ((xs[j] - xs[i]) * (y + 0.5 - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
      }
      if (inside) { const i = y * w + x; s.room[i] = part; s.line[i] = 0; s.fill[i] = 0; }
    }
  }
  if (edge) for (let i = 0; i < pts.length; i++) stroke(s, pts[i], pts[(i + 1) % pts.length], 3);
}

export function stroke(s: Sheet, a: Pt, b: Pt, kind: 2 | 3, only = 0) {
  const { q, w, h } = s;
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * q * 1.5);
  const r = kind === 3 ? q * 0.3 : q * 0.2;
  for (let k = 0; k <= n; k++) {
    const t = k / n, cx = (a[0] + (b[0] - a[0]) * t) * q, cy = (a[1] + (b[1] - a[1]) * t) * q;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * w + x;
      if (only && s.room[i] !== only) continue;
      if (kind === 3 || !s.line[i]) s.line[i] = kind;
    }
  }
}

export function shadow(s: Sheet, [cx, cy]: Pt, rx: number, ry: number) {
  const { q } = s;
  for (let y = Math.floor((cy - ry) * q); y <= Math.ceil((cy + ry) * q); y++) for (let x = Math.floor((cx - rx) * q); x <= Math.ceil((cx + rx) * q); x++) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    const d = ((x / q - cx) / rx) ** 2 + ((y / q - cy) / ry) ** 2;
    if (d < 1) s.shade[y * s.w + x] = Math.max(s.shade[y * s.w + x], (1 - d) * 0.9);
  }
}

export function inPoly(px: number, py: number, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > py) !== (pts[j][1] > py) && px < ((pts[j][0] - pts[i][0]) * (py - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  }
  return inside;
}

export function inHull(px: number, py: number, pts: Pt[]) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => list.reduce<Pt[]>((h, p) => { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); return h; }, []);
  const lower = half(sorted), upper = half([...sorted].reverse());
  return inPoly(px, py, [...lower.slice(0, -1), ...upper.slice(0, -1)]);
}
