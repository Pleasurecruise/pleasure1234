import { find, findAll } from '../../lib/dom';
import { Spring, angleAround, angleDelta, animator } from './kit';

const STEP = 36;
const CODE = '0427';
const PRESS_SLOP = 5;

export function mountDial(tile: HTMLElement) {
  const dial = find(tile, '.dial', HTMLElement);
  const body = find(dial, '.dial-body', SVGGElement);
  const slots = findAll(tile, '.pin-slot', HTMLElement);
  const status = find(tile, '.pin-status', HTMLElement);

  let raw = 0;
  const shown = new Spring(0, 380, 24);
  let grip: { id: number; last: number; x: number; y: number; moved: boolean } | null = null;
  let entered: string[] = [];
  let busy = false;

  const digit = () => (((Math.round(raw / STEP) % 10) + 10) % 10);

  const run = animator((dt) => {
    shown.step(dt);
    body.style.transform = `rotate(${shown.value.toFixed(2)}deg)`;
    return grip !== null || !shown.resting;
  });

  const announce = () => dial.setAttribute('aria-valuenow', String(digit()));

  const follow = () => {
    const home = Math.round(raw / STEP) * STEP;
    shown.target = home + (raw - home) * 0.4;
    announce();
    run();
  };

  const settle = () => {
    raw = Math.round(raw / STEP) * STEP;
    shown.target = raw;
    announce();
    run();
  };

  const restart = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const render = () => {
    slots.forEach((slot, i) => {
      const d = entered[i];
      slot.classList.toggle('is-filled', d !== undefined);
      if (d === undefined) {
        slot.textContent = '';
        slot.classList.remove('is-masked');
      }
    });
  };

  const clear = (delay: number) =>
    setTimeout(() => {
      slots.forEach((s) => s.classList.add('is-clearing'));
      setTimeout(() => {
        entered = [];
        slots.forEach((s) => s.classList.remove('is-clearing'));
        render();
        busy = false;
      }, 260);
    }, delay);

  const check = () => {
    busy = true;
    if (entered.join('') === CODE) {
      tile.classList.add('is-open');
      status.textContent = 'Open.';
      raw += 360;
      shown.target = raw;
      run();
      setTimeout(() => {
        tile.classList.remove('is-open');
        status.textContent = '';
        clear(0);
      }, 2600);
    } else {
      status.textContent = 'Wrong code.';
      slots.forEach((s) => restart(s, 'is-wrong'));
      clear(550);
      setTimeout(() => {
        if (status.textContent === 'Wrong code.') status.textContent = '';
      }, 1800);
    }
  };

  const press = () => {
    if (busy || entered.length >= slots.length) return;
    restart(dial, 'is-pressed');
    const d = String(digit());
    entered.push(d);
    const slot = slots[entered.length - 1];
    slot.textContent = d;
    slot.classList.remove('is-masked');
    render();
    restart(slot, 'is-landing');
    setTimeout(() => {
      if (entered[slots.indexOf(slot)] !== undefined) slot.classList.add('is-masked');
    }, 650);
    status.textContent = '';
    if (entered.length === slots.length) setTimeout(check, 420);
  };

  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    grip = { id: e.pointerId, last: angleAround(dial, e), x: e.clientX, y: e.clientY, moved: false };
    tile.classList.add('is-gripping');
  });
  dial.addEventListener('pointermove', (e) => {
    if (!grip || e.pointerId !== grip.id) return;
    const now = angleAround(dial, e);
    if (!grip.moved && Math.hypot(e.clientX - grip.x, e.clientY - grip.y) > PRESS_SLOP) grip.moved = true;
    if (grip.moved) {
      raw += angleDelta(now, grip.last);
      follow();
    }
    grip.last = now;
  });
  const letGo = (e: PointerEvent) => {
    if (!grip || e.pointerId !== grip.id) return;
    const pressed = !grip.moved && e.type === 'pointerup';
    grip = null;
    tile.classList.remove('is-gripping');
    settle();
    if (pressed) press();
  };
  dial.addEventListener('pointerup', letGo);
  dial.addEventListener('pointercancel', letGo);

  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      raw += e.key === 'ArrowRight' || e.key === 'ArrowUp' ? STEP : -STEP;
      settle();
    } else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      raw += ((((Number(e.key) - digit()) % 10) + 15) % 10 - 5) * STEP;
      settle();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      press();
    } else if (e.key === 'Backspace' && !busy && entered.length) {
      e.preventDefault();
      entered.pop();
      render();
    }
  });

  announce();
  render();
}
