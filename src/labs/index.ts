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
    slug: 'sunbeam',
    title: 'Sunbeam',
    description: 'A pixel cat that is yours alone, with a coat no one else gets. It keeps your local time, naps in the patch of sun crawling across the ground, and shares the floor with a box, a dish and a ball of yarn you can pick up and throw.',
    date: '2026-11-20',
    poster: 'lab/sunbeam/poster.png',
    pixelated: true,
    credit: null,
  },
  {
    slug: 'highland-wedding',
    title: 'Highland Wedding',
    description: 'A wedding by a loch in the Highlands, from my own photo, redrawn as live pixel art. Mist and a fine drizzle drift over the hills; drag a gust across the grass and watch the rain lean, or ripple the water.',
    date: '2026-11-20',
    poster: 'lab/highland-wedding/poster.png',
    pixelated: true,
    credit: null,
  },
  {
    slug: 'cotton-band',
    title: 'Cotton Band',
    description: 'BanG Dream! plushies on a white desk, picked from a toy box. Real physics: stack them into a pyramid, knock it over, pat a head.',
    date: '2026-11-20',
    poster: 'lab/cotton-band/poster.png',
    pixelated: false,
    credit: null,
  },
  {
    slug: 'pocket-farm',
    title: 'Pocket Farm',
    description: 'A tiny block farm. Textured cubes, crops on crossed planes, and a koi in the pond; poke anything.',
    date: '2026-11-20',
    poster: 'lab/pocket-farm/poster.png',
    credit: { name: '@annaxtime', href: 'https://x.com/annaxtime' },
    pixelated: false,
  },
  {
    slug: 'litter-check',
    title: 'Litter Check',
    description: 'A captcha for cats. The clumps hide in the noise and only show up when you stir the litter; drag them into the bin.',
    date: '2026-11-20',
    poster: 'lab/litter-check/poster.png',
    credit: { name: '@annaxtime', href: 'https://x.com/annaxtime' },
    pixelated: false,
  },
  {
    slug: 'pixel-grove',
    title: 'Pixel Grove',
    description: 'Three rigged pixel trees that sway in the breeze. Poke one and it shakes loose petals and leaves.',
    date: '2026-11-20',
    poster: 'lab/pixel-grove/poster.png',
    pixelated: true,
    credit: { name: '@SolutionB2u', href: 'https://x.com/SolutionB2u' },
  },
];
