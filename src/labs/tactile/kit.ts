export class Spring {
  velocity = 0;
  target: number;

  constructor(public value: number, public stiffness = 170, public damping = 14) {
    this.target = value;
  }

  step(dt: number) {
    const accel = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
  }

  get resting() {
    return Math.abs(this.velocity) < 0.02 && Math.abs(this.target - this.value) < 0.02;
  }

  snap(to = this.target) {
    this.value = this.target = to;
    this.velocity = 0;
  }
}

export function animator(step: (dt: number) => boolean): () => void {
  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    raf = step(dt) ? requestAnimationFrame(frame) : 0;
  };
  return () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const angleDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export function angleAround(el: Element, e: PointerEvent) {
  const r = el.getBoundingClientRect();
  return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
}

export const prefersStill = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
