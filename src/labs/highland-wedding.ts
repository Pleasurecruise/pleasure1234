// The photo is downscaled, then every frame is re-quantised to a palette with ordered
// dithering, so the effects drawn on top (mist, wind over the grass, ripples, a veil)
// come out in the same pixel language as the picture. Regions are found by colour:
// grey-blue water between the far shore and the meadow, yellow-green grass below it,
// bright low-saturation sky and mist above.
import { context2d } from '../lib/dom';

const TAU = Math.PI * 2;
const PALETTE = 24;
const SPREAD = 9;    // light dither: flat patches, stippled only where two shades meet
const DAMP = 0.986;
const SIM_K = 3;     // sim rows per water row: ripples read as 3:1 ellipses this far away

const hash = (i: number, s: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const bay = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)];

function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const l = (i: number, j: number) => hash(i * 374761 + j * 668265, seed);
  const a = l(xi, yi), b = l(xi + 1, yi), c = l(xi, yi + 1), d = l(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Small deterministic k-means; returns a flat [r,g,b,...] palette. */
function buildPalette(r: Uint8Array, g: Uint8Array, b: Uint8Array, k: number) {
  const n = r.length, idx: number[] = [];
  for (let i = 0; i < n; i += 3) idx.push(i);
  idx.sort((p, q) => (r[p] + g[p] + b[p]) - (r[q] + g[q] + b[q]));
  const cr = new Float64Array(k), cg = new Float64Array(k), cb = new Float64Array(k);
  for (let j = 0; j < k; j++) { const i = idx[Math.floor(((j + 0.5) / k) * idx.length)]; cr[j] = r[i]; cg[j] = g[i]; cb[j] = b[i]; }
  const sr = new Float64Array(k), sg = new Float64Array(k), sb = new Float64Array(k), cnt = new Float64Array(k);
  for (let it = 0; it < 10; it++) {
    sr.fill(0); sg.fill(0); sb.fill(0); cnt.fill(0);
    for (const i of idx) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = (r[i] - cr[j]) ** 2 + (g[i] - cg[j]) ** 2 + (b[i] - cb[j]) ** 2; if (d < bd) { bd = d; best = j; } }
      sr[best] += r[i]; sg[best] += g[i]; sb[best] += b[i]; cnt[best]++;
    }
    for (let j = 0; j < k; j++) if (cnt[j]) { cr[j] = sr[j] / cnt[j]; cg[j] = sg[j] / cnt[j]; cb[j] = sb[j] / cnt[j]; }
  }
  const out: number[] = [];
  for (let j = 0; j < k; j++) out.push(Math.round(cr[j]), Math.round(cg[j]), Math.round(cb[j]));
  // a few hand-picked colours the effects need even if the photo is short of them
  out.push(236, 237, 240, 214, 218, 222, 168, 160, 92);
  return out;
}

export interface Glen {
  W: number; H: number; buf: Uint32Array; waterLine: number;
  frame(dt: number, t: number): void;
  isWater(x: number, y: number): boolean;
  poke(x: number, y: number): void;
  blow(x: number, vx: number): void;
  stir(x: number, y: number, speed: number): void;
  gust(dir: number): void;
  breeze: number;
}

