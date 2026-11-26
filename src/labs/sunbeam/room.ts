import { face, inPoly, stroke, tone, type Pt, type Sheet } from './paper';
import { noise } from './util';

export type V3 = [x: number, y: number, z: number];

export const ROOM_X = 204, ROOM_Z = 170;
const ROOM_H = 96;
const ORIGIN: Pt = [133, 96];
const EX: Pt = [Math.cos(0.524), Math.sin(0.524)];
const EZ: Pt = [-Math.cos(0.593) * 0.9, Math.sin(0.593) * 0.9];
const EY = 0.95;
export const P = ([x, y, z]: V3): Pt => [ORIGIN[0] + x * EX[0] + z * EZ[0], ORIGIN[1] + x * EX[1] + z * EZ[1] - y * EY];
const DET = EX[0] * EZ[1] - EZ[0] * EX[1];
/** The room point at height y under a screen point. */
export const unproject = (sx: number, sy: number, y = 0): [number, number] => {
  const dx = sx - ORIGIN[0], dy = sy + y * EY - ORIGIN[1];
  return [(dx * EZ[1] - EZ[0] * dy) / DET, (EX[0] * dy - dx * EX[1]) / DET];
};

const WIN = { z0: 52, z1: 112, y0: 38, y1: 80 };
export const WINDOW_CENTRE: V3 = [0, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2];

/** Footprint and height in room units; `perch` if things can rest on top. */
export const FURNITURE = [
  { x0: 104, x1: 170, z0: 0, z1: 16, top: 42, perch: true },
  { x0: 8, x1: 30, z0: 4, z1: 20, top: 11, perch: true },
  { x0: 182, x1: 198, z0: 6, z1: 22, top: 80, perch: false },
];

interface Shades { top: number; lit: number; dark: number }
export const shades = (s: Sheet, col: string, a: number): Shades => ({ top: tone(s, col, a * 0.55), lit: tone(s, col, a * 0.85), dark: tone(s, col, a * 1.15) });

function block(s: Sheet, [x0, y0, z0]: V3, [x1, y1, z1]: V3, t: Shades) {
  face(s, [P([x0, y1, z0]), P([x1, y1, z0]), P([x1, y1, z1]), P([x0, y1, z1])], t.top);
  face(s, [P([x0, y0, z1]), P([x1, y0, z1]), P([x1, y1, z1]), P([x0, y1, z1])], t.lit);
  face(s, [P([x1, y0, z0]), P([x1, y0, z1]), P([x1, y1, z1]), P([x1, y1, z0])], t.dark);
}

export const disc = (cx: number, y: number, cz: number, r: number, n = 24): Pt[] =>
  Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return P([cx + Math.cos(t) * r, y, cz + Math.sin(t) * r]); });

function drum(s: Sheet, cx: number, y0: number, y1: number, cz: number, r: number, side: number, top: number) {
  face(s, [...disc(cx, y0, cz, r).slice(0, 13), ...disc(cx, y1, cz, r).slice(0, 13).reverse()], side);
  face(s, disc(cx, y1, cz, r), top);
}

