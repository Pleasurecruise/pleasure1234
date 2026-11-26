export interface Lab {
  slug: string;
  title: string;
  description: string;
  date: string;
  poster: string;
  pixelated: boolean;
  /** Who the idea came from; null for my own designs. */
  credit: { name: string; href: string } | null;
}

export const labs: Lab[] = [
  {
    slug: 'typewriter',
    title: 'Typewriter',
    description: 'A pinyin input method on a typewriter: candidates fan out as type bars and strike the paper.',
    date: '2026-11-25',
    poster: 'lab/typewriter/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'tactile',
    title: 'Tactile',
    description: 'Everyday controls as gestures: a lamp cord, scratch foil, bubble wrap, a safe dial and a tape measure.',
    date: '2026-11-25',
    poster: 'lab/tactile/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'typetone',
    title: 'Typetone',
    description: 'A chat box whose equalizer bars are your keyboard laid flat; Clawd types along.',
    date: '2026-11-25',
    poster: 'lab/typetone/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'sunbeam',
    title: 'Sunbeam',
    description: 'A pen-and-wash cat that keeps your local time and naps where the sun falls.',
    date: '2026-11-20',
    poster: 'lab/sunbeam/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'highland-wedding',
    title: 'Highland Wedding',
    description: 'A Highland wedding from my own photo, redrawn as live pixel art in mist and drizzle.',
    date: '2026-11-20',
    poster: 'lab/highland-wedding/poster.png',
    pixelated: true,
    credit: null,
  },
  {
    slug: 'cotton-band',
    title: 'Cotton Band',
    description: 'BanG Dream! plushies on a desk with real physics: stack, topple, pat.',
    date: '2026-11-20',
    poster: 'lab/cotton-band/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'pocket-farm',
    title: 'Pocket Farm',
    description: 'A tiny block farm with crops and a koi pond; poke anything.',
    date: '2026-11-20',
    poster: 'lab/pocket-farm/poster.png',
    credit: { name: '@annaxtime', href: 'https://x.com/annaxtime' },
    pixelated: false,
  },
  {
    slug: 'litter-check',
    title: 'Litter Check',
    description: 'A captcha for cats: stir the litter to find the clumps.',
    date: '2026-11-20',
    poster: 'lab/litter-check/poster.png',
    credit: { name: '@annaxtime', href: 'https://x.com/annaxtime' },
    pixelated: false,
  },
  {
    slug: 'pixel-grove',
    title: 'Pixel Grove',
    description: 'Three pixel trees swaying in the breeze; poke one to shake loose its leaves.',
    date: '2026-11-20',
    poster: 'lab/pixel-grove/poster.png',
    pixelated: true,
    credit: { name: '@SolutionB2u', href: 'https://x.com/SolutionB2u' },
  },
];