export function createGlen(photo: Uint8ClampedArray, W: number, H: number): Glen {
  const N = W * H;
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let i = 0; i < N; i++) { R[i] = photo[i * 4]; G[i] = photo[i * 4 + 1]; B[i] = photo[i * 4 + 2]; }

  const pal = buildPalette(R, G, B, PALETTE), np = pal.length / 3;
  const palU32 = new Uint32Array(np);
  for (let j = 0; j < np; j++) palU32[j] = ((255 << 24) | (pal[j * 3 + 2] << 16) | (pal[j * 3 + 1] << 8) | pal[j * 3]) >>> 0;
  const lut = new Uint8Array(32 * 32 * 32);
  for (let ri = 0; ri < 32; ri++) for (let gi = 0; gi < 32; gi++) for (let bi = 0; bi < 32; bi++) {
    const rr = ri * 8 + 4, gg = gi * 8 + 4, bb = bi * 8 + 4;
    let best = 0, bd = Infinity;
    for (let j = 0; j < np; j++) {
      const dr = rr - pal[j * 3], dg = gg - pal[j * 3 + 1], db = bb - pal[j * 3 + 2];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; best = j; }
    }
    lut[(ri << 10) | (gi << 5) | bi] = best;
  }

  const lum = (i: number) => 0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i];
  const greenish = (i: number) => G[i] - B[i] > 26;
  const bluish = (i: number) => B[i] >= R[i] - 2 && G[i] - B[i] < 12 && lum(i) > 90;
  const y0 = Math.floor(H * 0.62), y1 = Math.floor(H * 0.84);
  const wTop = new Int16Array(W).fill(-1), wBot = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    let y = y0;
    while (y < y1 && !(bluish(y * W + x) && bluish((y + 1) * W + x))) y++;
    if (y >= y1) continue;
    let e = y + 2;
    while (e < y1 + 6 && !(greenish(e * W + x) && greenish((e + 1) * W + x))) e++;
    wTop[x] = y; wBot[x] = e;
  }
  // columns with no clear water borrow from their neighbours, so the shoreline has no holes
  for (let pass = 0; pass < 2; pass++) for (let x = 1; x < W - 1; x++) {
    if (wTop[x] >= 0) continue;
    const l = wTop[x - 1] >= 0 ? x - 1 : -1, r = wTop[x + 1] >= 0 ? x + 1 : -1, s = l >= 0 ? l : r;
    if (s >= 0 && (pass === 1 || (l >= 0 && r >= 0))) { wTop[x] = wTop[s]; wBot[x] = wBot[s]; }
  }
  const water = new Uint8Array(N), meadow = new Uint8Array(N);
  let top = H, bot = 0;
  for (let x = 0; x < W; x++) {
    if (wTop[x] < 0) continue;
    for (let y = wTop[x]; y < wBot[x]; y++) water[y * W + x] = 1;
    top = Math.min(top, wTop[x]); bot = Math.max(bot, wBot[x]);
  }
  for (let x = 0; x < W; x++) {
    const start = wBot[x] >= 0 ? wBot[x] : Math.floor(H * 0.75);
    for (let y = start; y < H; y++) if (greenish(y * W + x) || y > start + 2) meadow[y * W + x] = 1;
  }
  const meadowTop = Math.floor(H * 0.72);
  const skyW = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0, sat = Math.max(R[i], G[i], B[i]) - Math.min(R[i], G[i], B[i]);
    if (y < top) skyW[i] = clamp((lum(i) - 150) / 45, 0, 1) * clamp(1 - sat / 30, 0, 1);
  }
  const fogRow = new Float32Array(H);
  for (let y = 0; y < H; y++) fogRow[y] = clamp((y - H * 0.06) / (H * 0.15), 0, 1) * clamp((top - 4 - y) / (H * 0.12), 0, 1);

  // the couple: the brightest small white shape standing on the meadow near the water
  let veil: { x: number; y: number } | null = null;
  {
    let best = 0;
    for (let y = top; y < Math.min(H, bot + 14); y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (water[i] || lum(i) < 200) continue;
      const sat = Math.max(R[i], G[i], B[i]) - Math.min(R[i], G[i], B[i]);
      if (sat > 30) continue;
      let n = 0;
      for (let dy = 0; dy < 6; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * W + x + dx; if (j < N && lum(j) > 180) n++; }
      if (n > best) { best = n; veil = { x, y }; }
    }
    if (best < 5) veil = null;
  }

  const OR = new Float32Array(N), OG = new Float32Array(N), OB = new Float32Array(N);
  const buf = new Uint32Array(N);
  // gustF: gusts travelling downwind. push: where the pointer is asking for wind; gusts ramp up
  // toward it instead of jumping. wind: what everything reads, low-passed so nothing snaps.
  const gustF = new Float32Array(W), gtmp = new Float32Array(W), push = new Float32Array(W), wind = new Float32Array(W);
  const SH = Math.max(4, (bot - top) * SIM_K + 2);
  let wa = new Float32Array(W * SH), wb = new Float32Array(W * SH);
  let meanWind = 0, fogX = 0, grassX = 0, simAcc = 0, petalAcc = 0, chaffAcc = 0, rainAcc = 0;
  // drizzle: z is depth (0 far, 1 near). Near drops fall faster, streak longer and land lower.
  interface Drop { x: number; y: number; z: number; land: number; vx: number }
  interface Splash { x: number; y: number; age: number }
  interface Ring { x: number; y: number; age: number; life: number; size: number }
  const rings: Ring[] = [];
  // where a gust has shoved the mist sideways; it eases back on its own
  const fogShift = new Float32Array(W);
  const drops: Drop[] = [], splashes: Splash[] = [];
  const DRIZZLE = 150; // drops per second
  interface Bit { x: number; y: number; vx: number; vy: number; r: number; g: number; b: number; age: number; life: number; ph: number; big: boolean }
  const bits: Bit[] = [];
  const PETALS = [[244, 240, 236], [240, 214, 222], [250, 232, 200]];
  const meadowRows: number[] = [];
  for (let y = meadowTop; y < H; y++) meadowRows.push(y);
  // Individual blades over the meadow, near ones tall, far ones a pixel or two. Generated in
  // row order so nearer blades draw over farther ones.
  interface Blade { x: number; y: number; h: number; r: number; g: number; b: number; ph: number }
  const blades: Blade[] = [];
  for (let y = meadowTop; y < H; y++) {
    const near = clamp((y - meadowTop) / (H - meadowTop), 0, 1);
    const per = 2 + near * 7;
    for (let k = 0; k < per; k++) {
      const x = Math.floor(hash(y * 131 + k, 41) * W), i = y * W + x;
      if (!meadow[i]) continue;
      const lighter = hash(i, 42) < 0.6, v = lighter ? 1.16 : 0.88, add = lighter ? 10 : 0;
      blades.push({
        x, y, h: 1 + Math.round(near * 5 + hash(i, 43) * (1 + near * 3)),
        r: R[i] * v + add, g: G[i] * v + add, b: B[i] * v, ph: hash(i, 44) * TAU,
      });
    }
  }
  function petal(x: number, y: number, kick: number) {
    const [r, g, b] = PETALS[Math.floor(Math.random() * PETALS.length)];
    bits.push({ x, y, vx: (Math.random() - 0.5) * kick, vy: -6 - Math.random() * kick * 0.6, r, g, b, age: 0, life: 6 + Math.random() * 5, ph: Math.random() * TAU, big: false });
  }
  function chaff(x: number, y: number, kick: number) {
    const near = clamp((y - meadowTop) / (H - meadowTop), 0, 1), v = 0.85 + Math.random() * 0.3;
    bits.push({ x, y, vx: (Math.random() - 0.5) * kick, vy: -10 - Math.random() * (10 + kick), r: 196 * v, g: 196 * v, b: 104 * v, age: 0, life: 2 + Math.random() * 2.5, ph: Math.random() * TAU, big: near > 0.55 });
  }

  function disturb(x: number, sy: number, r: number, amt: number) {
    x = Math.round(x); sy = Math.round(sy);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = sy + dy, d = Math.hypot(dx, dy);
      if (d > r || X < 1 || X >= W - 1 || Y < 1 || Y >= SH - 1) continue;
      wa[Y * W + X] += amt * (1 - d / (r + 1));
    }
  }
  function sim() {
    for (let y = 1; y < SH - 1; y++) {
      const r = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = r + x;
        wb[i] = ((wa[i - 1] + wa[i + 1] + wa[i - W] + wa[i + W]) * 0.5 - wb[i]) * DAMP;
      }
    }
    const tmp = wa; wa = wb; wb = tmp;
  }

  function stepWind(dt: number, t: number) {
    const decay = Math.exp(-dt / 1.8);
    for (let x = 0; x < W; x++) {
      const c = clamp((gustF[x] + glen.breeze) * 80, -110, 110);
      const sx = x - c * dt, i0 = Math.floor(sx), f = sx - i0;
      const a = i0 >= 0 && i0 < W ? gustF[i0] : 0, b = i0 + 1 >= 0 && i0 + 1 < W ? gustF[i0 + 1] : 0;
      gtmp[x] = (a + (b - a) * f) * decay;
    }
    gustF.set(gtmp);
    const rise = 1 - Math.exp(-dt / 0.3), fade = Math.exp(-dt / 0.3), soften = 1 - Math.exp(-dt / 0.35);
    for (let x = 0; x < W; x++) {
      const p = push[x];
      if (Math.abs(p) > Math.abs(gustF[x]) || p * gustF[x] < 0) gustF[x] += (p - gustF[x]) * rise;
      push[x] = p * fade;
    }
    const dir = glen.breeze >= 0 ? 1 : -1;
    let sum = 0;
    for (let x = 0; x < W; x++) {
      const raw = glen.breeze * (0.75 + 0.35 * Math.sin(x * 0.02 - t * 1.2 * dir) + 0.2 * Math.sin(x * 0.055 - t * 2.6 * dir + 1.7)) + gustF[x];
      wind[x] += (raw - wind[x]) * soften;
      sum += wind[x];
    }
    meanWind = sum / W;
  }

  function frame(dt: number, t: number) {
    stepWind(dt, t);
    fogX += (5 + meanWind * 22) * dt;
    {
      const back = Math.exp(-dt / 4);
      for (let x = 0; x < W; x++) fogShift[x] = (fogShift[x] - (wind[x] - glen.breeze) * 26 * dt) * back;
    }
    grassX += (meanWind * 46 + (glen.breeze ? 3 : 0)) * dt;

    for (let y = 0; y < H; y++) {
      const fr = fogRow[y], row = y * W;
      const near = clamp((y - meadowTop) / (H - meadowTop), 0, 1), gs = 0.45 + near * 1.6;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        if (water[i]) continue;
        let r = R[i], g = G[i], b = B[i];
        if (meadow[i]) {
          const w = wind[x], aw = Math.tanh(Math.abs(w) * 0.8) * 1.2;
          const n = vnoise((x - grassX) / (9 * gs), y / (2.4 * gs), 3) * 0.7 + vnoise((x - grassX * 1.3) / (4 * gs), y / (1.6 * gs), 4) * 0.3;
          const sx = clamp(Math.round(x + clamp((n - 0.5) * Math.tanh(w) * 3 * gs, -2, 2)), 0, W - 1), j = row + sx;
          if (meadow[j]) { r = R[j]; g = G[j]; b = B[j]; }
          const band = clamp((n - 0.48) * 3.2, -1, 1);
          const tuft = (hash(i, 9) - 0.5) * 22 * near;
          const k = band * (0.18 + aw * 1.25) * 36 + tuft;
          r += k; g += k; b += k * 0.3;
        }
        const s = skyW[i];
        if (s > 0) {
          const c = vnoise((x + fogX * 0.6) / 38, y / 11, 5) - 0.5;
          r += c * 34 * s; g += c * 34 * s; b += c * 32 * s;
        }
        if (fr > 0) {
          const fx = x + fogX + fogShift[x];
          const f = vnoise(fx / 96, y / 16, 6) * 0.65 + vnoise((fx + fogX * 0.6) / 40, y / 7, 7) * 0.35;
          const a = clamp((f - 0.5) * 1.8, 0, 1) * fr * 0.42;
          r += (212 - r) * a; g += (215 - g) * a; b += (219 - b) * a;
        }
        OR[i] = r; OG[i] = g; OB[i] = b;
      }
    }

    // water: wind roughens it; the sim runs at a fixed 60 Hz
    const chop = Math.abs(meanWind) * 160 * dt + 6 * dt;
    for (let n = Math.floor(chop + Math.random()); n > 0; n--) {
      const x = 1 + Math.floor(Math.random() * (W - 2));
      if (wTop[x] < 0) continue;
      const y = wTop[x] + Math.floor(Math.random() * (wBot[x] - wTop[x]));
      disturb(x, (y - top) * SIM_K, 1, (0.3 + 0.8 * Math.min(1.5, Math.abs(wind[x]))) * (Math.random() < 0.5 ? -1 : 1));
    }
    simAcc += dt;
    for (let s = 0; simAcc >= 1 / 60 && s < 3; s++) { sim(); simAcc -= 1 / 60; }
    if (simAcc > 1 / 20) simAcc = 0;

    for (let x = 0; x < W; x++) {
      if (wTop[x] < 0) continue;
      const aw = Math.abs(wind[x]);
      for (let y = wTop[x]; y < wBot[x]; y++) {
        const i = y * W + x, srow = clamp((y - top) * SIM_K, 1, SH - 2), k = srow * W + x;
        const gx = wa[x < W - 1 ? k + 1 : k] - wa[x > 0 ? k - 1 : k], gy = wa[k + W] - wa[k - W];
        const depth = (y - wTop[x]) / Math.max(1, wBot[x] - wTop[x]);
        const wob = Math.sin(y * 2.1 - t * (2 + aw * 3) + x * 0.02) * (0.3 + aw * 1.4) * (0.5 + depth);
        let sx = clamp(Math.round(x + wob + gx * 3), 0, W - 1), sy = clamp(Math.round(y + gy * 1.5), 0, H - 1);
        if (!water[sy * W + sx]) { sx = x; sy = y; }
        const j = sy * W + sx;
        let r = R[j], g = G[j], b = B[j];
        const streak = vnoise((x - grassX * 0.8) / 14, y * 1.3, 8);
        const lift = (streak - 0.55) * aw * 40;
        r += lift; g += lift; b += lift;
        const sl = clamp(gy * 26, -60, 60);
        r += sl; g += sl; b += sl * 1.05;
        OR[i] = r; OG[i] = g; OB[i] = b;
      }
    }

    // blades bend with the wind at their foot; a travelling phase makes a gust read as a wave
    for (const bl of blades) {
      const w = wind[bl.x], aw = Math.min(1.5, Math.abs(w));
      const lean = Math.tanh(w * 1.1) * bl.h * 0.75 + Math.sin(t * (2.5 + aw * 5) + bl.ph - bl.x * 0.09 * Math.sign(w || 1)) * bl.h * 0.3 * (0.2 + aw);
      const bend = Math.abs(lean) / Math.max(1, bl.h);
      for (let k = 0; k < bl.h; k++) {
        const f = (k + 1) / bl.h, X = Math.round(bl.x + lean * f ** 1.6), Y = bl.y - k + Math.round(bend * f * f * 0.8 * bl.h * 0.4);
        if (X < 0 || X >= W || Y < 0 || Y >= H) continue;
        const j = Y * W + X, tip = k === bl.h - 1 && bend > 0.55 ? 34 * bend : 0;
        OR[j] = bl.r + tip; OG[j] = bl.g + tip; OB[j] = bl.b + tip * 0.9;
      }
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.age += dt;
      const f = rg.age / rg.life;
      if (f >= 1) { rings.splice(i, 1); continue; }
      const a = 0.8 * (1 - f) ** 1.1;
      // the back of a ripple catches the sky, the front faces down into the dark
      const lit = (X: number, Y: number, k: number, dark: boolean) => {
        if (X < 0 || X >= W || Y < 0 || Y >= H || !water[Y * W + X]) return;
        const j = Y * W + X, [tr, tg, tb] = dark ? [62, 68, 80] : [246, 248, 252];
        OR[j] += (tr - OR[j]) * k; OG[j] += (tg - OG[j]) * k; OB[j] += (tb - OB[j]) * k;
      };
      // on this pale water a ripple shows as a dark ring (it tilts the dark hills into view),
      // with a bright fleck where the drop went in
      const rx = 0.6 + f * rg.size, ry = Math.max(0.5, rx / 3);
      if (rg.age < 0.12) lit(rg.x, rg.y, 0.9, false);
      if (rg.age < 0.07 && rg.size > 4) lit(rg.x, rg.y - 1, 0.8, false);
      const steps = Math.max(4, Math.round(rx * 5));
      for (let k = 0; k < steps; k++) {
        const an = (k / steps) * TAU;
        const back = Math.sin(an) < -0.5;
        lit(Math.round(rg.x + Math.cos(an) * rx), Math.round(rg.y + Math.sin(an) * ry), back ? a * 0.6 : a, !back);
      }
    }
    if (rings.length > 300) rings.splice(0, rings.length - 300);

    // drizzle, slanted by the wind where each drop is; the slant is what shows the wind
    if (glen.breeze || drops.length) {
      rainAcc += dt * (glen.breeze ? DRIZZLE : 0);
      for (; rainAcc >= 1; rainAcc--) {
        const x = Math.random() * (W + 80) - 40 - meanWind * 30, X = clamp(Math.round(x), 0, W - 1);
        let z = Math.random() ** 1.6, land = top - 6 + z * (H - top + 6) + (Math.random() - 0.5) * 8;
        // the loch is a thin band, so aim a share of the drops at it on purpose; depth follows
        // from where a drop lands, so its size and speed still match the perspective
        if (wTop[X] >= 0 && Math.random() < 0.45) {
          land = wTop[X] + Math.random() * (wBot[X] - wTop[X]);
          z = clamp((land - (top - 6)) / (H - top + 6), 0, 1);
        }
        drops.push({ x, y: -4 - Math.random() * 20, z, vx: 0, land });
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      const w = wind[clamp(Math.round(d.x), 0, W - 1)];
      // Drops only drift a little, with inertia, so a gust can't herd them into a line;
      // the wind is drawn as the slant of each streak instead.
      const vy = 75 + d.z * 115, lean = Math.tanh(w * 0.9) * (1 + d.z * 0.5);
      d.vx += (w * (14 + d.z * 22) - d.vx) * Math.min(1, dt * 1.2);
      d.x += d.vx * dt; d.y += vy * dt;
      const vx = lean * vy;
      if (d.y >= d.land) {
        const X = Math.round(d.x), Y = Math.round(d.land);
        if (X >= 1 && X < W - 1 && Y >= 0 && Y < H) {
          const j = Y * W + X;
          if (water[j]) {
            disturb(X, (Y - top) * SIM_K, 1, 1.2 + d.z * 1.8);
            rings.push({ x: X, y: Y, age: 0, life: 0.6 + d.z * 0.5, size: 3 + d.z * 6 + Math.max(0, Y - top) * 0.12 });
          }
          else if (d.z > 0.35) splashes.push({ x: X, y: Y, age: 0 });
        }
        drops.splice(i, 1);
        continue;
      }
      const len = 1 + Math.round(d.z * 3.5), a = 0.2 + d.z * 0.32;
      const sp = Math.hypot(vx, vy), ux = vx / sp, uy = vy / sp;
      for (let k = 0; k < len; k++) {
        const X = Math.round(d.x - ux * k), Y = Math.round(d.y - uy * k);
        if (X < 0 || X >= W || Y < 0 || Y >= H) continue;
        const j = Y * W + X, f = a * (1 - k / (len + 1));
        // lighten rather than paint grey, so a drop over grass stays green and over rock stays stone
        OR[j] += 96 * f; OG[j] += 100 * f; OB[j] += 110 * f;
      }
    }
    if (drops.length > 900) drops.splice(0, drops.length - 900);
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.age += dt;
      if (s.age > 0.1) { splashes.splice(i, 1); continue; }
      for (const dx of [-1, 1]) {
        const X = s.x + dx, Y = s.y - 1;
        if (X < 0 || X >= W || Y < 0) continue;
        const j = Y * W + X;
        OR[j] += 30; OG[j] += 32; OB[j] += 36;
      }
    }

    const strong = Math.max(0, Math.abs(meanWind) - 0.25);
    if (veil) {
      petalAcc += dt * (0.9 + strong * 9);
      for (; petalAcc >= 1; petalAcc--) petal(veil.x + (Math.random() - 0.5) * 4, veil.y + 2 + Math.random() * 4, 10);
    }
    chaffAcc += dt * strong * 26;
    for (; chaffAcc >= 1; chaffAcc--) {
      const y = meadowRows[Math.floor(Math.random() * meadowRows.length)];
      chaff(meanWind > 0 ? Math.random() * W * 0.6 : W * 0.4 + Math.random() * W * 0.6, y, 8);
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i];
      p.age += dt;
      const w = wind[clamp(Math.round(p.x), 0, W - 1)];
      p.vx += (w * 62 - p.vx) * Math.min(1, dt * 1.8);
      p.vy += (7 - p.vy) * Math.min(1, dt * 0.9) - Math.abs(w) * 9 * dt * Math.sin(p.age * 3 + p.ph);
      p.x += p.vx * dt + Math.sin(p.age * 6 + p.ph) * 0.3;
      p.y += p.vy * dt;
      if (p.age > p.life || p.x < -4 || p.x > W + 4 || p.y > H + 2 || p.y < -4) { bits.splice(i, 1); continue; }
      const X = Math.round(p.x), Y = Math.round(p.y);
      const flat = Math.sin(p.age * 9 + p.ph) > 0.2;
      for (const [dx, dy] of p.big ? [[0, 0], [1, 0], [0, 1]] : flat ? [[0, 0], [1, 0]] : [[0, 0]]) {
        const x = X + dx, y = Y + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const j = y * W + x;
        OR[j] = p.r; OG[j] = p.g; OB[j] = p.b;
      }
    }
    if (bits.length > 400) bits.splice(0, bits.length - 400);

    if (veil) {
      const w = wind[veil.x], s = Math.min(1, Math.abs(w) * 1.2), d = w >= 0 ? 1 : -1;
      const L = 2 + Math.round(4 * s);
      for (let k = 1; k <= L; k++) {
        const px = veil.x + d * k, py = Math.round(veil.y + 1 + k * (1 - s) * 0.9 + Math.sin(t * 9 - k * 1.1) * 0.7 * s);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        if (bay(px, py) + 0.5 > 1 - (k / (L + 1)) * 0.6) continue;
        const i = py * W + px;
        OR[i] = 238; OG[i] = 239; OB[i] = 242;
      }
    }

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = bay(x, y) * SPREAD;
      const ri = clamp((OR[i] + d) | 0, 0, 255) >> 3, gi = clamp((OG[i] + d) | 0, 0, 255) >> 3, bi = clamp((OB[i] + d) | 0, 0, 255) >> 3;
      buf[i] = palU32[lut[(ri << 10) | (gi << 5) | bi]];
    }
  }

  const waterRow = (x: number, y: number) => {
    const X = clamp(Math.round(x), 0, W - 1);
    if (wTop[X] < 0) return -1;
    return clamp(Math.round(y), wTop[X], wBot[X] - 1);
  };

  const glen: Glen = {
    W, H, buf, waterLine: top, frame, breeze: 0.35,
    isWater(x, y) {
      const X = Math.round(x), Y = Math.round(y);
      if (X < 0 || X >= W || wTop[X] < 0) return false;
      return Y >= wTop[X] - 2 && Y < wBot[X] + 2;
    },
    poke(x, y) {
      const wy = waterRow(x, y);
      if (wy >= 0) disturb(x, (wy - top) * SIM_K, 3, 9);
    },
    blow(x, vx) {
      // a fast flick and a slow sweep both land in a sensible range
      const amount = 2.3 * Math.tanh(vx / 200);
      for (let k = Math.max(0, Math.round(x) - 64); k < Math.min(W, Math.round(x) + 64); k++) {
        const g = Math.exp(-((k - x) ** 2) / (2 * 24 * 24));
        push[k] += (amount - push[k]) * g * 0.6;
      }
      if (Math.abs(amount) > 0.5) for (let n = 0; n < 2; n++) {
        const y = meadowRows[Math.floor(Math.random() * meadowRows.length)];
        chaff(x + (Math.random() - 0.5) * 40, y, 16);
      }
    },
    stir(x, y, speed) {
      const wy = waterRow(x, y);
      if (wy >= 0) disturb(x, (wy - top) * SIM_K, 2, clamp(speed / 60, 0.8, 5));
    },
    gust(dir) {
      for (let k = 0; k < W; k++) {
        const g = Math.exp(-(dir > 0 ? k : W - 1 - k) / 50);
        push[k] += (dir * 1.6 - push[k]) * g;
      }
    },
  };
  return glen;
}

