import { context2d } from '../lib/dom';

type Vec = { x: number; y: number };
type Color = string | null;

const N = 16;
const TAU = Math.PI * 2;
const RIPE = 7;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Tex { canvas: HTMLCanvasElement; alpha: Uint8ClampedArray; data: Uint8ClampedArray; w: number; h: number }

function vectorTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Tex {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = context2d(canvas, {});
  draw(ctx);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const on = data[i * 4 + 3] > 110;
    data[i * 4 + 3] = on ? 255 : 0;
    alpha[i] = on ? 255 : 0;
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, alpha, data, w, h };
}

function makeTex(w: number, h: number, paint: (x: number, y: number) => Color): Tex {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = context2d(canvas, {});
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint(x, y);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  return { canvas, alpha, data, w, h };
}

const GRASS = ['#5d9c3a', '#68ab43', '#538f33', '#4b822e', '#74b64d'];
const DIRT = ['#86593a', '#7a5033', '#946642', '#6d4630', '#9b6e48'];
const STONE = ['#8d8781', '#77726c'];
const FARM = ['#4b301e', '#563723', '#402919', '#5e3d27'];
const WATER = ['#2f57bd', '#3963cc', '#2a4daa', '#4573d8'];

function textures() {
  const r = rng(42);
  const from = (list: string[]) => list[Math.floor(r() * list.length)];
  const dirtPx = () => (r() < 0.05 ? from(STONE) : from(DIRT));

  const grassTop = makeTex(N, N, () => from(GRASS));
  const dirt = makeTex(N, N, dirtPx);
  const fringe = Array.from({ length: N }, () => 2 + Math.floor(r() * 3) + (r() < 0.2 ? 2 : 0));
  const grassSide = makeTex(N, N, (x, y) => (y < fringe[x] ? GRASS[Math.min(4, Math.floor(r() * 3) + (y === fringe[x] - 1 ? 1 : 0))] : dirtPx()));
  const farmTop = makeTex(N, N, (x, y) => (y % 4 === 3 ? (r() < 0.7 ? '#3a2416' : from(FARM)) : y % 4 === 0 && r() < 0.4 ? '#6a452b' : from(FARM)));
  const ripple = (seed: number) => {
    const p1 = r() * TAU, p2 = r() * TAU;
    return makeTex(N, 80, (x, y) => {
      const t = ((y % 64) / 64) * TAU;
      const w = Math.sin(t * 2 + x * 0.55 + p1) + 0.8 * Math.sin(t * 3 - x * 0.4 + p2 + seed);
      return w > 1.3 ? '#78a2ee' : w > 0.7 ? WATER[3] : w < -1.25 ? WATER[2] : (x * 5 + y * 3) % 13 === 0 ? WATER[0] : WATER[1];
    });
  };
  const water = ripple(0);
  const waterB = ripple(1.7);

  const wheat = Array.from({ length: 8 }, (_, age) => {
    const stage = (age / 7) * 4;
    const ripe = age === 7;
    const cols = [1, 3, 5, 7, 9, 11, 13, 14];
    const heights = cols.map(() => Math.max(2, Math.round((3 + stage * 3) * (0.7 + r() * 0.3))));
    const leafSide = cols.map(() => (r() < 0.5 ? -1 : 1));
    return makeTex(N, N, (x, y) => {
      const up = N - 1 - y;
      for (let i = 0; i < cols.length; i++) {
        const h = heights[i];
        const cx = cols[i] + (up > h * 0.6 ? leafSide[i] : 0);
        if (x === cx && up < h) {
          if (ripe && up >= h - 4) return up % 2 ? '#e2c262' : '#c99d36';
          return ripe ? (up % 3 ? '#c8a447' : '#a8852f') : up % 3 ? '#4f9d2e' : '#3e8125';
        }
        if (stage > 1 && up < h - 2 && up % 4 === 2 && x === cx + leafSide[i]) return ripe ? '#b8933a' : '#5fb23a';
        if (ripe && up >= h - 4 && up < h && up % 2 === 0 && x === cx - leafSide[i]) return '#d6b04c';
      }
      return null;
    });
  });

  const carrot = Array.from({ length: 4 }, (_, idx) => {
    const stage = (idx / 3) * 4;
    const ripe = idx === 3;
    const blades = [4, 6, 8, 9, 11].map((x) => ({ x, h: Math.round((2 + stage * 2.4) * (0.75 + r() * 0.25)), lean: Math.round((x - 7.5) / 3) }));
    return makeTex(N, N, (x, y) => {
      const up = N - 1 - y;
      if (ripe && up <= 1 && x >= 5 && x <= 10) return up === 0 ? (x % 2 ? '#e8761c' : '#f28a2a') : x >= 6 && x <= 9 ? '#f59a3a' : null;
      for (const b of blades) {
        const off = up > b.h / 2 ? b.lean : 0;
        if (x === b.x + off && up >= (ripe ? 2 : 0) && up < b.h + (ripe ? 2 : 0)) return up % 3 ? '#4e9f30' : '#3b8224';
        if (stage > 1 && up > 2 && up < b.h && up % 3 === 1 && x === b.x + off + Math.sign(b.lean || 1)) return '#66b83f';
      }
      return null;
    });
  });

  const koi = makeTex(N, 8, (x, y) => {
    const patch = Math.sin(x * 0.9) + Math.cos(y * 1.3 + x * 0.4) > 0.6;
    return patch ? '#f4eee4' : (x + y) % 5 === 0 ? '#e0662c' : '#ef7f3a';
  });
  const koiTop = makeTex(N, 4, (x) => (x % 5 === 2 ? '#f4eee4' : '#d96a30'));
  const fin = makeTex(4, 6, (x, y) => (Math.abs(y - 2.5) <= x * 0.9 + 0.6 ? '#f39a5c' : null));

  const carrotItem = vectorTex(64, 64, (c) => {
    c.scale(2, 2);
    c.translate(16, 16);
    c.rotate(-Math.PI / 4);
    for (const [ang, col] of [[-0.55, '#3f8f26'], [0.55, '#4e9f30'], [0, '#5cb83a']] as const) {
      c.save();
      c.translate(6, 0);
      c.rotate(ang);
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(5, 0, 6, 1.8, 0, 0, TAU);
      c.fill();
      c.restore();
    }
    const body = c.createLinearGradient(0, -4, 0, 4);
    body.addColorStop(0, '#ffb057');
    body.addColorStop(0.5, '#f28a2a');
    body.addColorStop(1, '#d0621a');
    c.fillStyle = body;
    c.beginPath();
    c.moveTo(-13, 0.3);
    c.quadraticCurveTo(-4, -4.6, 7, -3.6);
    c.lineTo(7, 3.6);
    c.quadraticCurveTo(-4, 4.6, -13, -0.3);
    c.closePath();
    c.fill();
    c.strokeStyle = '#c45a14';
    c.lineWidth = 1;
    for (const x of [-7, -2, 3]) {
      c.beginPath();
      c.moveTo(x, -2.4 - (x + 13) * 0.05);
      c.lineTo(x + 0.8, -0.6);
      c.stroke();
    }
  });
  const wheatItem = vectorTex(64, 64, (c) => {
    c.scale(2, 2);
    c.translate(16, 17);
    c.rotate(-Math.PI / 4);
    const ears = [-0.11, 0, 0.11];
    c.strokeStyle = '#b8923a';
    c.lineWidth = 1.1;
    for (const ang of ears) {
      c.save();
      c.rotate(ang * 0.5);
      c.beginPath();
      c.moveTo(-14, 0);
      c.lineTo(0, 0);
      c.stroke();
      c.restore();
    }
    c.fillStyle = '#8a5f24';
    c.fillRect(-7.5, -2.6, 2.2, 5.2);
    for (const ang of ears) {
      c.save();
      c.rotate(ang);
      c.strokeStyle = '#e2c56c';
      c.lineWidth = 0.55;
      for (let k = 0; k < 6; k++) {
        const x = 1.2 + k * 1.7, side = k % 2 ? 1 : -1;
        c.beginPath();
        c.moveTo(x + 1, side * 1.1);
        c.lineTo(x + 5.5, side * 2.4);
        c.stroke();
      }
      for (let k = 0; k < 6; k++) {
        const x = 1.2 + k * 1.7, side = k % 2 ? 1 : -1;
        c.fillStyle = k % 2 ? '#d9ae44' : '#ebc966';
        c.beginPath();
        c.ellipse(x, side * 0.75, 1.35, 0.95, side * 0.45, 0, TAU);
        c.fill();
      }
      c.restore();
    }
  });
  const bubble = makeTex(8, 8, (x, y) => {
    const d = Math.hypot(x - 3.5, y - 3.5);
    if (x === 2 && y === 2) return '#ffffff';
    return d > 2.4 && d < 3.6 ? '#9fdcff' : d <= 2.4 ? 'rgba(200,236,255,0.25)' : null;
  });
  const grain = (x: number, y: number, base: string[], line: string) => {
    if (y % 4 === 3) return line;
    const k = Math.sin(x * 0.7 + Math.floor(y / 4) * 2.3) + r() * 0.6;
    return k > 1.1 ? base[2] : k < -0.6 ? base[1] : base[0];
  };
  const plank = makeTex(N, N, (x, y) => grain(x + (Math.floor(y / 4) % 2) * 5, y, ['#a87a48', '#946a3d', '#b98a56'], '#7c5733'));
  const post = makeTex(4, N, (x, y) => (x === 0 ? '#5a3d24' : (y + x * 3) % 5 === 0 ? '#5f4128' : r() < 0.3 ? '#7a5634' : '#6c4a2d'));

  return { grassTop, grassSide, dirt, farmTop, water, waterB, carrotItem, wheatItem, wheat, carrot, koi, koiTop, fin, bubble, plank, post };
}

