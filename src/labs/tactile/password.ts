import { context2d, find } from '../../lib/dom';

const BRUSH = 14;
const RECOVER_AFTER = 2500;
const FADE_MS = 700;

export function mountPassword(tile: HTMLElement) {
  const field = find(tile, '.pw-field', HTMLElement);
  const input = find(field, 'input', HTMLInputElement);
  const ink = find(field, '.pw-ink', HTMLCanvasElement);
  const canvas = find(field, '.pw-foil', HTMLCanvasElement);
  const fresh = find(field, '.pw-foil-fresh', HTMLCanvasElement);
  const ctx = context2d(canvas, { alpha: true });
  const inkCtx = context2d(ink, { alpha: true });
  const freshCtx = context2d(fresh, { alpha: true });
  const grain = document.createElement('canvas');
  const grainCtx = context2d(grain, { alpha: true });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let dirty = false;
  let last: { x: number; y: number } | null = null;
  let press: { x: number; y: number; moved: boolean } | null = null;
  let timer = 0;
  let fading = 0;
  let cells: { x: number; w: number }[] = [];

  const typing = () => document.activeElement === input;

  const layout = () => {
    const style = getComputedStyle(input);
    inkCtx.font = `${style.fontSize} ${style.fontFamily}`;
    const spacing = Number.parseFloat(style.letterSpacing) || 0;
    const advance = inkCtx.measureText('0').width + spacing;
    const left = Number.parseFloat(style.paddingLeft) - input.scrollLeft;
    cells = Array.from({ length: input.value.length }, (_, i) => ({ x: left + i * advance, w: advance }));
  };

  const drawInk = () => {
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, ink.width, ink.height);
    if (typing() || document.hidden) return;
    const style = getComputedStyle(input);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.font = `${style.fontSize} ${style.fontFamily}`;
    inkCtx.fillStyle = style.getPropertyValue('--ink').trim() || '#292524';
    inkCtx.textAlign = 'center';
    inkCtx.textBaseline = 'middle';
    const chars = [...input.value];
    cells.forEach((c, i) => inkCtx.fillText(chars[i] ?? '', c.x + c.w / 2, height / 2 + 0.5));
  };

  const wipeInk = () => {
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, ink.width, ink.height);
  };

  const paintGrain = () => {
    const style = getComputedStyle(field);
    const ink = style.getPropertyValue('--ink').trim() || '#292524';
    const paper = style.getPropertyValue('--paper').trim() || '#fafaf9';
    grain.width = canvas.width;
    grain.height = canvas.height;
    const c = grainCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = ink;
    c.fillRect(0, 0, width, height);
    c.strokeStyle = paper;
    c.lineWidth = 0.5;
    for (let y = 0.5; y < height; y += 1.5) {
      c.globalAlpha = 0.04 + Math.random() * 0.06;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(width, y + (Math.random() - 0.5));
      c.stroke();
    }
    const sheen = c.createLinearGradient(0, 0, width, height);
    sheen.addColorStop(0.3, 'transparent');
    sheen.addColorStop(0.45, paper);
    sheen.addColorStop(0.6, 'transparent');
    c.globalAlpha = 0.16;
    c.fillStyle = sheen;
    c.fillRect(0, 0, width, height);
    c.globalAlpha = 1;
  };

  const patches = (target: CanvasRenderingContext2D) => {
    target.save();
    target.setTransform(dpr, 0, 0, dpr, 0, 0);
    target.beginPath();
    const h = Math.min(height - 6, Number.parseFloat(getComputedStyle(input).fontSize) * 1.35);
    for (const c of cells) {
      const w = Math.max(6, c.w - 2);
      target.roundRect(c.x + (c.w - w) / 2, (height - h) / 2, w, h, 2.5);
    }
    target.clip();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(grain, 0, 0);
    target.restore();
  };

  const size = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    width = r.width;
    height = r.height;
    for (const c of [canvas, fresh, ink]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    paintGrain();
  };

  const settleFresh = () => {
    cancelAnimationFrame(fading);
    if (fresh.style.opacity === '0' || fresh.style.opacity === '') return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fresh, 0, 0);
    fresh.style.opacity = '0';
  };

  const cover = (fade: boolean) => {
    clearTimeout(timer);
    cancelAnimationFrame(fading);
    layout();
    drawInk();
    paintGrain();
    dirty = false;
    if (!fade) {
      fresh.style.opacity = '0';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      patches(ctx);
      return;
    }
    freshCtx.clearRect(0, 0, fresh.width, fresh.height);
    patches(freshCtx);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / FADE_MS);
      fresh.style.opacity = String(t * t * (3 - 2 * t));
      if (t < 1) fading = requestAnimationFrame(step);
      else settleFresh();
    };
    fading = requestAnimationFrame(step);
  };

  const scheduleRecover = () => {
    clearTimeout(timer);
    if (!dirty || field.contains(document.activeElement) || field.matches(':hover')) return;
    timer = window.setTimeout(() => {
      if (!field.contains(document.activeElement) && !field.matches(':hover')) cover(true);
    }, RECOVER_AFTER);
  };

  const point = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const scratch = (to: { x: number; y: number }) => {
    settleFresh();
    const from = last ?? to;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineWidth = BRUSH;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    for (let n = 0; n < 2; n++) {
      ctx.beginPath();
      ctx.arc(to.x + (Math.random() - 0.5) * BRUSH * 1.3, to.y + (Math.random() - 0.5) * BRUSH, Math.random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    last = to;
    dirty = true;
  };

  canvas.addEventListener('mousedown', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, moved: false };
    last = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!press || !canvas.hasPointerCapture(e.pointerId)) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) return;
    press.moved = true;
    scratch(point(e));
  });
  const lift = (e: PointerEvent) => {
    const tapped = press && !press.moved && e.type === 'pointerup';
    press = null;
    last = null;
    if (tapped) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const passes = Math.max(4, input.value.length);
    last = null;
    for (let n = 0; n <= passes; n++) {
      setTimeout(() => {
        scratch({ x: 6 + (n / passes) * (width - 12), y: n % 2 === 0 ? height * 0.3 : height * 0.7 });
        if (n === passes) last = null;
      }, n * 30);
    }
  });

  input.addEventListener('focus', () => {
    clearTimeout(timer);
    field.classList.add('is-typing');
    wipeInk();
  });
  input.addEventListener('blur', () => {
    field.classList.remove('is-typing');
    cover(true);
  });

  field.addEventListener('pointerleave', scheduleRecover);
  field.addEventListener('focusout', () => setTimeout(scheduleRecover));
  field.addEventListener('pointerenter', () => clearTimeout(timer));
  canvas.addEventListener('focus', () => clearTimeout(timer));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) wipeInk();
    else drawInk();
  });
  addEventListener('pagehide', wipeInk);

  new MutationObserver(() => {
    drawInk();
    paintGrain();
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(grain, 0, 0);
    ctx.restore();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let seen = '';
  new ResizeObserver(([entry]) => {
    const next = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
    if (next === seen) return;
    seen = next;
    size();
    if (!typing()) cover(false);
  }).observe(canvas);

  void document.fonts.ready.then(() => {
    if (!typing() && !dirty) cover(false);
  });
}
