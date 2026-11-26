import { context2d } from '../lib/dom';
import { Clawd } from './clawd';


const ROWS: { offset: number; codes: string[] }[] = [
  { offset: 0, codes: ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'] },
  { offset: 1.5, codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'] },
  { offset: 1.75, codes: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'] },
  { offset: 2.25, codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'] },
];
const KEYBOARD_UNITS = 15;

type Kind = 'key' | 'space' | 'erase' | 'send';
interface Key { x: number; row: number; kind: Kind }

const KEYS = new Map<string, Key>();
ROWS.forEach(({ offset, codes }, row) => {
  codes.forEach((code, i) => KEYS.set(code, { x: (offset + i + 0.5) / KEYBOARD_UNITS, row, kind: 'key' }));
});
KEYS.set('Space', { x: 0.45, row: 4, kind: 'space' });
KEYS.set('Backspace', { x: 0.93, row: 0, kind: 'erase' });
KEYS.set('Delete', { x: 0.97, row: 0, kind: 'erase' });
KEYS.set('Enter', { x: 0.92, row: 2, kind: 'send' });
KEYS.set('Tab', { x: 0.05, row: 1, kind: 'key' });

const CHAR_CODES = new Map<string, string>();
for (const { codes } of ROWS) for (const code of codes) {
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) CHAR_CODES.set(m[1].toLowerCase(), code);
}
for (const [ch, code] of Object.entries({
  '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', ' ': 'Space', '\n': 'Space',
  '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5', '^': 'Digit6', '&': 'Digit7',
  '*': 'Digit8', '(': 'Digit9', ')': 'Digit0', '_': 'Minus', '+': 'Equal', ':': 'Semicolon', '"': 'Quote',
  '<': 'Comma', '>': 'Period', '?': 'Slash',
})) CHAR_CODES.set(ch, code);

/** Characters with no key of their own (CJK, emoji) still land somewhere stable. */
function keyForChar(ch: string): Key {
  const code = CHAR_CODES.get(ch.toLowerCase());
  const key = code && KEYS.get(code);
  if (key) return key;
  const n = ch.codePointAt(0) ?? 0;
  return { x: ((n * 2654435761) >>> 0) / 2 ** 32 * 0.9 + 0.05, row: 1 + (n % 3), kind: 'key' };
}

interface Parts {
  canvas: HTMLCanvasElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  log: HTMLElement;
  send: HTMLButtonElement;
  stage: HTMLCanvasElement;
  sheets: string;
}

export function mountTypetone({ canvas, form, input, log, send, stage, sheets }: Parts) {
  const ctx = context2d(canvas, { alpha: true });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const BAR = 5;
  const GAP = 3;
  const SEG = 3;
  const SEG_GAP = 2;
  let n = 0;
  let target = new Float32Array(0);
  let level = new Float32Array(0);
  let vel = new Float32Array(0);
  let peak = new Float32Array(0);
  let hold = new Float32Array(0);
  let glow = new Float32Array(0);
  let cssW = 0;
  let cssH = 0;

  const stageCtx = context2d(stage, { alpha: true });
  let stageH = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const over = stage.getBoundingClientRect();
    stageH = over.height;
    stage.width = Math.round(over.width * dpr);
    stage.height = Math.round(over.height * dpr);
    stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const next = Math.max(8, Math.floor((cssW + GAP) / (BAR + GAP)));
    if (next === n) return;
    n = next;
    target = new Float32Array(n);
    level = new Float32Array(n);
    vel = new Float32Array(n);
    peak = new Float32Array(n);
    hold = new Float32Array(n);
    glow = new Float32Array(n);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let flow = 0;
  let flowGoal = 0;
  let beat = 0;
  const gaps: number[] = [];
  let lastPress = 0;

  function tempo(now: number) {
    const gap = now - lastPress;
    lastPress = now;
    if (gap > 900) {
      gaps.length = 0;
      return;
    }
    gaps.push(gap);
    if (gaps.length > 8) gaps.shift();
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) / mean;
    const speed = Math.min(1, Math.max(0, (380 - mean) / 260));
    flowGoal = Math.min(1, speed * (1.15 - Math.min(1, spread)) * Math.min(1, gaps.length / 4));
    beat = 0.35 + flow * 0.65;
  }

  const queue: { at: number; i: number; amount: number }[] = [];

  let struck = -1;

  function kick(x: number, amount: number, width = 1.5) {
    const boost = 1 + flow * 0.45;
    const w = width * (1 + flow * 0.5);
    const centre = x * (n - 1);
    struck = Math.round(centre);
    const reach = Math.ceil(w * 2.5);
    const now = performance.now();
    for (let i = Math.max(0, Math.floor(centre - reach)); i <= Math.min(n - 1, Math.ceil(centre + reach)); i++) {
      const d = Math.abs(i - centre);
      const g = Math.exp(-((d / w) ** 2)) * (0.85 + Math.random() * 0.3);
      queue.push({ at: now + d * 18, i, amount: amount * boost * g });
    }
  }

  function lift(i: number, amount: number) {
    target[i] = Math.min(1, Math.max(target[i], target[i] * 0.4 + amount));
    vel[i] += amount * 9;
    glow[i] = 1;
  }

  function wipe(x: number) {
    const from = Math.round(x * (n - 1));
    const now = performance.now();
    for (let i = from; i >= Math.max(0, from - 10); i--) {
      queue.push({ at: now + (from - i) * 14, i, amount: -1 });
    }
    flowGoal *= 0.6;
  }

  function sweep() {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const amount = 0.55 + 0.45 * Math.sin((i / (n - 1)) * Math.PI);
      queue.push({ at: now + i * 9, i, amount });
    }
    beat = 1;
  }

  const clawd = new Clawd(sheets);
  window.setTimeout(() => clawd.wave(), 500);
  let lastWave = performance.now();
  input.addEventListener('focus', () => {
    if (performance.now() - lastWave < 4000) return;
    lastWave = performance.now();
    clawd.wave();
  });

  function press(key: Key, strength = 1) {
    const now = performance.now();
    if (key.kind !== 'erase') tempo(now);
    clawd.react(key.kind, key.x);
    switch (key.kind) {
      case 'space':
        for (let k = 0; k < 5; k++) kick(0.1 + Math.random() * 0.8, 0.3 * strength, 1.2);
        break;
      case 'erase':
        wipe(key.x);
        break;
      case 'send':
        sweep();
        break;
      default:
        kick(key.x, (0.62 + (3 - Math.min(key.row, 3)) * 0.07) * strength);
    }
  }

  let lastKeydown = 0;
  input.addEventListener('keydown', (e) => {
    // keyCode 229 is the Enter that confirms an IME candidate in Safari; it must not send.
    const composing = e.isComposing || e.keyCode === 229;
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault();
      form.requestSubmit();
      return;
    }
    const key = KEYS.get(e.code);
    if (!key || e.metaKey || e.ctrlKey) return;
    lastKeydown = performance.now();
    // A non-sending Enter (new line, IME pick) counts as a plain key.
    press(key.kind === 'send' ? { ...key, kind: 'key' } : key, e.repeat ? 0.5 : 1);
  });
  const sync = () => {
    send.disabled = !input.value.trim();
  };
  sync();

  input.addEventListener('input', (e) => {
    sync();
    if (performance.now() - lastKeydown < 80) return;
    const data = e instanceof InputEvent ? e.data : null;
    if (data) press(keyForChar(data[data.length - 1]));
    else press({ x: 0.93, row: 0, kind: 'erase' });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const from = send.getBoundingClientRect();
    input.value = '';
    sync();
    input.focus();
    sweep();
    clawd.react('send', 0);
    form.classList.remove('sent');
    void form.offsetWidth;
    form.classList.add('sent');

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'bubble';
    bubble.textContent = text;
    bubble.title = 'Play it again on the bars';
    bubble.addEventListener('click', () => replay(text, bubble));
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
    if (reduceMotion.matches) return;
    const to = bubble.getBoundingClientRect();
    const dx = from.left + from.width / 2 - to.right;
    const dy = from.top + from.height / 2 - to.bottom;
    bubble.style.transformOrigin = '100% 100%';
    bubble.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
      { offset: 0.12, opacity: 1 },
      { offset: 0.55, transform: 'translate(0, -6px) scale(1.06, 1.08)', easing: 'ease-in-out' },
      { offset: 0.75, transform: 'translate(0, 1px) scale(0.98, 0.96)', easing: 'ease-in-out' },
      { offset: 0.9, transform: 'translate(0, -1px) scale(1.01)' },
      { transform: 'none', opacity: 1 },
    ], { duration: 620 });
  });

  let playback = 0;
  function replay(text: string, bubble: HTMLElement) {
    const run = ++playback;
    const chars = [...text].slice(0, 160);
    for (const b of log.querySelectorAll('.playing')) b.classList.remove('playing');
    bubble.classList.add('playing');
    chars.forEach((ch, i) => window.setTimeout(() => {
      if (run !== playback) return;
      press(keyForChar(ch), 0.85);
      if (i === chars.length - 1) window.setTimeout(() => bubble.classList.remove('playing'), 400);
    }, i * 95));
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const ink = rootStyle.getPropertyValue('--ink').trim() || '#292524';
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const calm = reduceMotion.matches;

    for (let q = queue.length - 1; q >= 0; q--) {
      const job = queue[q];
      if (job.at > now) continue;
      queue.splice(q, 1);
      if (job.i >= n) continue;
      if (job.amount < 0) {
        target[job.i] = 0;
        vel[job.i] = Math.min(vel[job.i], -4);
        peak[job.i] *= 0.4;
        glow[job.i] = 0;
      } else lift(job.i, job.amount);
    }

    if (now - lastPress > 900) flowGoal = Math.max(0, flowGoal - dt * 0.8);
    flow += (flowGoal - flow) * Math.min(1, dt * 4);
    beat *= Math.exp(-dt * 7);

    const swell = calm ? 0 : beat * 0.12 * (0.3 + flow);
    const sink = Math.exp(-dt * (2.6 - flow * 0.8));
    const k = calm ? 900 : 380;
    const c = calm ? 60 : 15;
    for (let i = 0; i < n; i++) {
      target[i] *= sink;
      vel[i] += ((target[i] + swell * Math.sin((i / (n - 1)) * Math.PI)) - level[i]) * k * dt - vel[i] * c * dt;
      level[i] = Math.min(1.08, Math.max(0, level[i] + vel[i] * dt));
      if (level[i] >= peak[i]) {
        peak[i] = Math.min(1, level[i]);
        hold[i] = 0.4;
      } else if (hold[i] > 0) hold[i] -= dt;
      else peak[i] = Math.max(level[i], peak[i] - (0.5 + peak[i]) * dt);
      glow[i] *= Math.exp(-dt * 2.2);
    }

    form.style.setProperty('--flow', flow.toFixed(3));

    ctx.clearRect(0, 0, cssW, cssH);
    const segs = Math.max(4, Math.floor((cssH + SEG_GAP) / (SEG + SEG_GAP)));
    const span = n * (BAR + GAP) - GAP;
    const offset = (cssW - span) / 2;
    clawd.update(dt, now, span, calm);
    const [crabL, crabR] = clawd.span(offset, span);
    const t = now / 1000;
    const breath = calm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.1);
    for (let i = 0; i < n; i++) {
      const x = offset + i * (BAR + GAP);
      const u = i / (n - 1);
      const lit = level[i] * segs;
      const behind = x + BAR > crabL - 4 && x < crabR + 4 ? 0.25 : 1;
      ctx.fillStyle = ink;
      for (let s = 0; s < segs; s++) {
        const on = Math.min(1, Math.max(0, lit - s));
        if (on <= 0 && s > 0) break;
        const y = cssH - (s + 1) * SEG - s * SEG_GAP;
        ctx.globalAlpha = (on > 0
          ? (0.18 + on * 0.5 + glow[i] * 0.3) * (1 - (s / segs) * 0.4)
          : (0.07 + breath * 0.07) * Math.sin(u * Math.PI) ** 0.6) * behind;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR, SEG, 1);
        ctx.fill();
      }
      const capSeg = Math.min(segs - 1, Math.round(peak[i] * segs));
      if (peak[i] > 0.1 && capSeg >= Math.floor(lit)) {
        const marked = i === struck && hold[i] > 0;
        ctx.globalAlpha = (marked ? 0.85 : hold[i] > 0 ? 0.55 : 0.3);
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.roundRect(x, cssH - (capSeg + 1) * SEG - capSeg * SEG_GAP, BAR, SEG, 1);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    stageCtx.clearRect(0, 0, cssW, stageH);
    clawd.draw(stageCtx, offset, span, stageH, now, calm);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
