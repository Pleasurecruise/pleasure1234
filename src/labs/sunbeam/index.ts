import { context2d } from '../../lib/dom';
import { drawCatAt } from './cat';
import { BOILS, face, grain, inHull, inPoly, paint, shadow, sheet, stroke, tone, type Pt } from './paper';
import { disc, drawRoom, FURNITURE, P, ROOM_X, ROOM_Z, shades, sunlight, unproject, WINDOW_CENTRE, type V3 } from './room';
import { isCoatKey, randomCoat } from './rig';
import { KEY, loadSave } from './save';
import { Sfx } from './sound';
import { rand } from './util';
import {
  adopt, beamSpot, BOX_DX, BOX_DY, BOX_HALF, BOX_TALL, carryCat, create, dropCat, elapse, fillBowl, flingYarn, floorBounds, grabBox, grabCat, grabDish,
  grabYarn, groundAt, localHour, setFloorDepth, setRoom, setWorldSize, snapshot, step, stroke as pet, tap, tapBox,
  TIPPED_TALL, YARN_R, type Solid,
} from './world';

const SHEET_W = 316, SHEET_H = 290, Q = 3;
const FLOOR = { x0: 10, x1: ROOM_X - 8, z0: 6, z1: ROOM_Z - 10 };
const BOX = { left: BOX_HALF, right: BOX_HALF + BOX_DX, back: -BOX_DY, h: BOX_TALL, tipped: TIPPED_TALL };
const DISH_R = 15;
const CARRY = 14, CARRY_CAT = 22;
/** Holding the cat this long without moving picks it up; moving sooner strokes it. */
const SCRUFF_MS = 250;

function hourParam(raw: string | null): number | null {
  if (raw === null) return null;
  const h = Number(raw);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null;
}

type Carried = { x: number; y: number; z: number; vx: number; vy: number; vz: number; angle?: number };
type Thrown = Carried & { held: boolean; spin: number };
type Velocity = { vx: number; vy: number; vz: number };

/** A flick across the floor: its speed carries the thing on along the floor, with a hop in proportion. */
const toss = (vx: number, vy: number, maxX: number, maxY: number): Velocity => {
  const cx = Math.max(-maxX, Math.min(maxX, vx)), cy = Math.max(-maxY, Math.min(maxY, vy));
  return { vx: cx, vy: cy, vz: Math.min(260, 30 + Math.hypot(cx, cy * 2) * 0.3) };
};
const letGo = (o: Thrown, v: Velocity, spin: number) => {
  o.held = false; o.vx = v.vx; o.vy = v.vy; o.vz = v.vz;
  o.spin = Math.max(-14, Math.min(14, v.vx * spin));
};

