// Rigid bodies (planck.js) live in the plane of the shelf line; each plush image is drawn
// on a 7×9 mesh whose nodes chase the rigid pose on damped springs, so it stays soft.
import { BoxShape, EdgeShape, MouseJoint, PolygonShape, Vec2, World, type Body, type Fixture } from 'planck';
import { context2d, need } from '../lib/dom';

// Plush images share one bottom-aligned 120×150 local frame; one unit is 1 cm.
const VB_W = 120;
const VB_H = 150;
const ORIGIN = { x: 60, y: 86 }; // body origin in local units
const BOTTOM = { x: 60, y: 146 };
const HEAD_Y = 78; // local y above which a touch counts as the head
const M = 0.01; // metres per local unit
const GRAVITY = 26;
const NX = 7;
const NY = 9;
const NODES = NX * NY;

export interface Member {
  id: string;
  name: string;
  jp: string;
  color: string;
}

export interface PlushSet {
  label: string;
  members: Member[];
}

// Official Good Smile "Plushie" releases. The image for each lives at `${assets}${id}.webp`.
export const CATALOG: PlushSet[] = [
  {
    label: 'MyGO!!!!!',
    members: [
      { id: 'tomori', name: 'Tomori', jp: '高松燈', color: '#77bbdd' },
      { id: 'anon', name: 'Anon', jp: '千早愛音', color: '#ff8899' },
      { id: 'rana', name: 'Rāna', jp: '要楽奈', color: '#77dd77' },
      { id: 'soyo', name: 'Soyo', jp: '長崎そよ', color: '#ffdd88' },
      { id: 'taki', name: 'Taki', jp: '椎名立希', color: '#7777aa' },
    ],
  },
  {
    label: 'MyGO!!!!! School Uniform',
    members: [
      { id: 'tomori-uniform', name: 'Tomori', jp: '高松燈', color: '#77bbdd' },
      { id: 'anon-uniform', name: 'Anon', jp: '千早愛音', color: '#ff8899' },
      { id: 'rana-uniform', name: 'Rāna', jp: '要楽奈', color: '#77dd77' },
      { id: 'soyo-uniform', name: 'Soyo', jp: '長崎そよ', color: '#ffdd88' },
      { id: 'taki-uniform', name: 'Taki', jp: '椎名立希', color: '#7777aa' },
    ],
  },
  {
    label: 'CRYCHIC',
    members: [
      { id: 'crychic-tomori', name: 'Tomori', jp: '高松燈', color: '#77bbdd' },
      { id: 'crychic-sakiko', name: 'Sakiko', jp: '豊川祥子', color: '#7799cc' },
      { id: 'crychic-mutsumi', name: 'Mutsumi', jp: '若葉睦', color: '#99bb66' },
      { id: 'crychic-soyo', name: 'Soyo', jp: '長崎そよ', color: '#ffdd88' },
      { id: 'crychic-taki', name: 'Taki', jp: '椎名立希', color: '#7777aa' },
    ],
  },
  {
    label: 'Ave Mujica',
    members: [
      { id: 'doloris', name: 'Doloris', jp: '三角初華', color: '#e6c062' },
      { id: 'mortis', name: 'Mortis', jp: '若葉睦', color: '#99bb66' },
      { id: 'timoris', name: 'Timoris', jp: '八幡海鈴', color: '#447788' },
      { id: 'amoris', name: 'Amoris', jp: '祐天寺にゃむ', color: '#aa77cc' },
      { id: 'oblivionis', name: 'Oblivionis', jp: '豊川祥子', color: '#7799cc' },
    ],
  },
];

const MEMBERS = CATALOG.flatMap((set) => set.members);
const DEFAULT = CATALOG[0].members.map((m) => m.id);