export async function mountGlen(cv: HTMLCanvasElement, stage: HTMLElement, card: HTMLElement, hint: HTMLElement, src: string) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let img: HTMLImageElement;
  try {
    img = new Image();
    img.src = src;
    await img.decode();
  } catch (error) {
    hint.textContent = 'The photo failed to load. Try refreshing.';
    console.error(error);
    return;
  }
  const W = img.naturalWidth, H = img.naturalHeight;
  cv.width = W; cv.height = H;
  const ctx = context2d(cv, { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const glen = createGlen(ctx.getImageData(0, 0, W, H).data, W, H);
  const image = ctx.createImageData(W, H);
  const out = new Uint32Array(image.data.buffer);

  function fit() {
    // contain the art in the room the stage leaves, minus the card's padding; prefer whole device
    // pixels, but not at the cost of leaving the card much smaller than it could be
    const dpr = devicePixelRatio || 1, cs = getComputedStyle(card);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const s = Math.max(0.1, Math.min((stage.clientWidth - pad) / W, (stage.clientHeight - pad) / H));
    const whole = Math.floor(s * dpr) / dpr;
    const k = whole >= s * 0.88 ? whole : s;
    cv.style.width = `${Math.floor(W * k)}px`;
    cv.style.height = `${Math.floor(H * k)}px`;
  }
  fit();
  new ResizeObserver(fit).observe(stage);

  const setBreeze = () => { glen.breeze = reduceMotion.matches ? 0 : 0.35; };
  setBreeze();
  reduceMotion.addEventListener('change', setBreeze);

  const toScene = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  let down: { lx: number; ly: number; lt: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    const p = toScene(e);
    cv.setPointerCapture(e.pointerId);
    if (glen.isWater(p.x, p.y)) glen.poke(p.x, p.y);
    down = { lx: p.x, ly: p.y, lt: e.timeStamp };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = toScene(e);
    const dt = Math.max(8, e.timeStamp - down.lt) / 1000;
    const dx = p.x - down.lx, dy = p.y - down.ly;
    if (glen.isWater(p.x, p.y)) glen.stir(p.x, p.y, Math.hypot(dx, dy) / dt);
    else glen.blow(p.x, dx / dt);
    down = { lx: p.x, ly: p.y, lt: e.timeStamp };
  });
  const up = (e: PointerEvent) => {
    down = null;
    if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { glen.gust(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      for (let k = 0; k < 20; k++) {
        const x = Math.random() * W, y = glen.waterLine + Math.random() * 20;
        if (glen.isWater(x, y)) { glen.poke(x, y); break; }
      }
      e.preventDefault();
    }
  });

  let last = performance.now() / 1000;
  function tick(ms: number) {
    const now = ms / 1000, dt = Math.min(0.05, now - last);
    last = now;
    glen.frame(dt, now);
    out.set(glen.buf);
    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(tick);
  }
  hint.textContent = 'Drag across the glen to send a gust. Touch the loch to ripple it.';
  requestAnimationFrame(tick);
}