export function mountSunbeam(cv: HTMLCanvasElement, sfxRoot: string) {
  setWorldSize(SHEET_W, SHEET_H);
  // The world's collisions count a unit of depth as two across, so depth maps at 2S; drawn size then matches collision size.
  const span = floorBounds();
  const S = (FLOOR.x1 - FLOOR.x0) / (span.right - span.left);
  setFloorDepth(Math.round((FLOOR.z1 - FLOOR.z0) / (2 * S)));
  const fb = floorBounds();

  const toRoom = (x: number, y: number): [number, number] => [FLOOR.x0 + (x - fb.left) * S, FLOOR.z0 + (y - fb.top) * 2 * S];
  const toWorld = (X: number, Z: number): [number, number] => [fb.left + (X - FLOOR.x0) / S, fb.top + (Z - FLOOR.z0) / (2 * S)];
  const lift = (z: number) => z * S;
  const at = (x: number, y: number, z = 0): Pt => { const [X, Z] = toRoom(x, y); return P([X, lift(z), Z]); };
  setRoom(FURNITURE.map((f): Solid => {
    const [x0, y0] = toWorld(f.x0, f.z0), [x1, y1] = toWorld(f.x1, f.z1);
    return { x0, x1, y0, y1, top: f.top / S, perch: f.perch };
  }));

  const width = SHEET_W * Q, height = SHEET_H * Q, n = width * height;
  const s = sheet(width, height, Q);
  const g = grain(width, height, Q);
  const layer = new Uint32Array(n), catMask = new Uint8Array(n), catLines = new Uint8Array(n);
  const { floor, rug } = drawRoom(s);
  const staticRoom = s.room.slice(), staticLine = s.line.slice();
  const T = {
    box: shades(s, '#d8a86c', 0.6), boxIn: tone(s, '#a8825a', 0.45), flap: tone(s, '#dcb37c', 0.5), flapBack: tone(s, '#c99a62', 0.5),
    dish: tone(s, '#7f9cc2', 0.55), dishIn: tone(s, '#c5d3e3', 0.55), food: tone(s, '#b98d5c', 0.6), yarn: tone(s, '#d36b78', 0.6),
  };

  const params = new URLSearchParams(location.search);
  const forcedHour = hourParam(params.get('hour'));
  const coatParam = params.get('coat');
  let save = loadSave() ?? adopt(Date.now(), randomCoat());
  if (coatParam !== null && isCoatKey(coatParam)) save = { ...save, coat: coatParam };
  const w = create(save, Date.now());
  const sfx = new Sfx(sfxRoot);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(snapshot(w, Date.now()))); } catch { /* storage can be blocked */ } };

  cv.width = width; cv.height = height;
  const ctx = context2d(cv, {});
  const img = ctx.createImageData(width, height);

  let spotKey = '';
  const updateSun = () => {
    const spot = beamSpot(w.hour);
    const key = spot ? `${spot.x.toFixed(1)},${spot.y.toFixed(1)}` : 'none';
    if (key === spotKey) return;
    spotKey = key;
    if (!spot) { s.sun.fill(0); return; }
    const [X, Z] = toRoom(spot.x, spot.y), c = WINDOW_CENTRE;
    sunlight(s, [(X - c[0]) / c[1], -1, (Z - c[2]) / c[1]], new Set([floor, rug]));
  };

  const drawTheCat = () => {
    const c = w.cat, ground = c.perch >= 0 && c.jump === null ? groundAt(c.x, c.y) : 0;
    // In an upright box the cat sits up on its bedding, so its head and back show over the rim.
    const bedding = c.inBox && !w.box.tipped && c.mode !== 'hop' ? BOX_TALL * 0.45 : 0;
    const [sx, sy] = at(c.x, c.y, ground + bedding), k = Q * S;
    drawCatAt(layer, catLines, width, height, w, (sx * Q) / k, (sy * Q) / k, k, c.z - ground);
    for (let i = 0; i < n; i++) {
      const v = layer[i];
      if (!v) continue;
      catMask[i] = 1;
      if (catLines[i]) s.line[i] = 1; else { s.fill[i] = v; s.line[i] = 0; }
    }
  };

  const boxCorners = () => {
    const b = w.box, [x0, z0] = toRoom(b.x - BOX.left, b.y - BOX.back), [x1, z1] = toRoom(b.x + BOX.right, b.y);
    return { x0, x1, z0, z1, y: lift(b.z), h: (b.tipped ? BOX.tipped : BOX.h) * S };
  };

  const drawBox = (inside: () => void) => {
    const { x0, x1, z0, z1, y, h } = boxCorners(), fl = 9 * S;
    if (w.box.tipped) {
      face(s, [P([x0, y + h, z0]), P([x1, y + h, z0]), P([x1, y + h, z1]), P([x0, y + h, z1])], T.box.top);
      face(s, [P([x1, y, z0]), P([x1, y, z1]), P([x1, y + h, z1]), P([x1, y + h, z0])], T.box.dark);
      face(s, [P([x0, y, z1]), P([x1, y, z1]), P([x1, y + h, z1]), P([x0, y + h, z1])], T.boxIn);
      inside();
      for (const [a, c] of [[[x0, y, z1], [x1, y, z1]], [[x0, y + h, z1], [x1, y + h, z1]], [[x0, y, z1], [x0, y + h, z1]]] as [V3, V3][]) stroke(s, P(a), P(c), 3);
      face(s, [P([x0, y, z1]), P([x0 + 2, y, z1]), P([x0 - fl * 0.4, y + h - 2, z1 + fl]), P([x0 - fl * 0.7, y + h - 4, z1 + fl * 0.9])], T.flap);
      return;
    }
    face(s, [P([x0, y + h, z0]), P([x1, y + h, z0]), P([x1 + 1, y + h + fl, z0 - fl * 0.6]), P([x0 - 1, y + h + fl, z0 - fl * 0.6])], T.flapBack);
    face(s, [P([x0, y + h, z0]), P([x0, y + h, z1]), P([x0 - fl * 0.6, y + h + fl, z1 + 1]), P([x0 - fl * 0.6, y + h + fl, z0 - 1])], T.flapBack);
    face(s, [P([x0, y + h, z0]), P([x1, y + h, z0]), P([x1, y + h, z1]), P([x0, y + h, z1])], T.boxIn);
    inside();
    face(s, [P([x0, y, z1]), P([x1, y, z1]), P([x1, y + h, z1]), P([x0, y + h, z1])], T.box.lit);
    face(s, [P([x1, y, z0]), P([x1, y, z1]), P([x1, y + h, z1]), P([x1, y + h, z0])], T.box.dark);
    face(s, [P([x0, y + h, z1]), P([x1, y + h, z1]), P([x1 + 1, y + h + fl * 0.8, z1 + fl]), P([x0 - 1, y + h + fl * 0.8, z1 + fl])], T.flap);
  };

  const drawDish = () => {
    const d = w.dish, [X, Z] = toRoom(d.x, d.y), y = lift(d.z), r = DISH_R * S, rim = 5 * S;
    face(s, [...disc(X, y, Z, r * 0.9).slice(0, 13), ...disc(X, y + rim, Z, r).slice(0, 13).reverse()], T.dish);
    face(s, disc(X, y + rim, Z, r), T.dish);
    face(s, disc(X, y + rim, Z, r * 0.75), w.bowl > 0.03 ? T.food : T.dishIn, false);
    for (const k of w.kibble) {
      const [kx, ky] = at(k.x, k.y, k.z);
      face(s, Array.from({ length: 6 }, (_, i): Pt => [kx + Math.cos(i) * 0.9, ky + Math.sin(i) * 0.7]), T.food, false);
    }
  };

  const yarnCentre = (): Pt => { const y = w.yarn; return at(y.x, y.y, y.z + YARN_R); };
  const drawYarn = () => {
    const y = w.yarn, [cx, cy] = yarnCentre(), r = YARN_R * S;
    let [px, py] = at(y.x, y.y);
    for (let i = y.trail.length - 1; i >= 0; i--) {
      const [qx, qy] = at(y.trail[i][0], y.trail[i][1]);
      face(s, [[px, py - 0.4], [qx, qy - 0.4], [qx, qy + 0.4], [px, py + 0.4]], T.yarn, false);
      px = qx; py = qy;
    }
    face(s, Array.from({ length: 20 }, (_, i): Pt => [cx + Math.cos((i / 20) * Math.PI * 2) * r, cy + Math.sin((i / 20) * Math.PI * 2) * r]), T.yarn);
    stroke(s, [cx - r * 0.7, cy - r * 0.3], [cx + r * 0.5, cy + r * 0.7], 2, T.yarn);
    stroke(s, [cx - r * 0.3, cy - r * 0.8], [cx + r * 0.8, cy + r * 0.2], 2, T.yarn);
  };

  let boil = 0;
  const draw = () => {
    s.room.set(staticRoom); s.line.set(staticLine); s.fill.fill(0); s.shade.fill(0); catMask.fill(0);
    updateSun();
    const c = w.cat, b = w.box, d = w.dish, y = w.yarn;
    const under = (x: number, yy: number) => at(x, yy, groundAt(x, yy));
    if (!c.inBox) shadow(s, under(c.x, c.y), (22 - Math.min(c.z - groundAt(c.x, c.y), 12)) * S, 5 * S);
    shadow(s, under(b.x + 5, b.y - 4), 40 * S, 10 * S);
    shadow(s, under(d.x, d.y), DISH_R * S * 1.1, 5 * S);
    shadow(s, under(y.x, y.y), YARN_R * S, 2.5 * S);

    const items: [number, () => void][] = [
      [at(b.x, b.y)[1], () => drawBox(() => { if (y.inBox) drawYarn(); if (c.inBox) drawTheCat(); })],
      [at(d.x, d.y)[1], drawDish],
    ];
    if (!y.inBox) items.push([at(y.x, y.y)[1], drawYarn]);
    if (!c.inBox) items.push([at(c.x, c.y)[1], drawTheCat]);
    items.sort((p, q) => p[0] - q[0]).forEach(([, f]) => f());

    paint(s, g, img, boil);
    ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.scale(Q, Q);
    ctx.textAlign = 'center';
    ctx.font = '8px "Shantell Sans", cursive';
    const [cx, cy] = at(c.x, c.y);
    for (const p of w.parts) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2);
      ctx.fillStyle = p.kind === 'heart' ? '#c95c54' : p.kind === 'z' ? '#7d90b8' : '#6b5a55';
      ctx.fillText(p.kind === 'heart' ? '♥' : p.kind === 'z' ? 'z' : '♪', cx + (p.x - c.x) * S, cy + (p.y - c.y) * S);
    }
    ctx.restore();
  };

  const pointer = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * SHEET_W, sy = ((e.clientY - r.top) / r.height) * SHEET_H;
    const top = FURNITURE.find((f) => {
      const [X, Z] = unproject(sx, sy, f.top);
      return f.perch && X >= f.x0 && X <= f.x1 && Z >= f.z0 && Z <= f.z1;
    });
    const [x, y] = toWorld(...unproject(sx, sy, top?.top ?? 0));
    return { sx, sy, x, y };
  };
  const hit = (sx: number, sy: number): 'yarn' | 'bowl' | 'box' | 'cat' | null => {
    const [yx, yy] = yarnCentre();
    if (Math.hypot(sx - yx, sy - yy) < YARN_R * S + 4) return 'yarn';
    const d = w.dish, [dX, dZ] = toRoom(d.x, d.y);
    if (inPoly(sx, sy, disc(dX, lift(d.z) + 2.5 * S, dZ, DISH_R * S + 3, 16))) return 'bowl';
    const px = Math.floor(sx * Q), py = Math.floor(sy * Q);
    if (px >= 0 && py >= 0 && px < width && py < height && catMask[py * width + px]) return 'cat';
    const { x0, x1, z0, z1, y, h } = boxCorners(), top = y + h + 9 * S;
    const corners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    return inHull(sx, sy, [...corners.map(([a, c]) => P([a, y, c])), ...corners.map(([a, c]) => P([a, top, c]))]) ? 'box' : null;
  };

  // Seen from above, a held thing follows the pointer over the floor; the side view's "pointer up lifts it" would pin it to one line.
  const carry = (o: Carried, x: number, y: number, dt: number, tilt: number) => {
    const nx = Math.min(fb.right, Math.max(fb.left, x)), ny = Math.min(fb.bottom, Math.max(fb.top, y));
    const vx = (nx - o.x) / Math.max(dt, 1e-3);
    o.x = nx; o.y = ny; o.z += (groundAt(nx, ny) + CARRY - o.z) * Math.min(1, dt * 14);
    if (o.angle !== undefined) o.angle += (Math.max(-1.3, Math.min(1.3, vx * tilt)) - o.angle) * (1 - Math.exp(-dt * 10));
  };

  type Drag = { kind: 'yarn' | 'cat' | 'box' | 'bowl'; x: number; y: number; total: number; vx: number; vy: number; t: number; grabbed: boolean; petting: boolean };
  let drag: Drag | null = null;
  const scruff = (d: Drag) => {
    if (drag !== d || d.petting || d.grabbed) return;
    d.grabbed = true;
    const c = w.cat;
    grabCat(w);
    carryCat(w, c.x, c.y, c.z + 8);
    cv.style.cursor = 'grabbing';
  };

  cv.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    const p = pointer(e);
    Object.assign(w.pointer, { x: p.x, y: p.y, on: true });
    const what = hit(p.sx, p.sy);
    if (what) {
      const d: Drag = { kind: what, x: p.x, y: p.y, total: 0, vx: 0, vy: 0, t: performance.now(), grabbed: false, petting: false };
      drag = d;
      if (what === 'yarn') grabYarn(w);
      if (what === 'cat') window.setTimeout(() => scruff(d), SCRUFF_MS);
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
    }
    e.preventDefault();
  });

  cv.addEventListener('pointermove', (e) => {
    const p = pointer(e), ptr = w.pointer;
    const dist = ptr.on ? Math.hypot(p.x - ptr.x, p.y - ptr.y) : 0;
    if (!drag) { ptr.x0 = p.x; ptr.y0 = p.y; }
    Object.assign(ptr, { x: p.x, y: p.y, on: true, moved: w.time });
    if (!drag) {
      ptr.energy += dist;
      cv.style.cursor = hit(p.sx, p.sy) ? 'grab' : 'default';
      return;
    }
    const nowMs = performance.now(), dts = Math.max(1, nowMs - drag.t) / 1000;
    drag.vx = drag.vx * 0.5 + ((p.x - drag.x) / dts) * 0.5; drag.vy = drag.vy * 0.5 + ((p.y - drag.y) / dts) * 0.5;
    drag.x = p.x; drag.y = p.y; drag.t = nowMs; drag.total += dist;
    if (drag.kind === 'yarn') carry(w.yarn, p.x, p.y, dts, 0);
    else if (drag.kind === 'box') {
      if (drag.total > 3 && !drag.grabbed) { drag.grabbed = true; grabBox(w); }
      if (drag.grabbed) carry(w.box, p.x, p.y, dts, 0.0045);
    } else if (drag.kind === 'bowl') {
      if (drag.total > 3 && !drag.grabbed) { drag.grabbed = true; grabDish(w); }
      if (drag.grabbed) carry(w.dish, p.x, p.y, dts, 0.005);
    } else if (drag.grabbed) {
      const z = w.cat.z;
      carryCat(w, p.x, p.y, z + (groundAt(p.x, p.y) + CARRY_CAT - z) * 0.3);
    } else if (drag.total > 3) {
      drag.petting = true;
      if (dist > 0.5) {
        const ax = Math.abs(p.x - ptr.x0), ay = Math.abs(p.y - ptr.y0);
        ptr.sx = ax >= ay * 0.5 ? Math.sign(p.x - ptr.x0) : 0;
        ptr.sy = ay >= ax * 0.5 ? Math.sign(p.y - ptr.y0) : 0;
      }
      pet(w, dist);
    }
    ptr.x0 = p.x; ptr.y0 = p.y;
  });

  const throwYarn = (v: Velocity) => { w.yarn.held = false; flingYarn(w, v.vx, v.vy, v.vz); };
  const release = () => {
    if (!drag) return;
    // A hand that has stopped sets the thing down instead of flinging it with its last movement.
    const held = performance.now() - drag.t > 120, vx = held ? 0 : drag.vx, vy = held ? 0 : drag.vy;
    const place = (v: Velocity) => (held ? { vx: 0, vy: 0, vz: 0 } : v);
    if (drag.kind === 'yarn') throwYarn(place(toss(vx, vy, 300, 140)));
    else if (drag.kind === 'box') { if (drag.grabbed) letGo(w.box, place(toss(vx * 0.9, vy * 0.9, 520, 200)), 0.016); else tapBox(w); }
    else if (drag.kind === 'bowl') { if (drag.grabbed) letGo(w.dish, place(toss(vx * 0.9, vy * 0.9, 480, 200)), 0.02); else fillBowl(w); }
    else if (drag.grabbed) dropCat(w);
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
    if (k === 'enter') pet(w, 30);
    else if (k === ' ') { grabYarn(w); throwYarn(toss(rand(-220, 220), rand(-120, 120), 300, 140)); }
    else if (k === 'f') fillBowl(w);
    else if (k === 'm') tap(w);
    else if (k === 'b') tapBox(w);
    else if (k === 't') { grabBox(w); letGo(w.box, toss(rand(-260, 260), rand(-120, 120), 520, 200), 0.016); }
    else return;
    e.preventDefault();
  });

  let last = performance.now(), lastWall = Date.now(), saveT = 0, sinceDraw = 1;
  const frame = (t: number) => {
    const wall = Date.now();
    if (wall - lastWall > 5000) elapse(w, (wall - lastWall) / 1000);
    lastWall = wall;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    w.hour = forcedHour ?? localHour();
    step(w, dt);
    for (const snd of w.sounds) sfx.play(snd);
    w.sounds.length = 0;
    sfx.purr(w.cat.purr);
    sinceDraw += dt;
    if (sinceDraw >= 1 / 12 || drag) {
      if (sinceDraw >= 1 / 12) boil = (boil + 1) % BOILS;
      sinceDraw = 0;
      draw();
    }
    if ((saveT += dt) > 4) { saveT = 0; persist(); }
    requestAnimationFrame(frame);
  };
  draw();
  requestAnimationFrame(frame);
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
}