const GLYPHS: Record<string, string> = {
  H: '101101111101101', E: '111100110100111', L: '100100100100111', O: '111101101101111',
};

function signTex(hue: number) {
  const r = rng(5);
  return makeTex(32, 16, (x, y) => {
    const gx = x - 6, gy = y - 5;
    if (gy >= 0 && gy < 5 && gx >= 0 && gx < 19) {
      const ch = 'HELLO'[Math.floor(gx / 4)];
      const cx = gx % 4;
      if (ch && cx < 3 && GLYPHS[ch][gy * 3 + cx] === '1') return `hsl(${hue} 85% 58%)`;
    }
    if (y % 4 === 3) return '#7c5733';
    const k = Math.sin((x + (Math.floor(y / 4) % 2) * 9) * 0.45 + Math.floor(y / 4) * 2.3) + r() * 0.6;
    return k > 1.1 ? '#b98a56' : k < -0.6 ? '#946a3d' : '#a87a48';
  });
}

interface Crop { x: number; y: number; kind: 'wheat' | 'carrot'; stage: number; since: number; next: number; sway: number; swayV: number; phase: number; hop: number }
interface Hit { o: Vec; a: Vec; b: Vec; tex: Tex | null; id: string }
interface Bubble { x: number; y: number; z: number; vz: number; phase: number; age: number; size: number }
interface Drop { kind: 'wheat' | 'carrot'; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; age: number; landed: boolean; taken: number }
interface Bit { x: number; y: number; vx: number; vy: number; color: string; age: number }

