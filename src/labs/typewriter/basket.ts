import type { MsimeFrame } from './ime';

const SPREAD = 140;
const RESTING = 9;

export interface Basket {
  render(f: MsimeFrame): void;
  bar(slot: number): HTMLElement | null;
  strike(bar: HTMLElement | null): void;
}

export function createBasket(el: HTMLElement, still: () => boolean): Basket {
  let lastPage = -1;

  const radius = () =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue('--radius')) * Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 160;

  const make = (text: string | null, i: number, angle: number, up: boolean) => {
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.tabIndex = -1;
    bar.className = up ? 'tw-bar is-up' : 'tw-bar';
    bar.disabled = text === null;
    bar.dataset.slot = String(i);
    bar.style.setProperty('--a', `${-angle}deg`);
    if (text === null) {
      bar.setAttribute('aria-hidden', 'true');
    } else {
      bar.setAttribute('role', 'option');
      bar.setAttribute('aria-selected', String(up));
      bar.setAttribute('aria-label', `${(i + 1) % 10} ${text}`);
    }
    const stick = document.createElement('span');
    stick.className = 'tw-stick';
    const arm = document.createElement('span');
    arm.className = 'tw-arm';
    const slug = document.createElement('span');
    const len = text ? [...text].length : 0;
    slug.className = text === null ? 'tw-slug is-blank' : len >= 5 ? 'tw-slug is-long' : len >= 3 ? 'tw-slug is-wide' : 'tw-slug';
    slug.textContent = text ?? '';
    const num = document.createElement('span');
    num.className = 'tw-num';
    num.textContent = String((i + 1) % 10);
    stick.append(arm, slug, num);
    bar.append(stick);
    return bar;
  };

  return {
    render(f) {
      const live = f.composing && f.page.length > 0;
      const turned = live && lastPage !== -1 && f.pageIndex !== lastPage;
      const dir = f.pageIndex > lastPage ? 1 : -1;
      lastPage = live ? f.pageIndex : -1;
      const texts = live ? f.page.map((r) => r.text) : Array.from({ length: RESTING }, () => null);
      const step = texts.length > 1 ? SPREAD / (texts.length - 1) : 0;
      el.replaceChildren(...texts.map((t, i) => make(t, i, texts.length > 1 ? -SPREAD / 2 + i * step : 0, live && i === f.highlight)));
      if (turned && !still()) el.animate([{ transform: `rotate(${dir * 12}deg)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'ease-out' });
    },

    bar: (slot) => el.querySelector<HTMLElement>(`.tw-bar[data-slot="${slot}"]`),

    strike(bar) {
      const stick = bar?.querySelector<HTMLElement>('.tw-stick');
      if (!bar || !stick || still()) return;
      const r = radius();
      bar.classList.add('is-striking');
      const done = () => bar.classList.remove('is-striking');
      stick
        .animate(
          [
            { transform: `translateY(${r}px)` },
            { transform: 'translateY(14px)', offset: 0.42, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
            { transform: `translateY(${r * 0.35}px)`, offset: 0.62 },
            { transform: `translateY(${r}px)` },
          ],
          { duration: 300 },
        )
        .finished.then(done, done);
    },
  };
}
