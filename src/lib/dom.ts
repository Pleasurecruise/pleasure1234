type Ctor<T> = abstract new (...args: never[]) => T;

/** The value, or a thrown error naming what was missing. For things the page guarantees. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

export function byId<T extends HTMLElement>(id: string, type: Ctor<T>): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return el;
}

export function find<T extends Element>(root: ParentNode, selector: string, type: Ctor<T>): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`${selector} is missing or not a ${type.name}`);
  return el;
}

/** Every match, each checked to be of the expected type. */
export function findAll<T extends Element>(root: ParentNode, selector: string, type: Ctor<T>): T[] {
  return Array.from(root.querySelectorAll(selector), (el) => {
    if (!(el instanceof type)) throw new Error(`${selector} matched a non-${type.name}`);
    return el;
  });
}

export function context2d(canvas: HTMLCanvasElement, settings: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  return need(canvas.getContext('2d', settings), '2d canvas context');
}