export function mountFarm(cv: HTMLCanvasElement, stage: HTMLElement, onCollect: (wheat: number, carrot: number) => void) {
  const ctx = context2d(cv, {});
  const tex = textures();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let sign = signTex(180);
  let signHue = 180;
  let drawnHue = 180;
  let signWiggle = 0;

  let W = 0, H = 0, s = 0, c = 0, h = 0, OX = 0, OY = 0, dpr = 1;
  function fit() {
    dpr = devicePixelRatio || 1;
    const css = Math.min(stage.clientWidth, 640);
    cv.style.width = `${css}px`;
    cv.style.height = `${css * 0.86}px`;
    W = cv.width = Math.round(css * dpr);
    H = cv.height = Math.round(css * 0.86 * dpr);
    s = Math.min(W / 5.1, H / 4.6);
    c = s * Math.cos(Math.PI / 6);
    h = s * 0.5;
    OX = W / 2 - 0.5 * c;
    OY = H / 2 - 0.15 * s;
  }
  fit();
  new ResizeObserver(fit).observe(stage);

  const P = (x: number, y: number, z: number): Vec => ({ x: OX + (x - y) * c, y: OY + (x + y) * h - z * s });
  const sub = (p: Vec, q: Vec): Vec => ({ x: p.x - q.x, y: p.y - q.y });

  let hits: Hit[] = [];

  function quad(t: Tex, o: Vec, a: Vec, b: Vec, shade: number, alpha: number, id: string | null) {
    ctx.setTransform(a.x / t.w, a.y / t.w, b.x / t.h, b.y / t.h, o.x, o.y);
    ctx.globalAlpha = alpha;
    const e = 0.04;
    ctx.drawImage(t.canvas, -e, -e, t.w + e * 2, t.h + e * 2);
    if (shade > 0) {
      ctx.globalAlpha = alpha * shade;
      ctx.fillStyle = '#000';
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(-e, -e, t.w + e * 2, t.h + e * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    if (id !== null) hits.push({ o, a, b, tex: t, id });
  }

  function flow(t: Tex, o: Vec, a: Vec, b: Vec, sy: number, shade: number, alpha: number) {
    const y = ((sy % 64) + 64) % 64;
    ctx.setTransform(a.x / N, a.y / N, b.x / N, b.y / N, o.x, o.y);
    ctx.globalAlpha = alpha;
    const e = 0.04;
    ctx.drawImage(t.canvas, 0, y, N, N, -e, -e, N + e * 2, N + e * 2);
    if (shade > 0) {
      ctx.globalAlpha = alpha * shade;
      ctx.fillStyle = '#000';
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(-e, -e, N + e * 2, N + e * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    hits.push({ o, a, b, tex: null, id: 'water' });
  }

  function pond(t: number) {
    const zt = 14 / N;
    for (let x = 1; x < 3; x++) {
      const o = P(x, 1, zt), a = sub(P(x + 1, 1, zt), o), b = sub(P(x, 2, zt), o);
      flow(tex.water, o, a, b, t * 2.2 + x * N, 0, 0.82);
      flow(tex.waterB, o, a, b, -t * 1.3 + x * 7, 0, 0.3);
      const fo = P(x, 2, zt);
      flow(tex.water, fo, sub(P(x + 1, 2, zt), fo), sub(P(x, 2, 0), fo), -t * 5 + x * 9, 0.18, 0.55);
    }
    const ro = P(3, 2, zt);
    flow(tex.water, ro, sub(P(3, 1, zt), ro), sub(P(3, 2, 0), ro), -t * 5 + 3, 0.36, 0.55);
  }

  function block(x: number, y: number, z: number, top: Tex, side: Tex, id: string | null, height: number, alpha: number, right: boolean, sideAlpha: number) {
    const zt = z + height;
    quad(top, P(x, y, zt), sub(P(x + 1, y, zt), P(x, y, zt)), sub(P(x, y + 1, zt), P(x, y, zt)), 0, alpha, id);
    quad(side, P(x, y + 1, zt), sub(P(x + 1, y + 1, zt), P(x, y + 1, zt)), sub(P(x, y + 1, z), P(x, y + 1, zt)), 0.2, sideAlpha, id);
    if (right) quad(side, P(x + 1, y + 1, zt), sub(P(x + 1, y, zt), P(x + 1, y + 1, zt)), sub(P(x + 1, y + 1, z), P(x + 1, y + 1, zt)), 0.38, sideAlpha, id);
  }

  const crops: Crop[] = [];
  const now0 = performance.now() / 1000;
  const cr = rng(9);
  for (let x = 0; x < 3; x++) crops.push({ x, y: 0, kind: x === 2 ? 'carrot' : 'wheat', stage: Math.floor(cr() * 5), since: now0, next: now0 + 1 + cr() * 2, sway: 0, swayV: 0, phase: cr() * TAU, hop: 0 });

  function drawCrop(k: Crop, t: number, now: number) {
    const t2 = k.kind === 'wheat' ? tex.wheat[k.stage] : tex.carrot[k.stage >> 1];
    const z = 1 - 1 / N + k.hop * 0.06;
    const lean = (Math.sin(t * 1.6 + k.phase) * 0.04 + k.sway) * s;
    const up = (p: Vec): Vec => ({ x: p.x, y: p.y - s });
    const planes: [Vec, Vec][] = [
      [P(k.x, k.y + 0.25, z), P(k.x + 1, k.y + 0.25, z)],
      [P(k.x + 0.25, k.y + 1, z), P(k.x + 0.25, k.y, z)],
      [P(k.x + 0.75, k.y + 1, z), P(k.x + 0.75, k.y, z)],
      [P(k.x, k.y + 0.75, z), P(k.x + 1, k.y + 0.75, z)],
    ];
    for (const [l, r] of planes) {
      const top = up(l);
      const rise = k.stage === RIPE ? 1 : 0.82 + 0.18 * Math.min(1, (now - k.since) / Math.max(0.1, k.next - k.since));
      const tall = s * rise;
      quad(t2, { x: top.x + lean, y: top.y + s - tall }, sub(r, l), { x: -lean, y: tall }, 0, 1, `crop:${crops.indexOf(k)}`);
    }
  }

  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: Tex, front: Tex, side: Tex) {
    quad(top, P(x0, y0, z1), sub(P(x1, y0, z1), P(x0, y0, z1)), sub(P(x0, y1, z1), P(x0, y0, z1)), 0, 1, 'sign');
    quad(front, P(x0, y1, z1), sub(P(x1, y1, z1), P(x0, y1, z1)), sub(P(x0, y1, z0), P(x0, y1, z1)), 0.14, 1, 'sign');
    quad(side, P(x1, y1, z1), sub(P(x1, y0, z1), P(x1, y1, z1)), sub(P(x1, y1, z0), P(x1, y1, z1)), 0.36, 1, 'sign');
  }

  function drawSign(t: number) {
    const wig = Math.sin(signWiggle * 28) * signWiggle * 0.06;
    box(0.45, 0.55, 1.42, 1.52, 1, 1.62, tex.post, tex.post, tex.post);
    const hue = Math.round((signHue + t * 30) % 360);
    if (Math.abs(hue - drawnHue) >= 4) {
      sign = signTex(hue);
      drawnHue = hue;
    }
    box(0.0 + wig, 1.0 + wig, 1.44, 1.56, 1.56, 2.06, tex.plank, sign, tex.plank);
  }

  const fish = { x: 1.8, z: 0.35, target: 2.3, dir: 1, flee: 0, tail: 0 };
  function drawFish(t: number) {
    const len = 0.5, ht = 0.2, wd = 0.14, y0 = 1.43;
    const back = fish.x - (len / 2) * fish.dir, front = fish.x + (len / 2) * fish.dir;
    const xa = Math.min(back, front), xb = Math.max(back, front);
    const z0 = fish.z + Math.sin(t * 2) * 0.02, z1 = z0 + ht;
    const wag = Math.sin(fish.tail) * 0.07;
    const tailBase = back, tailEnd = back - 0.16 * fish.dir;
    quad(tex.fin, P(tailEnd, y0 + wd / 2 + wag, z1 + 0.04), sub(P(tailBase, y0 + wd / 2, z1 - 0.02), P(tailEnd, y0 + wd / 2 + wag, z1 + 0.04)), sub(P(tailEnd, y0 + wd / 2 + wag, z0 - 0.04), P(tailEnd, y0 + wd / 2 + wag, z1 + 0.04)), 0.1, 1, null);
    quad(tex.koiTop, P(xa, y0, z1), sub(P(xb, y0, z1), P(xa, y0, z1)), sub(P(xa, y0 + wd, z1), P(xa, y0, z1)), 0, 1, null);
    quad(tex.koi, P(xa, y0 + wd, z1), sub(P(xb, y0 + wd, z1), P(xa, y0 + wd, z1)), sub(P(xa, y0 + wd, z0), P(xa, y0 + wd, z1)), 0.1, 1, null);
    quad(tex.koi, P(xb, y0 + wd, z1), sub(P(xb, y0, z1), P(xb, y0 + wd, z1)), sub(P(xb, y0 + wd, z0), P(xb, y0 + wd, z1)), 0.3, 1, null);
    if (fish.dir > 0) {
      const eye = P(xb - 0.07, y0 + wd + 0.001, z1 - 0.07);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#1d1512';
      ctx.fillRect(eye.x - s / 64, eye.y - s / 64, s / 32, s / 32);
    }
  }

  const bubbles: Bubble[] = [];
  const bits: Bit[] = [];
  const drops: Drop[] = [];
  const bag = { wheat: 0, carrot: 0 };

  function drop(k: Crop) {
    const n = k.kind === 'wheat' ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      drops.push({ kind: k.kind, x: k.x + 0.5, y: k.y + 0.5, z: 1.05, vx: Math.cos(a) * 0.9, vy: Math.sin(a) * 0.6, vz: 1.5 + Math.random() * 0.5, spin: Math.random() * TAU, age: 0, landed: false, taken: -1 });
    }
  }

  function updateDrops(dt: number) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      if (d.taken >= 0) {
        d.taken += dt;
        d.z += dt * 2.5;
        if (d.taken > 0.35) drops.splice(i, 1);
        continue;
      }
      if (d.age > 10) { drops.splice(i, 1); continue; }
      if (!d.landed) {
        d.vz -= 9 * dt;
        d.x = Math.max(0.12, Math.min(2.88, d.x + d.vx * dt));
        d.y = Math.max(0.15, Math.min(0.88, d.y + d.vy * dt));
        d.z += d.vz * dt;
        const ground = 1 - 1 / N;
        if (d.z <= ground) {
          d.z = ground;
          if (d.vz < -1.2) { d.vz *= -0.35; d.vx *= 0.5; d.vy *= 0.5; }
          else d.landed = true;
        }
      }
    }
    for (const a of drops) for (const b of drops) {
      if (a === b || !a.landed || !b.landed || a.taken >= 0 || b.taken >= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      if (dist >= 0.26 || dist === 0) continue;
      const push = ((0.26 - dist) / dist) * Math.min(1, dt * 6);
      b.x = Math.max(0.15, Math.min(2.85, b.x + dx * push));
      b.y = Math.max(0.15, Math.min(0.88, b.y + dy * push));
    }
  }

  const VIEW = { x: 1, y: 1 };

  function drawItem(t: Tex, cx: number, cy: number, cz: number, theta: number, size: number) {
    const TW = t.w, TH = t.h;
    const ux = Math.cos(theta) * size, uy = Math.sin(theta) * size;
    const th = size / N;
    const nx = -Math.sin(theta) * th, ny = Math.cos(theta) * th;
    const pos = (i: number, j: number, k: number) => P(cx - ux / 2 + (ux * i) / TW + nx * k, cy - uy / 2 + (uy * i) / TW + ny * k, cz + size * (1 - j / TH));
    const near = nx * VIEW.x + ny * VIEW.y > 0 ? 0.5 : -0.5;
    const face = (k: number) => {
      const o = pos(0, 0, k), a = sub(pos(TW, 0, k), o), b = sub(pos(0, TH, k), o);
      ctx.setTransform(a.x / TW, a.y / TW, b.x / TH, b.y / TH, o.x, o.y);
      ctx.drawImage(t.canvas, 0, 0);
    };
    face(-near);

    const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < TW && j < TH && t.alpha[j * TW + i] > 8;
    const rightVisible = ux * VIEW.x + uy * VIEW.y > 0;
    const strips: { d: number; o: Vec; a: Vec; b: Vec; color: string }[] = [];
    const tint = (i: number, j: number, k: number) => {
      const q = (j * TW + i) * 4;
      return `rgb(${(t.data[q] * k) | 0} ${(t.data[q + 1] * k) | 0} ${(t.data[q + 2] * k) | 0})`;
    };
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      if (!solid(i, j)) continue;
      const depth = (i0: number) => cx - ux / 2 + (ux * i0) / TW + cy - uy / 2 + (uy * i0) / TW;
      if (rightVisible && !solid(i + 1, j)) {
        const o = pos(i + 1, j, -0.5);
        strips.push({ d: depth(i + 1), o, a: sub(pos(i + 1, j, 0.5), o), b: sub(pos(i + 1, j + 1, -0.5), o), color: tint(i, j, 0.62) });
      }
      if (!rightVisible && !solid(i - 1, j)) {
        const o = pos(i, j, -0.5);
        strips.push({ d: depth(i), o, a: sub(pos(i, j, 0.5), o), b: sub(pos(i, j + 1, -0.5), o), color: tint(i, j, 0.62) });
      }
      if (!solid(i, j - 1)) {
        const o = pos(i, j, -0.5);
        strips.push({ d: depth(i + 0.5) - 0.001, o, a: sub(pos(i, j, 0.5), o), b: sub(pos(i + 1, j, -0.5), o), color: tint(i, j, 0.9) });
      }
    }
    strips.sort((p, q) => p.d - q.d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const st of strips) {
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.moveTo(st.o.x, st.o.y);
      ctx.lineTo(st.o.x + st.a.x, st.o.y + st.a.y);
      ctx.lineTo(st.o.x + st.a.x + st.b.x, st.o.y + st.a.y + st.b.y);
      ctx.lineTo(st.o.x + st.b.x, st.o.y + st.b.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    face(near);
  }

  function drawDrops() {
    for (const d of drops) {
      const t = d.kind === 'wheat' ? tex.wheatItem : tex.carrotItem;
      const fade = d.taken >= 0 ? 1 - d.taken / 0.35 : d.age > 9 ? 10 - d.age : 1;
      const pop = Math.min(1, 0.3 + d.age * 5);
      const size = 0.44 * fade * pop;
      const bob = d.landed ? 0.14 + Math.sin(d.age * 2 + d.spin) * 0.05 : 0.08;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#000';
      const g = P(d.x, d.y, 1 - 1 / N);
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, s * size * 0.5, s * size * 0.25, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      drawItem(t, d.x, d.y, d.z + bob, d.spin + d.age, size);
    }
  }

  function collectNear(px: number, py: number) {
    for (const d of drops) {
      if (d.taken >= 0 || !d.landed) continue;
      const p = P(d.x, d.y, d.z + 0.1);
      if (Math.hypot(p.x - px, p.y - s * 0.16 - py) > s * 0.3) continue;
      d.taken = 0;
      bag[d.kind]++;
      onCollect(bag.wheat, bag.carrot);
    }
  }

  function puff(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) bubbles.push({ x: x + (Math.random() - 0.5) * 0.3, y, z: z + Math.random() * 0.1, vz: 0.35 + Math.random() * 0.35, phase: Math.random() * TAU, age: 0, size: Math.random() < 0.4 ? 0.22 : 0.15 });
  }

  function burst(p: Vec, colors: string[]) {
    for (let i = 0; i < 14; i++) bits.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * s * 1.6, vy: -s * (0.6 + Math.random()), color: colors[Math.floor(Math.random() * colors.length)], age: 0 });
  }

  function poke(k: Crop, now: number) {
    if (k.stage === RIPE) {
      burst(P(k.x + 0.5, k.y + 0.5, 1.4), k.kind === 'wheat' ? ['#e2c262', '#c99d36', '#a8852f'] : ['#f28a2a', '#e8761c', '#4e9f30']);
      k.stage = 0;
      drop(k);
    } else k.stage++;
    k.hop = 1;
    k.since = now;
    k.next = now + (k.stage === RIPE ? 8 + Math.random() * 4 : 1.8 + Math.random() * 1.4);
  }

  function hitAt(px: number, py: number) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const { o, a, b, tex: t, id } = hits[i];
      const det = a.x * b.y - a.y * b.x;
      if (!det) continue;
      const dx = px - o.x, dy = py - o.y;
      const u = (dx * b.y - dy * b.x) / det, v = (a.x * dy - a.y * dx) / det;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      if (t && t.alpha[Math.floor(v * t.h) * t.w + Math.floor(u * t.w)] < 8) continue;
      return id;
    }
    return null;
  }

  const toPx = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };
  let lastX: number | null = null;
  cv.addEventListener('pointermove', (e) => {
    const p = toPx(e);
    const id = hitAt(p.x, p.y);
    cv.style.cursor = id && id !== 'ground' ? 'pointer' : 'default';
    if (id !== null && id.startsWith('crop:') && lastX !== null) crops[+id.slice(5)].swayV += ((p.x - lastX) / s) * 4;
    if (id === 'water' && Math.random() < 0.12) puff(fish.x, 1.5, fish.z + 0.2, 1);
    collectNear(p.x, p.y);
    lastX = p.x;
  });
  cv.addEventListener('pointerleave', () => { lastX = null; });
  cv.addEventListener('pointerdown', (e) => {
    const p = toPx(e);
    const id = hitAt(p.x, p.y);
    const now = performance.now() / 1000;
    if (id !== null && id.startsWith('crop:')) poke(crops[+id.slice(5)], now);
    else if (id === 'sign') { signWiggle = 0.6; signHue += 120; }
    else if (id === 'water') {
      const wx = 1 + ((p.x - P(1, 1.5, 0).x) / (2 * c)) * 2;
      puff(Math.max(1.1, Math.min(2.9, wx)), 1.5, 0.3, 7);
      fish.dir = wx > fish.x ? -1 : 1;
      fish.target = Math.max(1.3, Math.min(2.7, fish.x + fish.dir * 0.9));
      fish.flee = 1;
    }
  });
  cv.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const now = performance.now() / 1000;
    for (const k of crops) poke(k, now);
  });

  let last = performance.now() / 1000;
  function frame(ms: number) {
    const now = ms / 1000, dt = Math.min(0.05, now - last);
    last = now;
    const still = reduceMotion.matches;
    const t = still ? 0 : now;

    for (const k of crops) {
      if (now > k.next && k.stage === RIPE) {
        burst(P(k.x + 0.5, k.y + 0.5, 1.3), k.kind === 'wheat' ? ['#e2c262', '#c99d36'] : ['#f28a2a', '#4e9f30']);
        drop(k);
        k.stage = 0;
        k.since = now;
        k.next = now + 1.8 + Math.random() * 1.4;
      } else if (now > k.next) {
        k.stage++;
        k.since = now;
        k.next = now + (k.stage === RIPE ? 8 + Math.random() * 4 : 1.8 + Math.random() * 1.4);
        k.hop = 1;
        for (let i = 0; i < 4; i++) bits.push({ x: P(k.x + 0.2 + Math.random() * 0.6, k.y + 0.5, 1.2).x, y: P(k.x + 0.5, k.y + 0.5, 1.1 + k.stage * 0.07).y, vx: (Math.random() - 0.5) * s * 0.6, vy: -s * 0.5, color: '#a6e36a', age: 0 });
      }
      k.swayV += (-k.sway * 40 - k.swayV * 6) * dt;
      k.sway = Math.max(-0.3, Math.min(0.3, k.sway + k.swayV * dt));
      k.hop = Math.max(0, k.hop - dt * 6);
    }
    signWiggle = Math.max(0, signWiggle - dt);
    fish.flee = Math.max(0, fish.flee - dt);
    const d = fish.target - fish.x;
    if (Math.abs(d) < 0.02) { fish.target = 1.35 + Math.random() * 1.3; fish.z = 0.2 + Math.random() * 0.35; }
    else { fish.dir = Math.sign(d); fish.x += fish.dir * Math.min(Math.abs(d), (fish.flee ? 1.4 : 0.22) * dt); }
    fish.tail += dt * (fish.flee ? 22 : 7);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    hits = [];

    for (let x = 0; x < 3; x++) block(x, 0, 0, tex.farmTop, tex.dirt, `crop:${x}`, 1 - 1 / N, 1, true, 1);
    block(0, 1, 0, tex.grassTop, tex.grassSide, 'ground', 1, 1, true, 1);
    for (const k of crops) drawCrop(k, t, now);
    updateDrops(dt);
    drawDrops();
    drawSign(t);

    for (let x = 1; x < 3; x++) quad(tex.dirt, P(x, 1, 0), sub(P(x + 1, 1, 0), P(x, 1, 0)), sub(P(x, 2, 0), P(x, 1, 0)), 0.45, 1, null);
    drawFish(t);
    pond(t);

    if (!still && Math.random() < dt * 0.5) puff(fish.x + 0.25 * fish.dir, 1.5, fish.z + 0.15, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.age += dt;
      b.z += b.vz * dt;
      if (b.z > 1.3 + b.phase * 0.08) { burst(P(b.x, b.y, b.z), ['#cdeeff']); bubbles.splice(i, 1); continue; }
      const p = P(b.x + Math.sin(b.age * 5 + b.phase) * 0.04, b.y, b.z);
      const size = b.size * s;
      ctx.drawImage(tex.bubble.canvas, Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.age += dt;
      b.vy += s * 3 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.age > 0.6) { bits.splice(i, 1); continue; }
      ctx.fillStyle = b.color;
      const sz = s / N;
      ctx.fillRect(b.x - sz / 2, b.y - sz / 2, sz, sz);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
