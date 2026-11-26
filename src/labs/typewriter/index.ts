// SPDX-License-Identifier: GPL-3.0-only
import { find } from '../../lib/dom';
import { createBasket } from './basket';
import { attachIme, type MsimeFrame, type Scheme } from './ime';
import { createSheet } from './sheet';

const SCHEME_KEY = 'tw-scheme';
const SCHEME_LABEL: Record<Scheme, { key: string; name: string }> = {
  quanpin: { key: '全拼', name: 'Full pinyin' },
  microsoft: { key: '双拼', name: 'Microsoft shuangpin' },
};
const BELL_AT = 0.86;

interface Parts {
  machine: HTMLElement;
  window: HTMLElement;
  carriage: HTMLElement;
  feed: HTMLElement;
  paper: HTMLTextAreaElement;
  keys: HTMLInputElement;
  pencil: HTMLElement;
  basket: HTMLElement;
  lever: HTMLButtonElement;
  bell: HTMLElement;
  shiftLock: HTMLButtonElement;
  scheme: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  status: HTMLElement;
  base: string;
}

export function mountTypewriter(parts: Parts) {
  const { machine, window: slot, carriage, feed, paper, keys, pencil, lever, bell, shiftLock, prev, next, status, base } = parts;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const grab = () => keys.focus({ preventScroll: true });
  const restart = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };
  let scheme: Scheme = localStorage.getItem(SCHEME_KEY) === 'microsoft' ? 'microsoft' : 'quanpin';
  let rung = false;

  const strikePoint = () => ({
    x: slot.clientWidth / 2,
    y: slot.clientHeight - (Number.parseFloat(getComputedStyle(machine).getPropertyValue('--strike-gap')) || 46),
  });

  const place = (returning: boolean) => {
    paper.style.height = 'auto';
    paper.style.height = `${paper.scrollHeight}px`;
    const c = sheet.caret();
    const strike = strikePoint();
    carriage.classList.toggle('is-returning', returning);
    carriage.style.transform = `translateX(${(strike.x - c.left).toFixed(1)}px)`;
    feed.style.transform = `translateY(${(strike.y - c.top - c.line / 2).toFixed(1)}px)`;
    const across = c.left / paper.clientWidth;
    if (!rung && across > BELL_AT) {
      rung = true;
      restart(bell, 'is-ringing');
    } else if (across < 0.5) {
      rung = false;
    }
  };

  const sheet = createSheet(paper, place);
  const basket = createBasket(parts.basket, still);

  const ink = (text: string) => {
    if (still()) return;
    const strike = strikePoint();
    const mark = document.createElement('span');
    mark.className = 'tw-ink';
    mark.textContent = text;
    mark.style.left = `${strike.x}px`;
    mark.style.top = `${strike.y}px`;
    slot.append(mark);
    const gone = () => mark.remove();
    mark
      .animate(
        [
          { opacity: 0, transform: 'translate(0, -50%) scale(1.25)' },
          { opacity: 1, transform: 'translate(0, -50%) scale(1)', offset: 0.25 },
          { opacity: 0, transform: 'translate(0, -50%) scale(1)' },
        ],
        { duration: 380, easing: 'ease-out' },
      )
      .finished.then(gone, gone);
    machine.animate([{ transform: 'none' }, { transform: 'translateY(1px)', offset: 0.3 }, { transform: 'none' }], { duration: 160 });
  };

  const carriageReturn = () => {
    restart(lever, 'is-thrown');
    sheet.insert('\n');
  };

  const showPencil = (f: MsimeFrame) => {
    pencil.hidden = !f.composing;
    if (!f.composing) return;
    const caret = () => Object.assign(document.createElement('i'), { className: 'tw-pencil-caret' });
    const chars = [...f.preedit];
    pencil.replaceChildren(...chars.flatMap((ch, i) => (i === f.caret ? [caret(), ch === "'" ? '·' : ch] : [ch === "'" ? '·' : ch])));
    if (f.caret >= chars.length) pencil.append(caret());
  };

  const face = (key: HTMLElement) => find(key, '.tw-key-face', HTMLElement);

  const ime = attachIme(
    keys,
    {
      commit(text, seat, before, picked) {
        basket.strike(picked ?? (seat >= 0 && before ? basket.bar(seat - (before.pageStart ?? 0)) : null));
        sheet.insert(text);
        ink(text);
      },
      type(text) {
        sheet.insert(text);
        ink(text);
      },
      back: (word) => sheet.deleteBack(word),
      frame(f) {
        showPencil(f);
        basket.render(f);
        prev.disabled = !f.hasPrev;
        next.disabled = !f.hasNext;
        shiftLock.setAttribute('aria-pressed', String(f.english));
        face(shiftLock).textContent = f.english ? 'A' : '中';
      },
      idleKey(e) {
        if (e.key === 'Backspace') sheet.deleteBack(e.altKey);
        else if (e.key === 'Delete') sheet.deleteForward();
        else if (e.key === 'Enter') carriageReturn();
        else if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') sheet.navigate(e.key);
        else if (e.key.length === 1) sheet.insert(e.key);
      },
      shortcut(e) {
        const k = e.key.toLowerCase();
        if (k === 'a') sheet.selectAll();
        else if (k === 'c' || k === 'x') sheet.copy(k === 'x');
        else return false;
        return true;
      },
      paste: (text) => sheet.insert(text),
      status: (text) => {
        status.textContent = text;
      },
    },
    { scheme, base },
  );

  const showScheme = () => {
    face(parts.scheme).textContent = SCHEME_LABEL[scheme].key;
    parts.scheme.setAttribute('aria-label', `${SCHEME_LABEL[scheme].name}. Press to switch`);
  };

  paper.readOnly = true;
  paper.addEventListener('mousedown', () => ime.abandon());
  paper.addEventListener('mouseup', () =>
    requestAnimationFrame(() => {
      if (paper.selectionStart !== paper.selectionEnd) return;
      place(false);
      grab();
    }),
  );
  paper.addEventListener('focus', () => {
    if (paper.selectionStart === paper.selectionEnd && !paper.matches(':active')) grab();
  });
  paper.addEventListener('keydown', (e) => {
    if (['Tab', 'Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() !== 'x') return;
    grab();
    keys.dispatchEvent(new KeyboardEvent('keydown', e));
    e.preventDefault();
  });
  keys.addEventListener('blur', () => ime.abandon());
  slot.addEventListener('mousedown', (e) => {
    if (e.target !== slot) return;
    e.preventDefault();
    grab();
  });

  for (const el of [parts.basket, prev, next, shiftLock, parts.scheme, lever]) el.addEventListener('mousedown', (e) => e.preventDefault());

  parts.basket.addEventListener('click', (e) => {
    const bar = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.tw-bar') : null;
    if (!bar || bar.disabled) return;
    ime.pick(Number(bar.dataset.slot), bar);
    grab();
  });
  prev.addEventListener('click', () => {
    ime.press('prev');
    grab();
  });
  next.addEventListener('click', () => {
    ime.press('next');
    grab();
  });
  shiftLock.addEventListener('click', () => {
    ime.press('english');
    grab();
  });
  lever.addEventListener('click', () => {
    if (!ime.composing) ime.later(carriageReturn);
    grab();
  });
  parts.scheme.addEventListener('click', () => {
    scheme = scheme === 'quanpin' ? 'microsoft' : 'quanpin';
    localStorage.setItem(SCHEME_KEY, scheme);
    showScheme();
    ime.setScheme(scheme);
    grab();
  });

  new ResizeObserver(() => place(false)).observe(slot);
  void document.fonts.ready.then(() => place(false));
  showScheme();
  grab();
}
