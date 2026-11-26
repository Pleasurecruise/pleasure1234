export type Col = number;
export const pack = (r: number, g: number, b: number): Col => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const hex = (h: string): Col => { const n = parseInt(h.slice(1), 16); return pack(n >> 16, (n >> 8) & 255, n & 255); };
export const mix = (a: Col, b: Col, t: number): Col => {
  const ar = a & 255, ag = (a >> 8) & 255, ab = (a >> 16) & 255;
  return pack(
    Math.round(ar + ((b & 255) - ar) * t),
    Math.round(ag + (((b >> 8) & 255) - ag) * t),
    Math.round(ab + (((b >> 16) & 255) - ab) * t),
  );
};
export const luma = (c: Col) => (c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + s * 7919, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export const noise = (x: number, y: number, s: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;
