import { hex, type Col } from './util';

type Kind = 'tabby' | 'solid' | 'tux' | 'calico' | 'point';
export interface Coat { kind: Kind; base: Col; mark: Col; mark2: Col; light: Col; eye: Col }
const coat = (kind: Kind, base: string, mark: string, mark2: string, light: string, eye: string): Coat =>
  ({ kind, base: hex(base), mark: hex(mark), mark2: hex(mark2), light: hex(light), eye: hex(eye) });

export const COATS = {
  ginger: coat('tabby', '#e8964f', '#c46c33', '#c46c33', '#f8e2c8', '#9cb648'),
  grey: coat('tabby', '#9da2aa', '#6c717b', '#6c717b', '#e9e6e0', '#d9a640'),
  black: coat('solid', '#37333c', '#37333c', '#37333c', '#37333c', '#e6c440'),
  tuxedo: coat('tux', '#37333c', '#37333c', '#37333c', '#f5f2ec', '#9ccf72'),
  calico: coat('calico', '#f6f2ea', '#e3914e', '#463e4c', '#f6f2ea', '#cf9f38'),
  cream: coat('tabby', '#efd9b5', '#dab585', '#dab585', '#fcf3e4', '#6da7d3'),
  siamese: coat('point', '#efe5d4', '#5e4839', '#5e4839', '#f8f2e8', '#5ba2e6'),
} satisfies Record<string, Coat>;
export type CoatKey = keyof typeof COATS;
const COAT_KEYS = Object.keys(COATS).filter(isCoatKey);
export function isCoatKey(k: string): k is CoatKey { return Object.hasOwn(COATS, k); }
export const randomCoat = (): CoatKey => COAT_KEYS[Math.floor(Math.random() * COAT_KEYS.length)];

export type Part = 'body' | 'head' | 'ear' | 'leg' | 'tail' | 'haunch';

export interface Pose {
  bx: number; by: number; brx: number; bry: number; tilt: number; hx: number; hy: number;
  legF: number; legB: number; haunch: number; tailA: number; tailC: number; tf: number;
  eye: number; ear: number; front: number; paw: number; pawX: number; pawY: number; wig: number;
  arch: number; bristle: number;
}

export const muzzleX = (P: Pose) => P.hx + 5.2 * (1 - P.front);

const base: Pose = {
  bx: 0, by: -18.5, brx: 22, bry: 7.1, tilt: 0, hx: 23, hy: -28.5, legF: 1, legB: 1, haunch: 0, tailA: 0.55, tailC: 0.13, tf: 0,
  eye: 1, ear: 0, front: 0, paw: 0, pawX: 0, pawY: 0, wig: 0, arch: 0, bristle: 0,
};
const pose = (o: Partial<Pose>): Pose => ({ ...base, ...o });
export const STRIDE = 10, DUTY = 0.62;
const sit = { bx: -2, by: -14.5, brx: 17, tilt: -1.05, hx: 4, hy: -33.5, legB: 0, haunch: 1, tailA: -1.3, tailC: -0.17, tf: 1, front: 0.35 };
export const POSES = {
  stand: pose({}),
  walk: pose({ hx: 24, hy: -27.5, tailA: 0.8, tailC: 0.16 }),
  sit: pose(sit),
  beg: pose({ ...sit, front: 1 }),
  loaf: pose({ by: -9.5, brx: 21, bry: 7.4, hx: 19.5, hy: -17, legF: 0, legB: 0, tailA: -0.2, tailC: -0.24, tf: 1, eye: 0.5, front: 0.3 }),
  sleep: pose({ by: -8, brx: 17.5, bry: 7, hx: 11.5, hy: -8, legF: 0, legB: 0, tailA: -0.2, tailC: -0.4, tf: 1, eye: 0, ear: 0.15, front: 0.5 }),
  crouch: pose({ bx: -1, by: -10.5, brx: 22, bry: 6.4, tilt: 0.1, hx: 21.5, hy: -14, legF: 0.6, legB: 0.6, tailA: 0.05, tailC: 0.015, ear: 0.3 }),
  eat: pose({ tilt: 0.12, hx: 25, hy: -11, tailA: 0.5 }),
  groom: pose({ ...sit, hx: 6, hy: -30, eye: 0, paw: 1, pawX: 9, pawY: -28, front: 0.2 }),
  swat: pose({ ...sit, paw: 1, pawX: 18, pawY: -24, ear: 1, eye: 0.5 }),
  tuck: pose({ by: -18, brx: 20, bry: 7.2, tilt: -0.12, hx: 21, hy: -27, legF: 0.35, legB: 0.35, tailA: 0.25, tailC: 0.1 }),
  arch: pose({ by: -21.5, brx: 19, bry: 7, hx: 22.5, hy: -25, tailA: 1.5, tailC: 0.015, ear: 1, arch: 1, bristle: 1 }),
  air: pose({ brx: 25, bry: 6.6, tilt: -0.12, hx: 27, hy: -24, tailA: 0.25, tailC: 0.015 }),
  stretch: pose({ by: -15, brx: 23, bry: 7, tilt: 0.32, hx: 25, hy: -10, tailA: 1.05, tailC: 0.04, eye: 0.2 }),
};
export type PoseName = keyof typeof POSES;
export const POSE_KEYS: readonly (keyof Pose)[] = [
  'bx', 'by', 'brx', 'bry', 'tilt', 'hx', 'hy', 'legF', 'legB', 'haunch', 'tailA', 'tailC', 'tf',
  'eye', 'ear', 'front', 'paw', 'pawX', 'pawY', 'wig', 'arch', 'bristle',
];
