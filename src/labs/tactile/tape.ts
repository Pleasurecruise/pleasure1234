import { find } from '../../lib/dom';
import { Spring, animator, clamp } from './kit';

const MAX = 20;

export function mountTape(tile: HTMLElement) {
  const track = find(tile, '.tape-track', HTMLElement);
  const strip = find(track, '.tape-strip', HTMLElement);
  const scale = find(strip, '.tape-scale', HTMLElement);
  const hook = find(track, '.tape-hook', HTMLElement);
  const read = find(track, '.tape-read', HTMLElement);
  const body = find(tile, '.tape-case', HTMLButtonElement);

  let unit = 16;
  let value = 0;
  const len = new Spring(0, 260, 22);
  let drag: { id: number; x: number; from: number } | null = null;
  let lastLen = 0;
  let tilt = 0;
  let retracting = false;

  for (let cm = 5; cm <= MAX; cm += 5) {
    const n = document.createElement('span');
    n.textContent = String(cm);
    n.style.setProperty('--cm', String(cm));
    if (cm % 10 === 0) n.className = 'is-ten';
    scale.append(n);
  }

  const measure = () => {
    unit = Math.max(6, (track.clientWidth - hook.offsetWidth - 8) / MAX);
    tile.style.setProperty('--unit', `${unit}px`);
    len.snap(value * unit);
    draw(0);
  };

  const setValue = (next: number) => {
    next = clamp(Math.round(next), 0, MAX);
    if (next === value) return;
    value = next;
    hook.setAttribute('aria-valuenow', String(value));
    hook.setAttribute('aria-valuetext', `${value} centimetres`);
    read.textContent = `${value} cm`;
    tile.classList.toggle('is-out', value > 0);
  };

  const draw = (dt: number) => {
    const l = Math.max(0, len.value);
    strip.style.width = `${l}px`;
    hook.style.transform = `translateX(${l}px) rotate(${tilt.toFixed(2)}deg)`;
    read.style.transform = `translateX(${l}px)`;
    const speed = dt > 0 ? (l - lastLen) / dt : 0;
    lastLen = l;
    tilt += (clamp(-speed * 0.012, -14, 14) - tilt) * Math.min(1, dt * 12);
  };

  const run = animator((dt) => {
    if (!drag) {
      len.step(dt);
      if (len.value < 0) {
        len.value = 0;
        if (retracting && len.velocity < -120) {
          body.classList.remove('is-knocked');
          void body.offsetWidth;
          body.classList.add('is-knocked');
        }
        len.velocity = Math.abs(len.velocity) * 0.25;
        retracting = false;
      }
    }
    draw(dt);
    return drag !== null || !len.resting || Math.abs(tilt) > 0.05;
  });

  const pull = (e: PointerEvent) => {
    track.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, from: len.value };
    retracting = false;
    tile.classList.add('is-pulling');
    run();
  };
  hook.addEventListener('pointerdown', pull);
  strip.addEventListener('pointerdown', pull);

  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const max = MAX * unit;
    let l = drag.from + e.clientX - drag.x;
    if (l > max) l = max + 14 * Math.tanh((l - max) / 40);
    l = Math.max(0, l);
    len.value = l;
    len.velocity = 0;
    setValue(l / unit);
  });
  const letGo = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    tile.classList.remove('is-pulling');
    len.target = value * unit;
    run();
  };
  track.addEventListener('pointerup', letGo);
  track.addEventListener('pointercancel', letGo);

  body.addEventListener('click', () => {
    if (value === 0 && len.value < 1) return;
    setValue(0);
    retracting = true;
    len.target = 0;
    len.velocity = -Math.max(600, len.value * 6);
    run();
  });

  hook.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 5 : 1;
    const keys: Record<string, number> = {
      ArrowRight: value + big, ArrowUp: value + big, PageUp: value + 5,
      ArrowLeft: value - big, ArrowDown: value - big, PageDown: value - 5,
      Home: 0, End: MAX,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    setValue(keys[e.key]);
    len.target = value * unit;
    run();
  });

  new ResizeObserver(measure).observe(track);
  read.textContent = '0 cm';
}
