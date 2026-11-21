// Pixel Grove: three rigged pixel trees that sway, shake and shed.
// Tree data (palette, sheets, bone rig, hit spans) lives in public/lab/*.json.
import { context2d, need } from '../lib/dom';

type Range = [number, number];

interface TreeData {
  palette: [number, number, number][];
  groundTop: number;
  groundRows: number[];
  bendTop: number;
  bendBase: number;
  motion: {
    fall: Range; arm: Range; swing: Range; period: Range; lift: Range;
    airy: number; swirl: number; flip: number;
    sway: { freq: number; tip: number };
  };
  shake: Shake;
  /** [row, from, to] horizontal hit spans */
  hit: [number, number, number][];
  sheets: {
    name: string; factor: number; lag: number; detach: boolean;
    /** flat [x, y, paletteIndex, pieceIndex] */
    px: number[];
    pieces: { cx: number; cy: number; edge: number }[];
  }[];
  rig: {
    /** flat [x, y, _, _, parent, width, depth] per bone */
    bones: number[];
    /** flat [x, y, bone] per node */
    nodes: number[];
    /** per-pixel node index for wood sheets */
    wood: Partial<Record<string, number[]>>;
    /** per-piece skin weights, flat [node, weight, ...] */
    pieces: Partial<Record<string, number[][]>>;
  };
}

interface Shake { share: number; min: number; max: number }

interface Piece {
  cx: number; cy: number; edge: number; skin: number[];
  on: boolean; back: number; grown: number; px: number[];
}

interface Sheet {
  name: string; factor: number; lag: number; detach: boolean; count: number;
  x: Int16Array; y: Int16Array; c: Uint32Array; piece: Int32Array; pieces: Piece[];
  node: Int32Array | null; pdx: Int8Array; pdy: Int8Array; moves: boolean;
}

interface Disp { x: Float32Array; y: Float32Array }

interface Tree {
  name: TreeName; data: TreeData;
  bones: { x0: Float32Array; y0: Float32Array; parent: Int16Array; w: Float32Array; depth: Float32Array; phase: Float32Array };
  nodes: { x: Float32Array; y: Float32Array; bone: Int16Array };
  sheets: Sheet[]; hit: Map<number, Range[]>; motion: TreeData['motion']; shake: Shake;
  minX: number; maxX: number; minY: number; maxY: number; ox: number; oy: number;
  lags: number[]; disp: Map<number, Disp>;
  energy: number; hitAt: number; lastHit: number; nextShed: number; height: number;
  angle: Float32Array; boneGain: Float32Array; unit: number;
}

interface Falling {
  tree: Tree; x: number; y: number; dx: number[]; dy: number[]; c: number[]; maxDy: number;
  vx: number; vy: number; term: number; arm: number; swing: number; period: number;
  phase: number; age: number; swirl: number; flip: number;
}

interface Landed { x: number[]; y: number[]; c: number[]; until: number; seed: number }

const NAMES = ['cherry', 'bush', 'maple'] as const;
type TreeName = (typeof NAMES)[number];
const TAU = Math.PI * 2;
const GAP = 6, TOP = 8, BOTTOM = 2;
const SHED_RATE: Record<TreeName, number> = { cherry: 0.7, bush: 0.12, maple: 0.35 };

