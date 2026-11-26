import { find } from '../../lib/dom';
import { Spring, animator, clamp } from './kit';
import { isDark, setTheme } from './theme';

const AX = 150;
const REST = 112;
const CLICK = 24;
const REACH = 58;

export function mountCord(tile: HTMLElement) {
  const svg = find(tile, 'svg', SVGSVGElement);
  const line = find(svg, '.cord-line', SVGPathElement);
  const bead = find(svg, '.cord-bead', SVGGElement);

  const ex = new Spring(AX, 200, 6);
  const ey = new Spring(REST, 280, 8);
  const mx = new Spring(AX, 70, 4);
  const my = new Spring(REST / 2, 120, 6);

  let on = !isDark();
  let armed = true;
  let drag: { id: number; x: number; y: number; moved: number } | null = null;

  const flip = () => {
    on = !on;
    bead.setAttribute('aria-checked', String(on));
    const r = find(svg, '.lamp-bulb', SVGCircleElement).getBoundingClientRect();
    setTheme(!on, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const toSvg = (e: PointerEvent) => {
    const m = svg.getScreenCTM();
    return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : new DOMPoint(AX, REST);
  };

  const draw = () => {
    const cx = 2 * mx.value - (AX + ex.value) / 2;
    const cy = 2 * my.value - ey.value / 2;
    line.setAttribute('d', `M${AX} 0Q${cx.toFixed(2)} ${cy.toFixed(2)} ${ex.value.toFixed(2)} ${ey.value.toFixed(2)}`);
    const tilt = (Math.atan2(ex.value - cx, ey.value - cy) * -180) / Math.PI;
    bead.setAttribute('transform', `translate(${ex.value.toFixed(2)} ${ey.value.toFixed(2)}) rotate(${tilt.toFixed(2)})`);
  };

  const pulled = () => {
    if (armed && ey.value - REST > CLICK) {
      armed = false;
      flip();
    }
  };

  const run = animator((dt) => {
    if (!drag) {
      ex.step(dt);
      ey.step(dt);
    }
    mx.target = (AX + ex.value) / 2;
    my.target = ey.value / 2;
    mx.step(dt);
    my.step(dt);
    draw();
    return drag !== null || !(ex.resting && ey.resting && mx.resting && my.resting);
  });

  const tug = () => {
    flip();
    ey.velocity = 560;
    ex.velocity = (Math.random() - 0.5) * 120;
    run();
  };

  bead.addEventListener('pointerdown', (e) => {
    const p = toSvg(e);
    drag = { id: e.pointerId, x: p.x - ex.value, y: p.y - ey.value, moved: 0 };
    armed = true;
    bead.setPointerCapture(e.pointerId);
    tile.classList.add('is-pulling');
    run();
  });

  bead.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toSvg(e);
    const dy = p.y - drag.y - REST;
    const dx = p.x - drag.x - AX;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const nx = AX + clamp(dx * 0.4, -34, 34);
    const ny = REST + (dy > 0 ? REACH * (1 - Math.exp(-dy / REACH)) : dy * 0.15);
    ex.velocity = (nx - ex.value) * 60;
    ey.velocity = (ny - ey.value) * 60;
    ex.value = nx;
    ey.value = ny;
    pulled();
  });

  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tap = drag.moved < 3;
    drag = null;
    tile.classList.remove('is-pulling');
    if (tap) tug();
    else run();
  };
  bead.addEventListener('pointerup', release);
  bead.addEventListener('pointercancel', release);

  bead.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    tug();
  });

  draw();
}
