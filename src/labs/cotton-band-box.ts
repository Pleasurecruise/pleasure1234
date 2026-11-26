// The Cotton Band toy box: a claw machine on the desk. "Draw" grabs a random plush
// from the pile and hands it to the desk, which tosses it out of the cabinet.
import { find, need } from '../lib/dom';

export interface BoxMember {
  id: string;
  name: string;
}

interface Toy {
  m: BoxMember;
  el: HTMLImageElement;
  x: number; // centre x in the glass
  y: number; // top y in the glass
  r: number;
  z: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

export function mountBox(
  cabinet: HTMLElement,
  assets: string,
  onDraw: (m: BoxMember, rect: DOMRect, angle: number, spin: number) => void,
  onEmpty: () => void,
) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  cabinet.innerHTML = `
    <div class="cab-glass">
      <svg class="cab-claw" aria-hidden="true"></svg>
      <div class="cab-pile"></div>
      <div class="cab-shine"></div>
    </div>
    <div class="cab-panel">
      <span class="cab-count"></span>
      <button type="button" class="cab-draw" aria-label="Draw a random plushie from the box">draw</button>
    </div>`;
  const glass = find(cabinet, '.cab-glass', HTMLElement);
  const svg = find(cabinet, '.cab-claw', SVGSVGElement);
  const pile = find(cabinet, '.cab-pile', HTMLElement);
  const count = find(cabinet, '.cab-count', HTMLElement);
  const button = find(cabinet, '.cab-draw', HTMLButtonElement);

  let gw = 0;
  let gh = 0;
  let tw = 0;
  let th = 0;
  const toys = new Map<string, Toy>();
  let inBox: BoxMember[] = [];

  const claw = { x: 0, vx: 0, tx: 0, len: 0, open: 0.6, swing: 0, vswing: 0 };
  let carry: Toy | null = null;
  let busy = false;
  const railY = () => gh * 0.05;
  const restLen = () => gh * 0.14;
  const homeX = () => gw * 0.8;
  const ck = () => gw / 105;

  function layoutPile() {
    tw = gw * 0.38;
    th = tw * 1.25;
    // a heap, not a grid: mix the order, overlap a lot, and let each row sink into the one below
    const list = [...inBox].sort((a, b) => hash(a.id) - hash(b.id));
    const perRow = Math.max(2, Math.round((gw - tw * 0.3) / (tw * 0.62)));
    list.forEach((m, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const span = gw - tw * 0.7;
      const step = perRow > 1 ? span / (perRow - 1) : 0;
      const x = tw * 0.35 + col * step + (row % 2 ? step * 0.5 : 0) + (hash(m.id + 'x') - 0.5) * step * 0.35;
      const y = gh - th * 0.92 - row * th * 0.24 + (hash(m.id + 'y') - 0.5) * th * 0.1;
      const r = (hash(m.id + 'r') - 0.5) * 34;
      let t = toys.get(m.id);
      if (!t) {
        const el = new Image();
        el.src = `${assets}${m.id}.webp`;
        el.alt = '';
        el.draggable = false;
        el.className = 'cab-toy';
        pile.append(el);
        t = { m, el, x, y: -th, r, z: 0 };
        toys.set(m.id, t);
        place(t, t.x, t.y, t.r);
        void el.offsetWidth;
      }
      Object.assign(t, { x: Math.min(gw - tw * 0.3, x), y, r, z: 100 - row * 10 + col });
      if (t !== carry) place(t, t.x, t.y, t.r);
    });
    for (const [id, t] of toys) {
      if (!inBox.some((m) => m.id === id) && t !== carry) {
        t.el.remove();
        toys.delete(id);
      }
    }
    count.textContent = `${inBox.length} in the box`;
    button.disabled = busy || inBox.length === 0;
  }

  function place(t: Toy, dx: number, dy: number, r: number) {
    t.el.style.width = `${tw}px`;
    t.el.style.height = `${th}px`;
    t.el.style.zIndex = String(t.z);
    t.el.style.transform = `translate(${dx - tw / 2}px, ${dy}px) rotate(${r}deg)`;
  }

  function measure() {
    const r = glass.getBoundingClientRect();
    gw = r.width;
    gh = r.height;
    svg.setAttribute('viewBox', `0 0 ${gw} ${gh}`);
    if (!busy) {
      claw.x = claw.tx = homeX();
      claw.len = restLen();
    }
    layoutPile();
    drawClaw();
  }