const hash = (i: number, s: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const between = ([a, b]: Range) => a + Math.random() * (b - a);

const fkCos = new Float32Array(256), fkSin = new Float32Array(256), fkSx = new Float32Array(256), fkSy = new Float32Array(256), fkPhi = new Float32Array(256);
function solve(tree: Pick<Tree, 'bones' | 'nodes' | 'data'>, angle: Float32Array, out: Disp) {
  const { bones, nodes } = tree, nb = bones.parent.length;
  for (let b = 0; b < nb; b++) {
    const p = bones.parent[b];
    if (p < 0) { fkPhi[b] = angle[b]; fkSx[b] = bones.x0[b]; fkSy[b] = bones.y0[b]; }
    else {
      fkPhi[b] = fkPhi[p] + angle[b];
      const rx = bones.x0[b] - bones.x0[p], ry = bones.y0[b] - bones.y0[p];
      fkSx[b] = fkSx[p] + fkCos[p] * rx - fkSin[p] * ry;
      fkSy[b] = fkSy[p] + fkSin[p] * rx + fkCos[p] * ry;
    }
    fkCos[b] = Math.cos(fkPhi[b]); fkSin[b] = Math.sin(fkPhi[b]);
  }
  const base = tree.data.bendBase;
  for (let n = 0; n < nodes.x.length; n++) {
    const b = nodes.bone[n], rx = nodes.x[n] - bones.x0[b], ry = nodes.y[n] - bones.y0[b];
    const k = nodes.y[n] >= base ? 0 : 1;
    out.x[n] = (fkSx[b] + fkCos[b] * rx - fkSin[b] * ry - nodes.x[n]) * k;
    out.y[n] = (fkSy[b] + fkSin[b] * rx + fkCos[b] * ry - nodes.y[n]) * k;
  }
}

function buildTree(data: TreeData, name: TreeName): Tree {
  const pal = data.palette.map(([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
  const bs = data.rig.bones, nb = bs.length / 7;
  const bones = { x0: new Float32Array(nb), y0: new Float32Array(nb), parent: new Int16Array(nb), w: new Float32Array(nb), depth: new Float32Array(nb), phase: new Float32Array(nb) };
  for (let b = 0; b < nb; b++) {
    bones.x0[b] = bs[b * 7]; bones.y0[b] = bs[b * 7 + 1];
    bones.parent[b] = bs[b * 7 + 4]; bones.w[b] = bs[b * 7 + 5]; bones.depth[b] = bs[b * 7 + 6];
    bones.phase[b] = hash(b, 11) * TAU;
  }
  const ns = data.rig.nodes, nn = ns.length / 3;
  const nodes = { x: new Float32Array(nn), y: new Float32Array(nn), bone: new Int16Array(nn) };
  for (let n = 0; n < nn; n++) { nodes.x[n] = ns[n * 3]; nodes.y[n] = ns[n * 3 + 1]; nodes.bone[n] = ns[n * 3 + 2]; }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const sheets = data.sheets.map((s): Sheet => {
    const count = s.px.length / 4;
    const x = new Int16Array(count), y = new Int16Array(count), c = new Uint32Array(count), piece = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      x[i] = s.px[i * 4]; y[i] = s.px[i * 4 + 1]; c[i] = pal[s.px[i * 4 + 2]]; piece[i] = s.px[i * 4 + 3];
      if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];
    }
    // Only sheets that shed (leaves, petals) are cut into pieces, and those always carry skin weights.
    const skins = s.pieces.length === 0 ? [] : need(data.rig.pieces[s.name], `skin weights for ${name}/${s.name}`);
    const pieces = s.pieces.map((p, k): Piece => ({ cx: p.cx, cy: p.cy, edge: p.edge, skin: skins[k], on: true, back: 0, grown: 1, px: [] }));
    for (let i = 0; i < count; i++) if (piece[i] >= 0) pieces[piece[i]].px.push(i);
    const woodMap = data.rig.wood[s.name];
    return {
      name: s.name, factor: s.factor, lag: s.lag, detach: s.detach, count, x, y, c, piece, pieces,
      node: woodMap ? Int32Array.from(woodMap) : null,
      pdx: new Int8Array(pieces.length), pdy: new Int8Array(pieces.length),
      moves: s.factor > 0,
    };
  });
  const hit = new Map<number, Range[]>();
  for (const [row, a, b] of data.hit) {
    const spans = hit.get(row);
    if (spans) spans.push([a, b]); else hit.set(row, [[a, b]]);
  }

  const lags = [...new Set(sheets.filter((s) => s.moves).map((s) => s.lag))];
  const disp = new Map<number, Disp>();
  for (const lag of lags) disp.set(lag, { x: new Float32Array(nn), y: new Float32Array(nn) });
  const angle = new Float32Array(nb), boneGain = new Float32Array(nb);
  for (let b = 0; b < nb; b++) boneGain[b] = 1 / (bones.w[b] + 1.2);
  // Normalise so a unit lean moves the tallest node by exactly one pixel.
  for (let b = 0; b < nb; b++) angle[b] = boneGain[b] * 0.001;
  const probe = { x: new Float32Array(nn), y: new Float32Array(nn) };
  solve({ bones, nodes, data }, angle, probe);
  let reach = 0;
  for (let n = 0; n < nn; n++) reach = Math.max(reach, Math.abs(probe.x[n]));
  return {
    name, data, bones, nodes, sheets, hit, motion: data.motion, shake: data.shake,
    minX, maxX, minY, maxY, ox: 0, oy: 0, lags, disp, energy: 0, hitAt: -10, lastHit: -10, nextShed: 0,
    height: data.bendBase - data.bendTop, angle, boneGain, unit: 0.001 / Math.max(1e-6, reach),
  };
}

export async function mountGrove(cv: HTMLCanvasElement, stage: HTMLElement, hint: HTMLElement) {
  const src = need(cv.dataset.src, 'data-src on the grove canvas');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let datas: TreeData[];
  try {
    datas = await Promise.all(NAMES.map((n) => fetch(`${src}${n}.json`).then((r): Promise<TreeData> => {
      if (!r.ok) throw new Error(`${n}.json ${r.status}`);
      return r.json();
    })));
  } catch (error) {
    hint.textContent = 'The trees failed to load. Try refreshing.';
    console.error(error);
    return;
  }

  const trees = datas.map((d, i) => buildTree(d, NAMES[i]));

  const groundLine = Math.max(...trees.map((t) => t.data.groundTop));
  let cursor = 0, below = 0, above = 0;
  for (const t of trees) {
    t.ox = cursor - t.minX;
    t.oy = groundLine - t.data.groundTop;
    cursor = t.ox + t.maxX + 1 + GAP;
    above = Math.max(above, t.data.groundTop - t.minY);
    below = Math.max(below, t.maxY - t.data.groundTop);
  }
  const W = cursor - GAP, H = TOP + above + below + 1 + BOTTOM;
  for (const t of trees) t.oy += TOP + above - groundLine;
  cv.width = W; cv.height = H;
  const ctx = context2d(cv, {});
  const image = ctx.createImageData(W, H);
  const buf = new Uint32Array(image.data.buffer);

  function fit() {
    const dpr = devicePixelRatio || 1;
    const avail = stage.clientWidth * dpr;
    const k = Math.max(1, Math.floor(avail / W)) / dpr;
    const scale = avail >= W ? k : stage.clientWidth / W;
    cv.style.width = `${W * scale}px`;
    cv.style.height = `${H * scale}px`;
  }
  fit();
  new ResizeObserver(fit).observe(stage);

  const groundAt = (tree: Tree, x: number) => {
    const lx = Math.round(x - tree.ox), rows = tree.data.groundRows;
    const g = lx >= 0 && lx < rows.length && rows[lx] >= 0 ? rows[lx] : tree.data.groundTop + 6;
    return Math.min(H - 1 - BOTTOM, g + tree.oy);
  };

  const falling: Falling[] = [];
  const landed: Landed[] = [];

  function detach(tree: Tree, sheet: Sheet, piece: Piece, now: number, power: number) {
    piece.on = false;
    piece.grown = 0;
    piece.back = now + 7 + Math.random() * 9;
    const m = tree.motion, k = sheet.pieces.indexOf(piece);
    const ox = tree.ox + sheet.pdx[k], oy = tree.oy + sheet.pdy[k];
    let maxDy = 0;
    const dx: number[] = [], dy: number[] = [], c: number[] = [];
    for (const i of piece.px) {
      const ddx = sheet.x[i] - piece.cx, ddy = sheet.y[i] - piece.cy;
      dx.push(ddx); dy.push(ddy); c.push(sheet.c[i]);
      if (ddy > maxDy) maxDy = ddy;
    }
    falling.push({
      tree, x: piece.cx + ox, y: piece.cy + oy, dx, dy, c, maxDy,
      vx: (Math.random() - 0.5) * 14 * power, vy: -between(m.lift) * power * (0.4 + Math.random() * 0.6),
      term: between(m.fall) * 6 / Math.max(0.6, m.airy), arm: between(m.arm) * 0.55, swing: between(m.swing),
      period: between(m.period), phase: Math.random() * TAU, age: 0, swirl: m.swirl, flip: m.flip,
    });
  }

  function candidates(tree: Tree) {
    const out: { sheet: Sheet; piece: Piece }[] = [];
    for (const sheet of tree.sheets) {
      if (!sheet.detach) continue;
      const deep = sheet.name === 'core';
      for (const piece of sheet.pieces) if (piece.on && piece.grown >= 1 && (!deep || piece.edge > 0.75)) out.push({ sheet, piece });
    }
    return out;
  }

  /** `at` is where it was poked, in tree coordinates; null shakes it from the middle of the crown. */
  function shakeTree(tree: Tree, power: number, now: number, at: { x: number; y: number } | null) {
    tree.energy = Math.min(1.6, tree.energy * Math.exp(-(now - tree.hitAt) * 2.2) + power);
    tree.hitAt = now;
    tree.lastHit = now;
    const pool = candidates(tree);
    const { share, min, max } = tree.shake;
    const n = Math.round(Math.min(max, Math.max(min, pool.length * share)) * power * (0.35 + Math.random() * 0.25));
    const cx = at ? at.x : (tree.minX + tree.maxX) / 2, cy = at ? at.y : tree.data.groundTop * 0.45;
    const reach = (tree.maxX - tree.minX) * 0.35;
    const scored = pool.map((p) => {
      const d = Math.hypot(p.piece.cx - cx, p.piece.cy - cy) / reach;
      return { p, s: Math.random() * (0.25 + p.piece.edge) * Math.exp(-d * d) };
    }).sort((a, b) => b.s - a.s);
    for (let i = 0; i < n && i < scored.length; i++) detach(tree, scored[i].p.sheet, scored[i].p.piece, now, 0.6 + power * 0.6);
  }

  const toLocal = (event: PointerEvent) => {
    const rect = cv.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  };
  const treeAt = (x: number, y: number) => {
    for (const t of trees) {
      const spans = t.hit.get(Math.floor(y - t.oy));
      const lx = x - t.ox;
      if (spans && spans.some(([a, b]) => lx >= a - 1 && lx <= b + 1)) return { tree: t, lx, ly: y - t.oy };
    }
    return null;
  };
  let pressed = false;
  const poke = (event: PointerEvent, power: number) => {
    const p = toLocal(event), found = treeAt(p.x, p.y);
    cv.style.cursor = found ? 'pointer' : 'default';
    if (!found || !power) return;
    const now = performance.now() / 1000;
    if (now - found.tree.lastHit < 0.12) return;
    shakeTree(found.tree, power, now, { x: found.lx, y: found.ly });
  };
  cv.addEventListener('pointerdown', (e) => { pressed = true; cv.setPointerCapture(e.pointerId); poke(e, 1); });
  cv.addEventListener('pointermove', (e) => poke(e, pressed ? 0.35 : 0));
  cv.addEventListener('pointerup', () => { pressed = false; });
  cv.addEventListener('pointercancel', () => { pressed = false; });
  cv.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const now = performance.now() / 1000;
    for (const t of trees) shakeTree(t, 1, now, null);
  });

  const put = (x: number, y: number, c: number) => { if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = c; };

  function pose(tree: Tree, now: number, still: boolean) {
    const { bones } = tree, nb = bones.parent.length;
    const freq = tree.motion.sway.freq, tip = tree.motion.sway.tip;
    const idle = still ? 0 : tip * tree.height * 0.22;
    const since = now - tree.hitAt;
    if (since > 4) tree.energy = 0;
    const kick = tree.energy * tip * tree.height * 0.75;
    for (const lag of tree.lags) {
      const t = now - lag, s = since - lag;
      for (let b = 0; b < nb; b++) {
        const d = bones.depth[b] * 0.22;
        const breeze = 0.35 + 0.65 * Math.sin(TAU * freq * t - d + bones.phase[b] * 0.08) + 0.25 * Math.sin(TAU * freq * 2.7 * t + bones.phase[b]);
        const jolt = s > 0 ? Math.sin(TAU * 2.1 * s - d * 1.4) * Math.exp(-s * 2.2) : 0;
        tree.angle[b] = tree.boneGain[b] * tree.unit * (idle * breeze + kick * jolt);
      }
      solve(tree, tree.angle, need(tree.disp.get(lag), `displacement for lag ${lag}`));
    }
  }

  function drawTree(tree: Tree, now: number) {
    for (const sheet of tree.sheets) {
      const { x, y, c, piece, pieces, node, pdx, pdy } = sheet;
      const d = sheet.moves ? tree.disp.get(sheet.lag) : null;
      if (d) for (let k = 0; k < pieces.length; k++) {
        const s = pieces[k].skin;
        let sx = 0, sy = 0, sw = 0;
        for (let j = 0; j < s.length; j += 2) { sx += d.x[s[j]] * s[j + 1]; sy += d.y[s[j]] * s[j + 1]; sw += s[j + 1]; }
        pdx[k] = Math.round((sx / sw) * sheet.factor);
        pdy[k] = Math.round((sy / sw) * sheet.factor);
        const p = pieces[k];
        if (!p.on && now > p.back) { p.on = true; p.back = now; }
        if (p.on && p.grown < 1) p.grown = Math.min(1, (now - p.back) / 0.7);
      }
      const ox = tree.ox, oy = tree.oy;
      for (let i = 0; i < sheet.count; i++) {
        let dx = 0, dy = 0;
        const k = piece[i];
        if (k >= 0 && pieces.length) {
          const p = pieces[k];
          if (!p.on || (p.grown < 1 && hash(i, 3) > p.grown)) continue;
          dx = pdx[k]; dy = pdy[k];
        } else if (node && d) {
          const n = node[i];
          dx = Math.round(d.x[n] * sheet.factor); dy = Math.round(d.y[n] * sheet.factor);
        }
        put(x[i] + ox + dx, y[i] + oy + dy, c[i]);
      }
    }
  }

  let last = performance.now() / 1000;
  function frame(ms: number) {
    const now = ms / 1000, dt = Math.min(0.05, now - last);
    last = now;
    const still = reduceMotion.matches;
    buf.fill(0);

    for (const t of trees) {
      pose(t, now, still);
      if (!still && now > t.nextShed) {
        if (t.nextShed) {
          const pool = candidates(t).filter((p) => p.piece.edge > 0.6);
          if (pool.length) { const p = pool[Math.floor(Math.random() * pool.length)]; detach(t, p.sheet, p.piece, now, 0.15); }
        }
        t.nextShed = now + (-Math.log(1 - Math.random()) / SHED_RATE[t.name]);
      }
    }
    for (let i = landed.length - 1; i >= 0; i--) {
      const l = landed[i];
      const fade = (now - l.until) / 1.5;
      if (fade >= 1) { landed.splice(i, 1); continue; }
      for (let j = 0; j < l.x.length; j++) if (fade < 0 || hash(j, l.seed) > fade) put(l.x[j], l.y[j], l.c[j]);
    }
    for (const t of trees) drawTree(t, now);

    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.age += dt;
      f.vy += (f.term - f.vy) * Math.min(1, dt * 1.4);
      f.vx *= Math.exp(-dt * 1.5);
      f.x += (f.vx + 2.5) * dt;
      f.y += f.vy * dt;
      const w = TAU * f.age / f.period + f.phase;
      const swayX = Math.sin(w) * f.arm * Math.min(1, f.age * 1.5);
      const orbit = f.swirl ? f.swirl * 0.18 : 0;
      const px = f.x + swayX + Math.cos(w * 2.6) * orbit, py = f.y + Math.sin(w * 2.6) * orbit * 0.6;
      const turn = Math.cos(w * f.swing);
      const sx = f.flip ? (Math.abs(turn) < 0.2 ? 0.2 * Math.sign(turn || 1) : turn) : Math.max(0.45, Math.abs(turn));
      const g = groundAt(f.tree, px);
      if (py + f.maxDy >= g - 1) {
        const xs: number[] = [], ys: number[] = [], cs: number[] = [];
        for (let j = 0; j < f.dx.length; j++) {
          const lx = Math.round(px + f.dx[j] * (f.flip ? Math.sign(sx) : 1));
          xs.push(lx); ys.push(groundAt(f.tree, lx) - 1 - Math.floor((f.maxDy - f.dy[j]) * 0.4)); cs.push(f.c[j]);
        }
        landed.push({ x: xs, y: ys, c: cs, until: now + 10 + Math.random() * 12, seed: Math.floor(Math.random() * 1e6) });
        if (landed.length > 400) landed.splice(0, 1);
        falling.splice(i, 1);
        continue;
      }
      if (px < -20 || px > W + 20) { falling.splice(i, 1); continue; }
      for (let j = 0; j < f.dx.length; j++) put(Math.round(px + f.dx[j] * sx), Math.round(py + f.dy[j]), f.c[j]);
    }

    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(frame);
  }
  hint.textContent = 'Poke a tree, or press and drag across them.';
  requestAnimationFrame(frame);
}