export function drawRoom(s: Sheet) {
  const wallR = tone(s, '#e8decf', 0.5), wallL = tone(s, '#d9cbb6', 0.55), floor = tone(s, '#e3c49a', 0.45);
  const glass = tone(s, '#cfe0e6', 0.55), skirting = tone(s, '#cdbda6', 0.5), rug = tone(s, '#c9a7a0', 0.38);

  face(s, [P([0, 0, 0]), P([ROOM_X, 0, 0]), P([ROOM_X, ROOM_H, 0]), P([0, ROOM_H, 0])], wallR);
  face(s, [P([0, 0, 0]), P([0, 0, ROOM_Z]), P([0, ROOM_H, ROOM_Z]), P([0, ROOM_H, 0])], wallL);
  face(s, [P([0, 0, 0]), P([ROOM_X, 0, 0]), P([ROOM_X, 0, ROOM_Z]), P([0, 0, ROOM_Z])], floor);
  face(s, [P([0, 0, 0]), P([ROOM_X, 0, 0]), P([ROOM_X, 5, 0]), P([0, 5, 0])], skirting);
  face(s, [P([0, 0, 0]), P([0, 0, ROOM_Z]), P([0, 5, ROOM_Z]), P([0, 5, 0])], skirting);
  for (let x = 14; x < ROOM_X; x += 14) stroke(s, P([x, 0, 0]), P([x, 0, ROOM_Z]), 2, floor);

  const { z0, z1, y0, y1 } = WIN, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
  face(s, [P([0, y0, z0]), P([0, y0, z1]), P([0, y1, z1]), P([0, y1, z0])], glass);
  stroke(s, P([0, y0, mz]), P([0, y1, mz]), 3);
  stroke(s, P([0, my, z0]), P([0, my, z1]), 3);
  block(s, [0, y0 - 3, z0 - 5], [6, y0, z1 + 5], shades(s, '#efe7da', 0.5));
  block(s, [0, 8, z0 + 2], [5, 30, z1 - 2], shades(s, '#e9e6e1', 0.55));
  for (let z = z0 + 7; z < z1 - 2; z += 6) stroke(s, P([5, 10, z]), P([5, 28, z]), 2);

  face(s, [P([64, 0, 82]), P([170, 0, 82]), P([170, 0, 150]), P([64, 0, 150])], rug);
  for (let x = 74; x < 170; x += 12) stroke(s, P([x, 0, 82]), P([x, 0, 150]), 2, rug);

  const [shelf, books, plant] = FURNITURE;
  block(s, [shelf.x0, 0, shelf.z0], [shelf.x1, shelf.top, shelf.z1], shades(s, '#b89a7a', 0.55));
  const spines = ['#8a9bb0', '#c47f6a', '#d8b77a', '#7e9a83', '#a88ca6', '#c9a27e'];
  for (let i = 0, bx = shelf.x0 + 4; bx < shelf.x1 - 4; i++) {
    const wdt = 4 + (i * 7) % 4, ht = 14 + (i * 5) % 6;
    face(s, [P([bx, 22, shelf.z1]), P([bx + wdt, 22, shelf.z1]), P([bx + wdt, 22 + ht, shelf.z1]), P([bx, 22 + ht, shelf.z1])], tone(s, spines[i % spines.length], 0.55));
    bx += wdt + 0.6;
  }
  stroke(s, P([shelf.x0, 21, shelf.z1]), P([shelf.x1, 21, shelf.z1]), 3);

  const px = (plant.x0 + plant.x1) / 2, pz = (plant.z0 + plant.z1) / 2;
  drum(s, px, 0, 16, pz, 8, tone(s, '#c6825e', 0.6), tone(s, '#8b6a52', 0.55));
  const leaf = tone(s, '#7f9e6e', 0.6);
  for (const [dx, dz, hgt, lean] of [[-3, 0, 52, -4], [0, -2, 62, 1], [3, 1, 46, 5], [1, 3, 40, -2], [-2, -3, 34, 7]]) {
    const [ax, ay] = P([px + dx, 16, pz + dz]), [tx, ty] = P([px + dx + lean, 16 + hgt, pz + dz]);
    face(s, [[ax - 1.6, ay], [ax + 1.6, ay], [tx + 0.3, ty + 2], [tx, ty], [tx - 0.3, ty + 2]], leaf);
  }

  block(s, [books.x0, 0, books.z0], [books.x1, 4, books.z1], shades(s, '#9fb3a6', 0.55));
  block(s, [books.x0 + 2, 4, books.z0 + 1], [books.x1 - 1, 8, books.z1 - 1], shades(s, '#d4a27e', 0.55));
  block(s, [books.x0 + 1, 8, books.z0 + 2], [books.x1 - 3, books.top, books.z1 - 2], shades(s, '#8e98b4', 0.55));
  drum(s, (books.x0 + books.x1) / 2, books.top, books.top + 9, (books.z0 + books.z1) / 2, 4, tone(s, '#e9e2d6', 0.6), tone(s, '#7a5a45', 0.6));
  return { floor, rug };
}

/** Light through each pane of the window, landing on the given tones, for sun travelling along `dir`. */
export function sunlight(s: Sheet, dir: V3, onto: Set<number>) {
  s.sun.fill(0);
  const { z0, z1, y0, y1 } = WIN, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
  const land = ([x, y, z]: V3): V3 => { const t = y / -dir[1]; return [x + dir[0] * t, 0, z + dir[2] * t]; };
  const panes = [[z0, mz, y0, my], [mz, z1, y0, my], [z0, mz, my, y1], [mz, z1, my, y1]];
  const shapes = panes.map(([a, b, c, d]) => {
    const corners: V3[] = [[0, c + 1, a + 1], [0, c + 1, b - 1], [0, d - 1, b - 1], [0, d - 1, a + 1]];
    return corners.map((v) => P(land(v)));
  });
  const { w, q } = s;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < w; x++) {
    if (!onto.has(s.room[y * w + x])) continue;
    const jx = x / q + (noise(x / 8, y / 8, 31) - 0.5) * 1.6, jy = y / q + (noise(x / 8, y / 8, 37) - 0.5) * 1.6;
    if (shapes.some((sh) => inPoly(jx, jy, sh))) s.sun[y * w + x] = 1;
  }
}
