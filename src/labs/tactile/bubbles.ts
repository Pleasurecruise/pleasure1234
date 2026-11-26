import { find, findAll } from '../../lib/dom';

const SQUEEZE_MS = 240;
const NEAR = 1.7;

export function mountBubbles(tile: HTMLElement) {
  const sheet = find(tile, '.wrap-sheet', HTMLElement);
  const cells = findAll(sheet, '.wrap-cell', HTMLLabelElement);
  const summary = find(tile, '.wrap-summary', HTMLElement);
  const box = (cell: HTMLLabelElement) => find(cell, 'input', HTMLInputElement);
  const bubble = (cell: HTMLLabelElement) => find(cell, '.bubble', HTMLElement);

  let press: { cell: HTMLLabelElement; timer: number } | null = null;
  let rubbing = false;

  const update = () => {
    const picked = cells.filter((c) => box(c).checked).length;
    summary.textContent = picked === 0 ? 'nothing packed yet' : picked === cells.length ? 'all packed' : `${picked} of ${cells.length} packed`;
  };

  const restart = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const puff = (cell: HTMLLabelElement) => {
    const air = document.createElement('span');
    air.className = 'puff';
    const turn = Math.random() * 60;
    for (let i = 0; i < 6; i++) {
      const line = document.createElement('i');
      line.style.setProperty('--a', `${(turn + i * 60 + (Math.random() * 20 - 10)).toFixed(1)}deg`);
      line.style.setProperty('--r', (0.9 + Math.random() * 0.5).toFixed(2));
      air.append(line);
    }
    cell.append(air);
    air.addEventListener('animationend', () => air.remove(), { once: true });
  };

  const jostle = (from: HTMLLabelElement) => {
    const a = bubble(from).getBoundingClientRect();
    for (const cell of cells) {
      if (cell === from) continue;
      const el = bubble(cell);
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const d = dist / a.width;
      if (d > NEAR) continue;
      const k = (1 - d / NEAR) * 4;
      el.style.setProperty('--jx', `${((dx / dist) * k).toFixed(2)}px`);
      el.style.setProperty('--jy', `${((dy / dist) * k).toFixed(2)}px`);
      restart(el, 'is-jostled');
    }
  };

  const pop = (cell: HTMLLabelElement) => {
    const input = box(cell);
    if (input.checked) return;
    input.checked = true;
    const b = bubble(cell);
    b.classList.remove('is-squeezing', 'is-inflating');
    b.style.setProperty('--crease', `${Math.round(Math.random() * 180)}deg`);
    b.style.setProperty('--skew', `${(Math.random() * 8 - 4).toFixed(1)}deg`);
    restart(b, 'is-popping');
    puff(cell);
    jostle(cell);
    update();
  };

  const reinflate = (cell: HTMLLabelElement) => {
    const input = box(cell);
    if (!input.checked) return;
    input.checked = false;
    const b = bubble(cell);
    b.classList.remove('is-popping');
    restart(b, 'is-inflating');
    update();
  };

  const release = () => {
    if (!press) return;
    clearTimeout(press.timer);
    bubble(press.cell).classList.remove('is-squeezing');
    press = null;
  };

  const cellAt = (target: EventTarget | null) => (target instanceof Element ? target.closest('.wrap-cell') : null);

  sheet.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('.wrap-cell');
    if (!(cell instanceof HTMLLabelElement)) return;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    rubbing = true;
    if (box(cell).checked) {
      press = { cell, timer: 0 };
      return;
    }
    bubble(cell).classList.add('is-squeezing');
    press = { cell, timer: window.setTimeout(() => pop(cell), SQUEEZE_MS) };
  });

  sheet.addEventListener('pointerup', (e) => {
    if (press && cellAt(e.target) === press.cell) {
      if (press.timer === 0) reinflate(press.cell);
      else pop(press.cell);
    }
    release();
  });

  sheet.addEventListener('pointerover', (e) => {
    if (!rubbing || !e.buttons) return;
    const cell = cellAt(e.target);
    if (cell instanceof HTMLLabelElement && cell !== press?.cell) pop(cell);
  });
  sheet.addEventListener('pointerout', (e) => {
    if (!press || press.timer === 0 || !e.buttons) return;
    if (cellAt(e.target) !== press.cell || cellAt(e.relatedTarget) === press.cell) return;
    const cell = press.cell;
    release();
    pop(cell);
  });
  const stop = () => {
    rubbing = false;
    release();
  };
  addEventListener('pointerup', stop);
  addEventListener('pointercancel', stop);

  sheet.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
  cells.forEach((cell) =>
    box(cell).addEventListener('change', () => {
      const input = box(cell);
      input.checked = !input.checked;
      if (input.checked) reinflate(cell);
      else pop(cell);
    }),
  );

  cells.forEach((cell) => {
    const b = bubble(cell);
    b.addEventListener('animationend', (e) => {
      if (e.target === b) b.classList.remove('is-popping', 'is-inflating', 'is-jostled');
    });
  });

  tile.addEventListener('pointermove', (e) => {
    const r = sheet.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    sheet.style.setProperty('--hx', `${(24 + x * 26).toFixed(1)}%`);
    sheet.style.setProperty('--hy', `${(22 + y * 24).toFixed(1)}%`);
  });

  update();
}