  function drawClaw() {
    const k = ck();
    const ry = railY();
    const top = ry + 5 * k;
    const hub = top + claw.len;
    const turns = Math.max(4, Math.round(claw.len / (5 * k)));
    let d = `M ${claw.x} ${top}`;
    for (let i = 1; i <= turns; i++) d += ` L ${claw.x + (i % 2 ? 3.2 : -3.2) * k} ${top + (claw.len * i) / (turns + 1)}`;
    d += ` L ${claw.x} ${hub}`;
    const open = claw.open;
    // two curved hooks: closed they hug the sides of a toy's head, open they spread wide
    const prong = (side: number) => {
      const x = claw.x;
      const sx = side * (8 + open * 6) * k, sy = hub + 6 * k; // shoulder
      const ex = side * (14 + open * 9) * k, ey = hub + 15 * k; // elbow
      const tx = side * (10 + open * 11) * k, ty = hub + 22 * k; // tip, hooked inward
      return `M ${x} ${hub + 1 * k} Q ${x + side * 3 * k} ${hub + 3 * k} ${x + sx} ${sy} Q ${x + ex + side * 1.5 * k} ${hub + 9 * k} ${x + ex} ${ey} L ${x + tx} ${ty}`;
    };
    svg.innerHTML = `
      <line x1="${10 * k}" y1="${ry}" x2="${gw - 10 * k}" y2="${ry}" class="rail" stroke-width="${3 * k}"/>
      <rect x="${claw.x - 9 * k}" y="${ry - 4 * k}" width="${18 * k}" height="${9 * k}" rx="${4 * k}" class="carriage"/>
      <path d="${d}" class="spring" stroke-width="${1.6 * k}"/>
      <rect x="${claw.x - 5 * k}" y="${hub - 3 * k}" width="${10 * k}" height="${3 * k}" rx="${1.5 * k}" class="band"/>
      <path d="${prong(-1)} ${prong(1)}" class="prong" stroke-width="${2.4 * k}"/>
      <circle cx="${claw.x}" cy="${hub + 2 * k}" r="${3.6 * k}" class="hub"/>`;
    if (carry) {
      carry.el.style.transformOrigin = `50% 4%`;
      place(carry, claw.x, hub + 4 * k - th * 0.04, claw.swing);
    }
  }

  const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

  async function tween(fn: (t: number) => void, ms: number) {
    const dur = reduceMotion ? Math.min(ms, 120) : ms;
    const start = performance.now();
    for (;;) {
      const now = await frame();
      const t = Math.min(1, (now - start) / dur);
      fn(t);
      drawClaw();
      if (t >= 1) return;
    }
  }
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  // move along the rail on a damped spring; the carried toy swings from the acceleration
  async function travel(to: number, stiffness: number) {
    claw.tx = to;
    let prev = performance.now();
    for (;;) {
      const now = await frame();
      const dt = Math.min(0.033, (now - prev) / 1000);
      prev = now;
      const k = reduceMotion ? 400 : stiffness, c = 2 * Math.sqrt(k);
      const ax = k * (claw.tx - claw.x) - c * claw.vx;
      claw.vx += ax * dt;
      claw.x += claw.vx * dt;
      swingStep(ax, dt);
      drawClaw();
      if (Math.abs(claw.tx - claw.x) < 0.5 && Math.abs(claw.vx) < 4) {
        claw.x = claw.tx;
        claw.vx = 0;
        return;
      }
    }
  }

  function swingStep(ax: number, dt: number) {
    // a toy held by the head swings, it does not loop around: the spring stiffens
    // smoothly past ~28° instead of hitting a hard stop
    const over = Math.max(0, Math.abs(claw.swing) - 28) * Math.sign(claw.swing);
    claw.vswing += (-claw.swing * 80 - over * 600 - claw.vswing * 3.2 - (ax / gw) * 600) * dt;
    claw.swing += claw.vswing * dt;
  }

  // keep swinging until the toy reaches the far end of its swing towards the desk (left)
  async function swingToPeak() {
    if (reduceMotion) return;
    let prev = performance.now();
    const end = prev + 600;
    while (performance.now() < end) {
      const now = await frame();
      const before = claw.vswing;
      swingStep(0, Math.min(0.033, (now - prev) / 1000));
      prev = now;
      drawClaw();
      if (claw.swing > 6 && before > 0 && claw.vswing <= 0) return;
    }
  }

  async function draw() {
    if (busy || inBox.length === 0) return;
    busy = true;
    button.disabled = true;
    cabinet.classList.add('busy');
    const m = inBox[Math.floor(Math.random() * inBox.length)];
    const toy = need(toys.get(m.id), `toy ${m.id}`);
    await travel(toy.x, 60);
    const from = claw.len;
    const reach = toy.y - railY() - 5 * ck() - 4 * ck();
    await tween((t) => { claw.len = from + (reach - from) * ease(t); }, 520);
    await tween((t) => { claw.open = 0.6 * (1 - t); }, 200);
    carry = toy;
    toy.el.classList.add('carried');
    toy.z = 350; // in front of the claw: the hooks sit behind the head
    claw.swing = toy.r * 0.4;
    const low = claw.len;
    await tween((t) => {
      claw.len = low + (restLen() - low) * ease(t);
      swingStep(0, 1 / 60);
    }, 560);
    // one smooth run to the left: the toy trails as the claw sets off, swings forward
    // as it brakes, and is let go at the top of that swing
    await travel(gw * 0.22, 170);
    await swingToPeak();
    const rect = toy.el.getBoundingClientRect();
    toy.el.style.visibility = 'hidden';
    carry = null;
    onDraw(m, rect, (claw.swing * Math.PI) / 180, (claw.vswing * Math.PI) / 180);
    await tween((t) => { claw.open = 0.6 * t; }, 220);
    await travel(homeX(), 60);
    busy = false;
    cabinet.classList.remove('busy');
    button.disabled = inBox.length === 0;
    if (inBox.length === 0) onEmpty();
  }

  button.addEventListener('click', () => void draw());
  new ResizeObserver(() => measure()).observe(glass);

  return {
    set(members: BoxMember[]) {
      inBox = members;
      if (gw) layoutPile();
    },
    draw,
    contains(clientX: number, clientY: number) {
      const r = cabinet.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    },
  };
}
