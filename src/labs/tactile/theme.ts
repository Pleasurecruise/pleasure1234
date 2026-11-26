import { prefersStill } from './kit';

const root = document.documentElement;

export const isDark = () => root.dataset.theme === 'dark';

export function setTheme(dark: boolean, from: { x: number; y: number }) {
  const apply = () => {
    root.dataset.theme = dark ? 'dark' : 'light';
  };
  if (!document.startViewTransition || prefersStill()) {
    apply();
    return;
  }
  const { x, y } = from;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(apply);
  void transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.25, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}
