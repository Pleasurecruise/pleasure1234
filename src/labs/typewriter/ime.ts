// SPDX-License-Identifier: GPL-3.0-only
import {
  KeyKind,
  createMsimeEngine,
  createShiftTap,
  keyFromEvent,
  osImeIntercepting,
  packKey,
  version,
  type MsimeEngine,
  type MsimeFrame,
} from '@msime/web-engine';

export type { MsimeFrame };
export type Scheme = 'quanpin' | 'microsoft';

const NATIVE_WHEN_IDLE = new Set([
  packKey(KeyKind.Enter),
  packKey(KeyKind.Backspace),
  packKey(KeyKind.BackspaceWord),
  packKey(KeyKind.Escape),
  packKey(KeyKind.PagePrev),
  packKey(KeyKind.PageNext),
]);
const EDIT_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export interface ImeHooks {
  commit(text: string, seat: number, before: MsimeFrame | null, picked: HTMLElement | null): void;
  type(text: string): void;
  back(word: boolean): void;
  frame(f: MsimeFrame): void;
  idleKey(e: KeyboardEvent): void;
  shortcut(e: KeyboardEvent): boolean;
  paste(text: string): void;
  status(text: string): void;
}

export interface Ime {
  readonly composing: boolean;
  pick(slot: number, el: HTMLElement): void;
  press(kind: 'prev' | 'next' | 'english'): void;
  setScheme(scheme: Scheme): void;
  abandon(): void;
  later(task: () => unknown): void;
}

/**
 * Binds the Shuishan web engine to a hidden password field. Browsers and operating systems switch
 * their own input method off in password fields, so every key reaches this engine instead. Engine
 * keys and the page's own edits run through one queue, so a fast Enter after a pick is never misread.
 */
export function attachIme(keys: HTMLInputElement, hooks: ImeHooks, options: { scheme: Scheme; base: string }): Ime {
  const shift = createShiftTap();
  let engine: MsimeEngine | null = null;
  let last: MsimeFrame | null = null;
  let composing = false;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const later = (task: () => unknown) => {
    queue = queue.then(task).catch(() => {});
  };

  const apply = (gen: number, f: MsimeFrame, picked: HTMLElement | null = null) => {
    if (gen !== generation) return;
    for (const item of f.out) {
      if (item.t === 'commit') hooks.commit(item.text, item.seat, last, picked);
      else if (item.t === 'type') hooks.type(item.text);
      else if (item.t === 'back') hooks.back(item.word);
    }
    composing = f.composing;
    last = f;
    hooks.frame(f);
  };

  const send = (run: (live: MsimeEngine) => Promise<MsimeFrame>, picked: HTMLElement | null = null) => {
    const live = engine;
    if (!live) return;
    const gen = generation;
    later(async () => apply(gen, await run(live), picked));
  };

  const reset = (live: MsimeEngine) => {
    generation += 1;
    composing = false;
    const gen = generation;
    later(async () => apply(gen, await live.reset()));
  };

  const onKey = (e: KeyboardEvent) => {
    shift.down(e);
    if (osImeIntercepting(e)) return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key === 'Backspace' && !composing) {
        e.preventDefault();
        hooks.back(true);
      } else if (hooks.shortcut(e)) {
        e.preventDefault();
        if (composing && engine) reset(engine);
      }
      return;
    }
    if (e.key === 'Tab' || !(e.key.length === 1 || EDIT_KEYS.has(e.key))) return;
    e.preventDefault();
    later(async () => {
      const live = engine;
      const key = live ? keyFromEvent(e, { composing }) : null;
      if (live && key !== null && (composing || !NATIVE_WHEN_IDLE.has(key))) {
        apply(generation, await live.keys(key));
      } else if (!composing) {
        if (e.key.length === 1 && !live) return;
        hooks.idleKey(e);
      }
    });
  };

  keys.addEventListener('keydown', onKey);
  keys.addEventListener('keyup', (e) => {
    if (shift.up(e)) send((live) => live.keys(packKey(KeyKind.ShiftTap)));
  });
  keys.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.inputType === 'insertText' && e.data) {
      for (const ch of e.data) onKey(new KeyboardEvent('keydown', { key: ch }));
    } else if (e.inputType === 'deleteContentBackward') {
      onKey(new KeyboardEvent('keydown', { key: 'Backspace' }));
    } else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    }
  });
  keys.addEventListener('input', () => {
    keys.value = '';
  });
  keys.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    ime.abandon();
    later(() => hooks.paste(text));
  });

  const ime: Ime = {
    get composing() {
      return composing;
    },
    pick(slot, el) {
      const f = last;
      if (!f) return;
      send((live) => live.pick(slot, f.candidateRevision, f.page[slot]?.text, f.pageStart), el);
    },
    press(kind) {
      const k = kind === 'prev' ? KeyKind.PagePrev : kind === 'next' ? KeyKind.PageNext : KeyKind.ShiftTap;
      send((live) => live.keys(packKey(k)));
    },
    setScheme(scheme) {
      const live = engine;
      if (!live) return;
      generation += 1;
      composing = false;
      const gen = generation;
      later(async () => {
        await live.setScheme(scheme);
        apply(gen, await live.reset());
      });
    },
    abandon() {
      if (engine && composing) reset(engine);
    },
    later,
  };

  hooks.status('Threading the ribbon… 0%');
  createMsimeEngine({
    scheme: options.scheme,
    assetBase: `${options.base}msime/${version}/assets/`,
    model: false,
    onProgress: (loaded, total) => hooks.status(`Threading the ribbon… ${total ? Math.round((loaded / total) * 100) : 0}%`),
  })
    .then((made) => {
      engine = made;
      made.onError(() => {
        engine = null;
        hooks.status('The typewriter jammed. Reload to try again.');
      });
      hooks.status('');
      reset(made);
    })
    .catch((error: { code?: string }) => {
      hooks.status(
        error.code === 'unsupported'
          ? 'This browser can’t run the typewriter (it needs WebAssembly and module workers).'
          : 'Couldn’t load the typewriter. Check the connection and reload.',
      );
    });

  addEventListener('pagehide', () => engine?.dispose());
  return ime;
}