interface Plush {
  m: Member;
  body: Body;
  el: HTMLElement;
  img: HTMLImageElement;
  mask: Uint8ClampedArray | null;
  tex: WebGLTexture | null;
  shadow: HTMLElement;
  grab: { x: number; y: number };
  dizzy: number;
  slot: number;
  scale: number; // drawn size relative to full size (grows after leaving the box)
  ghost: boolean; // flying out of the box: collides with nothing until it comes down over the desk
  pos: Float32Array;
  vel: Float32Array;
  prev: Float32Array;
  live: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toBody = (lx: number, ly: number) => new Vec2((lx - ORIGIN.x) * M, (ly - ORIGIN.y) * M);

function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = need(gl.createShader(type), 'WebGL shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = need(gl.createProgram(), 'WebGL program');
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
    in vec2 a_pos;
    in vec2 a_uv;
    uniform vec4 u_view; // offset x, offset y, width, height (css px)
    out vec2 v_uv;
    void main() {
      vec2 p = (a_pos - u_view.xy) / u_view.zw;
      gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
      v_uv = a_uv;
    }`));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    in vec2 v_uv;
    uniform sampler2D u_tex;
    out vec4 color;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));
      vec2 cell = floor(v_uv / texel);
      float a = hash(cell) * 6.2832;
      float r = hash(cell + 17.0) * 2.4;
      vec4 base = texture(u_tex, v_uv);
      vec4 fuzz = texture(u_tex, v_uv + vec2(cos(a), sin(a)) * r * texel);
      vec4 c = mix(base, fuzz, 0.55);
      float pile = 0.94 + 0.1 * hash(cell * 1.7 + 3.0);
      color = vec4(c.rgb * pile, c.a);
    }`));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const uv = new Float32Array(NODES * 2);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    uv[(j * NX + i) * 2] = i / (NX - 1);
    uv[(j * NX + i) * 2 + 1] = j / (NY - 1);
  }
  const idx: number[] = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i;
    idx.push(a, a + 1, a + NX, a + 1, a + NX + 1, a + NX);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(prog, 'a_uv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, NODES * 2 * 4, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const uView = gl.getUniformLocation(prog, 'u_view');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    texture(img: HTMLImageElement) {
      const t = need(gl.createTexture(), 'WebGL texture');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    },
    begin(view: { x: number; y: number; w: number; h: number }, dpr: number) {
      const cw = Math.round(view.w * dpr), ch = Math.round(view.h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(uView, view.x, view.y, view.w, view.h);
    },
    draw(tex: WebGLTexture, pos: Float32Array) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    },
  };
}

