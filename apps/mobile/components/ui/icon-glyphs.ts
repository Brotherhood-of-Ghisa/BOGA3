// The icon set's geometry, drawn on a 24×24 grid with a 2-unit stroke.
//
// Every glyph not marked BoGa below is vendored path data from Lucide
// (lucide-static 1.47.0, https://lucide.dev), ISC; a few Lucide icons derive
// from Feather, MIT. Both notices are in `./LICENSE.lucide`, which must travel
// with this file. Vendored rather than depended on: the set is small, Metro
// does not tree-shake a barrel import of ~1,600 icons, and the state glyphs are
// bespoke anyway. Take a new icon from the same Lucide release so the stroke
// language stays one family; name it by its role here, not by its Lucide name.

// How a shape is painted. `stroke` is the Lucide default. `solid` fills and
// strokes in the icon colour. `knockout` strokes in the icon's knockout colour,
// for a mark drawn over a `solid` shape (the check inside `set-done`).
export type IconPaint = 'stroke' | 'solid' | 'knockout';

export type IconShape =
  | { kind: 'path'; d: string; paint?: IconPaint }
  | { kind: 'circle'; cx: number; cy: number; r: number; paint?: IconPaint }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; paint?: IconPaint };

const path = (d: string, paint?: IconPaint): IconShape => ({ kind: 'path', d, paint });
const circle = (cx: number, cy: number, r: number, paint?: IconPaint): IconShape => ({
  kind: 'circle',
  cx,
  cy,
  r,
  paint,
});

// Lucide `circle-dashed`, shared by `set-planned`.
const DASHED_RING = [
  path('M10.1 2.182a10 10 0 0 1 3.8 0'),
  path('M13.9 21.818a10 10 0 0 1-3.8 0'),
  path('M17.609 3.721a10 10 0 0 1 2.69 2.7'),
  path('M2.182 13.9a10 10 0 0 1 0-3.8'),
  path('M20.279 17.609a10 10 0 0 1-2.7 2.69'),
  path('M21.818 10.1a10 10 0 0 1 0 3.8'),
  path('M3.721 6.391a10 10 0 0 1 2.7-2.69'),
  path('M6.391 20.279a10 10 0 0 1-2.69-2.7'),
];

export const ICON_GLYPHS = {
  // --- Direction and disclosure ---
  'chevron-right': [path('m9 18 6-6-6-6')],
  'chevron-down': [path('m6 9 6 6 6-6')],
  'arrow-up': [path('m5 12 7-7 7 7'), path('M12 19V5')],
  'arrow-down': [path('M12 5v14'), path('m19 12-7 7-7-7')],
  // Leaves the app (an external link).
  'arrow-up-right': [path('M7 7h10v10'), path('M7 17 17 7')],
  // BoGa: a solid pointer, for marking a selected column from above.
  'caret-down': [path('M6 8h12l-6 8z', 'solid')],

  // --- Actions ---
  x: [path('M18 6 6 18'), path('m6 6 12 12')],
  plus: [path('M5 12h14'), path('M12 5v14')],
  check: [path('M20 6 9 17l-5-5')],
  // Lucide `ellipsis-vertical`: the overflow (kebab) menu.
  'more-vertical': [circle(12, 12, 1), circle(12, 5, 1), circle(12, 19, 1)],

  // --- Choice and status ---
  // Lucide `circle`: an unfilled ring — "not yet" (not certified, unselected).
  circle: [circle(12, 12, 10)],
  // BoGa: radio pair, a ring with and without a solid centre.
  'radio-off': [circle(12, 12, 10)],
  'radio-on': [circle(12, 12, 10), circle(12, 12, 5, 'solid')],
  star: [
    path(
      'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
      'solid',
    ),
  ],

  // --- Set state (design-language §5). BoGa compositions over Lucide rings ---
  // Done: a filled disc with the check knocked out of it.
  'set-done': [circle(12, 12, 10, 'solid'), path('m8 12 3 3 5-6', 'knockout')],
  // Current: a plain ring, coloured `accent` by default.
  'set-current': [circle(12, 12, 10)],
  // Planned: Lucide `circle-dashed`, coloured `planned` by default.
  'set-planned': DASHED_RING,

  // --- Destinations ---
  user: [path('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), circle(12, 7, 4)],
  users: [
    path('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),
    path('M16 3.128a4 4 0 0 1 0 7.744'),
    path('M22 21v-2a4 4 0 0 0-3-3.87'),
    circle(9, 7, 4),
  ],
  sparkles: [
    path(
      'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    ),
    path('M20 2v4'),
    path('M22 4h-4'),
    circle(4, 20, 2),
  ],
  'shield-check': [
    path(
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ),
    path('m9 12 2 2 4-4'),
  ],
  // Lucide `code-xml`.
  code: [path('m18 16 4-4-4-4'), path('m6 8-4 4 4 4'), path('m14.5 4-5 16')],
  database: [
    { kind: 'ellipse', cx: 12, cy: 5, rx: 9, ry: 3 },
    path('M3 5V19A9 3 0 0 0 21 19V5'),
    path('M3 12A9 3 0 0 0 21 12'),
  ],
  settings: [
    path(
      'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    ),
    circle(12, 12, 3),
  ],
} satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICON_GLYPHS;