export function mountDesk(
  stage: HTMLElement,
  layer: HTMLElement,
  cabinet: HTMLElement,
  assets: string,
  onSay: (text: string) => void,
  onChange: (onDesk: Set<string>) => void,
  overBox: (clientX: number, clientY: number) => boolean,
) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let size = 0;
  let ppm = 1;
  let groundY = 0;
  let deskL = 0;
  let deskR = 0;
  let time = 0;
  const view = { x: 0, y: 0, w: 0, h: 0 }; // the viewport, in stage coords

  // The canvas is fixed to the viewport: plushies can be carried anywhere on screen
  // and it never adds to the page's scroll size.
  const canvas = document.createElement('canvas');
  canvas.className = 'cb-gl';
  canvas.setAttribute('aria-hidden', 'true');
  layer.append(canvas);
  const gl = createRenderer(canvas);
  if (!gl) canvas.remove();

  const world = new World({ gravity: new Vec2(0, GRAVITY) });
  const ground = world.createBody();
  let groundFixture: Fixture | null = null;
  let cabinetFixture: Fixture | null = null;
  const PLUSH = 0x0002;

  // the head is a rounded box with a flat-ish crown, like a stuffed head that gives a little
  const head = new PolygonShape([
    toBody(28, 18), toBody(44, 8), toBody(76, 8), toBody(92, 18), toBody(101, 44), toBody(95, 72), toBody(25, 72), toBody(19, 44),
  ]);
  const torso = new PolygonShape([
    toBody(30, 80), toBody(90, 80), toBody(102, 120), toBody(100, 146), toBody(20, 146), toBody(18, 120),
  ]);
  const fabric = { friction: 0.9, restitution: 0.03 };

  // textures and hit masks are loaded once per plush and kept when it goes back in the box
  const assetsById = new Map<string, Promise<{ tex: WebGLTexture | null; mask: Uint8ClampedArray; img: HTMLImageElement }>>();
  function load(m: Member) {
    let a = assetsById.get(m.id);
    if (!a) {
      const img = new Image();
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.src = `${assets}${m.id}.webp`;
      a = img.decode().then(() => {
        const c = document.createElement('canvas');
        c.width = VB_W;
        c.height = VB_H;
        const ctx = context2d(c, { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, VB_W, VB_H);
        const data = ctx.getImageData(0, 0, VB_W, VB_H).data;
        const mask = new Uint8ClampedArray(VB_W * VB_H);
        for (let j = 0; j < mask.length; j++) mask[j] = data[j * 4 + 3];
        return { tex: gl ? gl.texture(img) : null, mask, img };
      });
      assetsById.set(m.id, a);
    }
    return a;
  }

  const plushes: Plush[] = [];

  function spawn(m: Member) {
    const shadow = document.createElement('div');
    shadow.className = 'cb-shadow';
    shadow.style.setProperty('--c', m.color);
    const el = document.createElement('div');
    el.className = 'cb-plush';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${m.name} plush. Enter to boop, arrow keys to nudge.`);
    el.style.width = `${size}px`;
    el.style.height = `${(size * VB_H) / VB_W}px`;
    layer.append(shadow, el);

    // a light head on a heavy, wide bottom: sits steadily, tips over when pushed hard
    const body = world.createBody({ type: 'dynamic', linearDamping: 0.2, angularDamping: 2.6 });
    body.createFixture({ shape: head, density: 0.5, filterCategoryBits: PLUSH, ...fabric });
    body.createFixture({ shape: torso, density: 5, filterCategoryBits: PLUSH, ...fabric });
    body.setTransform(new Vec2(-100, -100), 0);
    body.setActive(false);

    const plush: Plush = {
      m, body, el, img: new Image(), shadow, mask: null, tex: null, grab: { ...ORIGIN }, dizzy: 0, scale: 1, ghost: false,
      slot: MEMBERS.indexOf(m),
      pos: new Float32Array(NODES * 2), vel: new Float32Array(NODES * 2), prev: new Float32Array(NODES * 2), live: false,
    };
    el.addEventListener('focus', () => shadow.classList.toggle('focus', el.matches(':focus-visible')));
    el.addEventListener('blur', () => shadow.classList.remove('focus'));
    el.addEventListener('keydown', (e) => keyed(plush, e));
    plushes.push(plush);
    load(m).then((a) => {
      if (!plushes.includes(plush)) return;
      plush.tex = a.tex;
      plush.mask = a.mask;
      if (!gl) el.append(a.img.cloneNode());
    }).catch(() => {});
    return plush;
  }

  function despawn(p: Plush) {
    const i = plushes.indexOf(p);
    if (i < 0) return;
    if (held === p) {
      if (joint) world.destroyJoint(joint);
      joint = null;
      held = null;
      stage.classList.remove('grabbing');
    }
    if (pat.p === p) pat.p = null;
    plushes.splice(i, 1);
    world.destroyBody(p.body);
    p.el.remove();
    p.shadow.remove();
    sortDepth();
  }

  const onDesk = () => new Set(plushes.map((p) => p.m.id));

  let order = [...plushes];

  const toScreenW = (wx: number, wy: number) => ({ x: wx * ppm, y: groundY + wy * ppm });
  const toWorld = (x: number, y: number) => new Vec2(x / ppm, (y - groundY) / ppm);

  function toScreen(p: Plush, lx: number, ly: number) {
    const w = p.body.getWorldPoint(toBody(lx, ly));
    return toScreenW(w.x, w.y);
  }

  function toLocal(p: Plush, x: number, y: number) {
    const l = p.body.getLocalPoint(toWorld(x, y));
    return { x: l.x / M + ORIGIN.x, y: l.y / M + ORIGIN.y };
  }

  function hits(p: Plush, x: number, y: number) {
    const l = toLocal(p, x, y);
    const lx = Math.floor(l.x), ly = Math.floor(l.y);
    if (lx < 0 || ly < 0 || lx >= VB_W || ly >= VB_H) return null;
    return !p.mask || p.mask[ly * VB_W + lx] > 60 ? l : null;
  }

  function pick(x: number, y: number) {
    for (let i = order.length - 1; i >= 0; i--) {
      const l = hits(order[i], x, y);
      if (l) return { p: order[i], l };
    }
    return null;
  }

  function measureView() {
    const r = stage.getBoundingClientRect();
    Object.assign(view, { x: -r.left, y: -r.top, w: document.documentElement.clientWidth, h: window.innerHeight });
  }

  function slotX(i: number, n: number) {
    const pad = 0.7;
    if (n <= 1) return (deskL + deskR) / 2;
    return deskL + pad + ((deskR - deskL - pad * 2) * i) / (n - 1);
  }

  function layout() {
    const rect = stage.getBoundingClientRect();
    const oldPpm = ppm;
    const hadLayout = W > 0;
    W = rect.width;
    H = rect.height;
    size = clamp(W * (W < 640 ? 0.14 : 0.13), 46, 130);
    ppm = size / (VB_W * M);
    const back = H * 0.5, front = H * 0.86;
    groundY = back + (front - back) * 0.55;
    const inset = W * 0.07 * (1 - 0.55);
    const cw = size * 2.05, ch = size * 2.35;
    const cabL = W - inset - cw - size * 0.15;
    Object.assign(cabinet.style, { left: `${cabL}px`, top: `${groundY - ch}px`, width: `${cw}px`, height: `${ch}px` });
    cabinet.style.setProperty('--cw', `${cw}px`);
    deskL = inset / ppm;
    deskR = cabL / ppm;
    if (groundFixture) ground.destroyFixture(groundFixture);
    groundFixture = ground.createFixture({ shape: new EdgeShape(new Vec2(deskL, 0), new Vec2((W - inset) / ppm, 0)), ...fabric });
    if (cabinetFixture) ground.destroyFixture(cabinetFixture);
    cabinetFixture = ground.createFixture({
      shape: new BoxShape(cw / ppm / 2, ch / ppm / 2, new Vec2((cabL + cw / 2) / ppm, -ch / ppm / 2)),
      ...fabric,
    });
    // keep plushies where they were on screen when the scale changes
    if (hadLayout && oldPpm !== ppm) {
      for (const p of plushes) {
        const at = p.body.getPosition();
        p.body.setTransform(new Vec2((at.x * oldPpm) / ppm, (at.y * oldPpm) / ppm), p.body.getAngle());
        p.live = false;
      }
    }
    for (const p of plushes) {
      p.el.style.width = `${size}px`;
      p.el.style.height = `${(size * VB_H) / VB_W}px`;
      p.body.setAwake(true);
    }
    measureView();
  }

  const LOCAL = Array.from({ length: NODES }, (_, n) => ({ x: ((n % NX) / (NX - 1)) * VB_W, y: (Math.floor(n / NX) / (NY - 1)) * VB_H }));

  function soften(p: Plush, dt: number) {
    const anchor = held === p ? p.grab : BOTTOM;
    const maxOff = size * 0.1;
    for (let n = 0; n < NODES; n++) {
      const l = LOCAL[n];
      const t = toScreen(p, ORIGIN.x + (l.x - ORIGIN.x) * p.scale, ORIGIN.y + (l.y - ORIGIN.y) * p.scale);
      const ix = n * 2, iy = ix + 1;
      if (!p.live) {
        p.pos[ix] = p.prev[ix] = t.x;
        p.pos[iy] = p.prev[iy] = t.y;
        p.vel[ix] = p.vel[iy] = 0;
        continue;
      }
      const tvx = (t.x - p.prev[ix]) / dt, tvy = (t.y - p.prev[iy]) / dt;
      p.prev[ix] = t.x;
      p.prev[iy] = t.y;
      const d = Math.hypot(l.x - anchor.x, l.y - anchor.y) / VB_H;
      const k = 900 + 3000 * Math.exp(-d * 3.2);
      const c = 2 * Math.sqrt(k) * 0.8;
      p.vel[ix] += (k * (t.x - p.pos[ix]) + c * (tvx - p.vel[ix])) * dt;
      p.vel[iy] += (k * (t.y - p.pos[iy]) + c * (tvy - p.vel[iy])) * dt;
      p.pos[ix] += p.vel[ix] * dt;
      p.pos[iy] += p.vel[iy] * dt;
      const ox = p.pos[ix] - t.x, oy = p.pos[iy] - t.y;
      const off = Math.hypot(ox, oy);
      if (off > maxOff) {
        p.pos[ix] = t.x + (ox / off) * maxOff;
        p.pos[iy] = t.y + (oy / off) * maxOff;
      }
    }
    p.live = true;
  }

  // nudge mesh nodes; `fn` returns a velocity (px/s) for a node given its local coords
  function poke(p: Plush, fn: (lx: number, ly: number, n: number) => [number, number] | null) {
    for (let n = 0; n < NODES; n++) {
      const v = fn(LOCAL[n].x, LOCAL[n].y, n);
      if (!v) continue;
      p.vel[n * 2] += v[0];
      p.vel[n * 2 + 1] += v[1];
    }
  }

  function render(p: Plush) {
    const o = toScreen(p, 0, 0);
    const a = p.body.getAngle();
    if (!gl) {
      const c = Math.cos(a), s = Math.sin(a);
      p.el.style.transform = `matrix(${c},${s},${-s},${c},${o.x},${o.y})`;
    } else {
      // the invisible element still tracks the plush for focus and screen readers
      p.el.style.transform = `translate(${o.x}px, ${o.y}px) rotate(${a}rad)`;
    }
    const at = p.body.getPosition();
    const lowest = toScreen(p, BOTTOM.x, BOTTOM.y).y;
    const lift = clamp((groundY - lowest) / (size * 1.4), 0, 1);
    const onDesk = at.x > deskL && at.x < deskR && lowest < groundY + size * 0.3;
    const sw = size * 0.72 * (1 - lift * 0.35);
    p.shadow.style.transform = `translate(${at.x * ppm - sw / 2}px, ${groundY - sw * 0.11}px)`;
    p.shadow.style.width = `${sw}px`;
    p.shadow.style.height = `${sw * 0.22}px`;
    p.shadow.style.opacity = String(onDesk ? 0.55 * (1 - lift * 0.8) : 0);
  }

  function sortDepth() {
    // the held plush on top, then whatever is higher up (it sits on the others)
    order = [...plushes].sort((a, b) => +(a === held) - +(b === held) || b.body.getPosition().y - a.body.getPosition().y);
    order.forEach((p, i) => { p.el.style.zIndex = String(10 + i * 2); });
  }

  function draw() {
    measureView();
    for (const p of plushes) render(p);
    if (!gl) return;
    gl.begin(view, Math.min(2, window.devicePixelRatio || 1));
    for (const p of order) if (p.tex && p.live) gl.draw(p.tex, p.pos);
  }

  let held: Plush | null = null;
  let joint: MouseJoint | null = null;
  let pid = -1;
  let down = { x: 0, y: 0, t: 0 };
  let moved = false;
  let lastMove = { x: 0, y: 0, t: 0 };
  let shakes: number[] = [];
  let shakeDir = 0;
  const pat: { p: Plush | null; dir: number; travel: number; count: number; x: number } = { p: null, dir: 0, travel: 0, count: 0, x: 0 };

  const local = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inView = (pt: { x: number; y: number }) => ({
    x: clamp(pt.x, view.x + 2, view.x + view.w - 2),
    y: clamp(pt.y, view.y + 2, view.y + view.h - 2),
  });

  stage.addEventListener('pointerdown', (e) => {
    if (held) endDrag(null);
    const pt = local(e);
    const hit = pick(pt.x, pt.y);
    if (!hit) return;
    const p = hit.p;
    e.preventDefault();
    if (p.ghost) {
      p.ghost = false;
      setGhost(p, false);
    }
    p.grab = { x: clamp(hit.l.x, 4, 116), y: clamp(hit.l.y, 4, 144) };
    held = p;
    const mass = p.body.getMass();
    joint = world.createJoint(new MouseJoint(
      { maxForce: mass * GRAVITY * 10, frequencyHz: 6, dampingRatio: 1 },
      ground, p.body, p.body.getWorldPoint(toBody(p.grab.x, p.grab.y)),
    ));
    p.body.setAngularDamping(7);
    p.body.setAwake(true);
    pid = e.pointerId;
    stage.setPointerCapture(e.pointerId);
    down = { x: pt.x, y: pt.y, t: performance.now() };
    moved = false;
    lastMove = { ...pt, t: performance.now() };
    shakes = [];
    shakeDir = 0;
    const pinch = size * 9;
    poke(p, (lx, ly, n) => {
      const w = Math.exp(-Math.hypot(lx - p.grab.x, ly - p.grab.y) / 26);
      if (w < 0.05) return null;
      return [(pt.x - p.pos[n * 2]) / size * pinch * w, (pt.y - p.pos[n * 2 + 1]) / size * pinch * w];
    });
    stage.classList.add('grabbing');
    onSay(`${p.m.name} · ${p.m.jp}`);
    sortDepth();
  });

  function hoverPat(pt: { x: number; y: number }) {
    const hit = pick(pt.x, pt.y);
    stage.classList.toggle('hovering', !!hit);
    if (!hit || hit.l.y > HEAD_Y) { pat.p = null; return; }
    if (pat.p !== hit.p) Object.assign(pat, { p: hit.p, dir: 0, travel: 0, count: 0, x: pt.x });
    const dx = pt.x - pat.x;
    pat.x = pt.x;
    if (Math.abs(dx) < 0.5) return;
    const dir = Math.sign(dx);
    pat.travel += Math.abs(dx);
    if (dir !== pat.dir) {
      if (pat.dir !== 0 && pat.travel > size * 0.06) patted(hit.p);
      pat.dir = dir;
      pat.travel = 0;
    }
  }

  function patted(p: Plush) {
    pat.count++;
    const push = size * 2;
    poke(p, (_, ly) => (ly < HEAD_Y + 10 ? [0, push * (1 - ly / (HEAD_Y + 10))] : null));
    p.body.applyLinearImpulse(new Vec2(0, p.body.getMass() * 0.4), p.body.getWorldPoint(toBody(60, 20)), true);
    if (pat.count % 3 === 0) {
      emit(p, '♡', 0.17);
      onSay(`${p.m.name} ♡`);
    }
  }

  stage.addEventListener('pointermove', (e) => {
    const pt = local(e);
    if (!held || !joint) {
      if (e.pointerType !== 'touch') hoverPat(pt);
      return;
    }
    if (e.pointerId !== pid) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastMove.t) / 1000;
    const vx = (pt.x - lastMove.x) / dt;
    lastMove = { ...pt, t: now };
    const t = inView(pt);
    joint.setTarget(toWorld(t.x, t.y));
    if (Math.hypot(pt.x - down.x, pt.y - down.y) > 5) moved = true;
    // count hard direction changes; enough of them in a second makes a plush dizzy
    if (Math.abs(vx) > size * 4) {
      const dir = Math.sign(vx);
      if (shakeDir && dir !== shakeDir) {
        shakes = [...shakes.filter((s) => now - s < 1000), now];
        if (shakes.length >= 5 && held.dizzy < 1) {
          held.dizzy = 3.2;
          onSay(`${held.m.name} @_@`);
        }
      }
      shakeDir = dir;
    }
  });

  // Without a pointer event the drag was interrupted (capture lost outside the window,
  // window blurred, tab hidden): just drop the plush where it is.
  function endDrag(e: PointerEvent | null) {
    if (!held) return;
    const p = held;
    const tap = !!e && !moved && performance.now() - down.t < 320;
    if (joint) world.destroyJoint(joint);
    joint = null;
    held = null;
    pid = -1;
    p.body.setAngularDamping(2.6);
    stage.classList.remove('grabbing');
    if (e && moved && overBox(e.clientX, e.clientY)) {
      despawn(p);
      onSay(`${p.m.name} went back in the box`);
      onChange(onDesk());
      return;
    }
    // a still hand drops the plush instead of flinging it with the joint's last pull
    if (!e || performance.now() - lastMove.t > 90) {
      const v = p.body.getLinearVelocity();
      p.body.setLinearVelocity(new Vec2(v.x * 0.3, v.y * 0.3));
    }
    if (tap) boop(p);
    sortDepth();
  }

  const release = (e: PointerEvent) => {
    if (held && e.pointerId === pid) endDrag(e);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', () => endDrag(null));
  stage.addEventListener('lostpointercapture', (e) => {
    if (held && e.pointerId === pid) endDrag(null);
  });
  window.addEventListener('blur', () => endDrag(null));
  stage.addEventListener('pointerleave', () => { pat.p = null; stage.classList.remove('hovering'); });

  function emit(p: Plush, text: string, scale: number) {
    const top = toScreen(p, 60 + (Math.random() - 0.5) * 50, 10);
    const n = document.createElement('span');
    n.className = 'cb-note';
    n.textContent = text;
    n.style.color = p.m.color;
    n.style.left = `${top.x}px`;
    n.style.top = `${top.y}px`;
    n.style.setProperty('--dx', `${(Math.random() - 0.5) * size * 0.6}px`);
    n.style.setProperty('--r', `${(Math.random() - 0.5) * 40}deg`);
    n.style.fontSize = `${size * scale}px`;
    n.addEventListener('animationend', () => n.remove());
    layer.append(n);
  }

  const NOTES = ['♪', '♫', '♩', '♡'];
  function boop(p: Plush) {
    const mass = p.body.getMass();
    const hop = reduceMotion ? 2.5 : 4.2;
    p.body.applyLinearImpulse(new Vec2(0, -mass * hop), p.body.getWorldPoint(toBody(60 + (Math.random() - 0.5) * 16, 110)), true);
    poke(p, (_, ly) => [0, size * 2.5 * (1 - ly / VB_H)]);
    onSay(`${p.m.name} · ${p.m.jp}`);
    emit(p, NOTES[Math.floor(Math.random() * NOTES.length)], 0.2);
  }

  function keyed(p: Plush, e: KeyboardEvent) {
    const nudges: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      boop(p);
    } else if (e.key in nudges) {
      e.preventDefault();
      const mass = p.body.getMass();
      p.body.applyLinearImpulse(new Vec2(nudges[e.key] * mass * 1.6, -mass * 2.4), p.body.getWorldPoint(toBody(60, 120)), true);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      despawn(p);
      onChange(onDesk());
    }
  }

  function drop(p: Plush, x: number, height: number, delay: number) {
    const go = () => {
      if (held === p || !plushes.includes(p)) return;
      p.body.setActive(true);
      p.body.setTransform(new Vec2(x, -height), (Math.random() - 0.5) * 0.06);
      p.body.setLinearVelocity(new Vec2(0, 0));
      p.body.setAngularVelocity(0);
      p.body.setAwake(true);
      p.live = false;
    };
    if (delay > 0 && !reduceMotion) setTimeout(go, delay);
    else go();
  }

  // metres from the shelf line up to just above the top of the screen
  const sky = () => (groundY - view.y) / ppm + 1;

  function lineUp() {
    // lift everyone off the desk at once (only the heights differ), so nobody lands
    // on a plush that has not left its spot yet
    [...plushes].sort((a, b) => a.slot - b.slot).forEach((p, i) => drop(p, slotX(i, plushes.length), sky() + (i % 3) * 0.35, 0));
  }

  // a free spot on the desk: the widest gap between plushies already sitting there
  function freeX() {
    const xs = plushes.map((p) => p.body.getPosition().x).filter((x) => x > deskL && x < deskR).sort((a, b) => a - b);
    const edges = [deskL + 0.6, ...xs, deskR - 0.6];
    let best = (deskL + deskR) / 2, gap = -1;
    for (let i = 0; i < edges.length - 1; i++) {
      const g = edges[i + 1] - edges[i];
      if (g > gap) { gap = g; best = (edges[i] + edges[i + 1]) / 2; }
    }
    return best;
  }

  // A plush drawn by the claw starts where the toy was on screen, at the toy's size,
  // and is tossed onto the desk, growing to full size on the way.
  function launch(id: string, rect: DOMRect, angle: number, spin: number) {
    const m = MEMBERS.find((x) => x.id === id);
    if (!m) return;
    const p = spawn(m);
    const r = stage.getBoundingClientRect();
    const sx = rect.left + rect.width / 2 - r.left;
    const sy = rect.top + rect.height * 0.3 - r.top;
    const from = toWorld(sx, sy);
    // aim loosely so no two throws land the same
    const x = clamp(freeX() + (Math.random() - 0.5) * 1.6, deskL + 0.5, deskR - 0.6);
    const to = new Vec2(x, -(BOTTOM.y - ORIGIN.y) * M);
    const t = (reduceMotion ? 0.45 : 0.75) + Math.random() * 0.35;
    p.scale = rect.width / size;
    p.ghost = true;
    setGhost(p, true);
    p.body.setActive(true);
    p.body.setTransform(from, angle);
    p.body.setLinearVelocity(new Vec2((to.x - from.x) / t, (to.y - from.y) / t - 0.5 * GRAVITY * t));
    // keep the swing it left the claw with, plus a tumble
    p.body.setAngularVelocity(-Math.abs(spin) * 0.5 - 1.5 - Math.random() * 4);
    p.body.setAwake(true);
    p.live = false;
    onSay(`${m.name} · ${m.jp}`);
    onChange(onDesk());
  }

  function setGhost(p: Plush, on: boolean) {
    for (let f = p.body.getFixtureList(); f; f = f.getNext()) {
      f.setFilterData({ groupIndex: 0, categoryBits: PLUSH, maskBits: on ? 0 : 0xffff });
    }
  }

  const STEP = 1 / 120;
  let acc = 0;

  function step(dt: number) {
    time += dt;
    for (const p of plushes) {
      p.scale += (1 - p.scale) * Math.min(1, dt * 4.5);
      if (p.ghost) {
        const at = p.body.getPosition(), v = p.body.getLinearVelocity();
        if (v.y > 0 && at.x < deskR - 0.5 && at.y < -1.1) {
          p.ghost = false;
          setGhost(p, false);
        }
      }
      p.dizzy = Math.max(0, p.dizzy - dt);
      if (p.dizzy > 0 && p !== held) {
        p.body.applyAngularImpulse(Math.sin(time * 7) * p.body.getMass() * 0.02 * Math.min(1, p.dizzy), true);
      }
    }
    // speed limits, so a plush in hand can't ram the others and nothing spins wildly
    for (const p of plushes) {
      const v = p.body.getLinearVelocity();
      const vmax = p === held ? 10 : 16;
      const sp = Math.hypot(v.x, v.y);
      if (sp > vmax) p.body.setLinearVelocity(new Vec2((v.x / sp) * vmax, (v.y / sp) * vmax));
      const wmax = p === held ? 6 : 10;
      const w = p.body.getAngularVelocity();
      if (Math.abs(w) > wmax) p.body.setAngularVelocity(Math.sign(w) * wmax);
    }
    world.step(dt, 8, 3);
    // anything that left the screen goes back in the box
    const bottom = (view.y + view.h - groundY) / ppm + 1.5;
    const gone_: Plush[] = [];
    for (const p of plushes) {
      const at = p.body.getPosition();
      const gone = at.y > bottom || at.x < view.x / ppm - 3 || at.x > (view.x + view.w) / ppm + 3;
      if (p !== held && gone) gone_.push(p);
      else soften(p, dt);
    }
    for (const p of gone_) {
      despawn(p);
      onSay(`${p.m.name} fell off the desk, back in the box`);
    }
    if (gone_.length) onChange(onDesk());
  }

  let prev = performance.now();
  let raf = 0;
  function tick(now: number) {
    acc += Math.min(0.05, (now - prev) / 1000);
    prev = now;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    sortDepth();
    draw();
    raf = requestAnimationFrame(tick);
  }

  layout();
  DEFAULT.forEach((id, i) => {
    const p = spawn(need(MEMBERS.find((m) => m.id === id), `member ${id}`));
    const x = slotX(i, DEFAULT.length) + (Math.random() - 0.5) * 0.1;
    p.body.setActive(true);
    if (reduceMotion) p.body.setTransform(new Vec2(x, -0.62), 0);
    else p.body.setTransform(new Vec2(x, -sky() - 0.2 - i * 0.5), (Math.random() - 0.5) * 0.06);
  });
  onChange(onDesk());
  new ResizeObserver(() => layout()).observe(stage);
  window.addEventListener('resize', () => layout());
  sortDepth();
  raf = requestAnimationFrame(tick);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      endDrag(null);
      cancelAnimationFrame(raf);
    }
    else { prev = performance.now(); raf = requestAnimationFrame(tick); }
  });

  return { lineUp, launch };
}
