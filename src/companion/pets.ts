import type { Activity, CompanionSpec, Keyframe, Part } from "./spec";

/**
 * Desktop pets.
 *
 * Unlike the bead, these live on the desktop: they sit on the taskbar, wander,
 * can be picked up and dropped, and say what Conduit is doing in a speech
 * bubble. They are drawn flat and soft on purpose, closer to a sticker than to
 * glass, so they read at a glance against any wallpaper.
 *
 * Props (a laptop for coding, a book for reading, a magnifier for searching)
 * are shared between pets, each placed by an offset, so a new pet gets the
 * whole repertoire by declaring where its hands are.
 */

const INK = "#2b2230";

const blink: Keyframe[] = [
  { t: 0, sy: 1, ease: "linear" },
  { t: 0.7, sy: 1, ease: "linear" },
  { t: 0.73, sy: 0.08, ease: "out" },
  { t: 0.77, sy: 1, ease: "out" },
  { t: 1, sy: 1, ease: "linear" },
];

const shut: Keyframe[] = [{ t: 0, sy: 0.1, y: 1 }];

/** Props, positioned relative to (dx, dy) — where the pet's hands meet. */
function props(dx: number, dy: number): Part[] {
  const at = (x: number, y: number): [number, number] => [x + dx, y + dy];
  return [
    {
      id: "laptop",
      origin: at(50, 80),
      showIn: ["coding"],
      shapes: [
        { kind: "rect", x: 33 + dx, y: 60 + dy, w: 34, h: 19, r: 2.5, fill: "#1d2029", stroke: "#8e97ab", width: 1.1 },
        { kind: "rect", x: 29 + dx, y: 79 + dy, w: 42, h: 4.5, r: 2, fill: "#454a58" },
      ],
    },
    {
      id: "code",
      origin: at(50, 69),
      showIn: ["coding"],
      shapes: [
        { kind: "path", d: `M${37 + dx} ${64 + dy} H${48 + dx}`, stroke: "#ff9f45", width: 1.6, cap: "round" },
        { kind: "path", d: `M${37 + dx} ${68 + dy} H${60 + dx}`, stroke: "#8fd3ff", width: 1.6, cap: "round" },
        { kind: "path", d: `M${40 + dx} ${72 + dy} H${54 + dx}`, stroke: "#b8f28e", width: 1.6, cap: "round" },
        { kind: "path", d: `M${37 + dx} ${76 + dy} H${50 + dx}`, stroke: "#8fd3ff", width: 1.6, cap: "round" },
      ],
    },
    {
      id: "book",
      origin: at(50, 76),
      showIn: ["reading"],
      shapes: [
        { kind: "path", d: `M${31 + dx} ${68 + dy} Q${40 + dx} ${64 + dy} ${50 + dx} ${68 + dy} V${84 + dy} Q${40 + dx} ${80 + dy} ${31 + dx} ${84 + dy} Z`, fill: "#fdfaf3", stroke: "#c9b9a0", width: 1 },
        { kind: "path", d: `M${69 + dx} ${68 + dy} Q${60 + dx} ${64 + dy} ${50 + dx} ${68 + dy} V${84 + dy} Q${60 + dx} ${80 + dy} ${69 + dx} ${84 + dy} Z`, fill: "#fdfaf3", stroke: "#c9b9a0", width: 1 },
        { kind: "path", d: `M${35 + dx} ${72 + dy} H${46 + dx} M${35 + dx} ${76 + dy} H${44 + dx} M${54 + dx} ${72 + dy} H${65 + dx} M${54 + dx} ${76 + dy} H${63 + dx}`, stroke: "#b7ab98", width: 1, cap: "round" },
      ],
    },
    {
      id: "pen",
      origin: at(64, 74),
      showIn: ["writing"],
      shapes: [
        { kind: "rect", x: 30 + dx, y: 72 + dy, w: 34, h: 12, r: 2, fill: "#fdfaf3", stroke: "#c9b9a0", width: 1 },
        { kind: "path", d: `M${34 + dx} ${77 + dy} H${52 + dx}`, stroke: "#7a86a0", width: 1.2, cap: "round" },
        { kind: "path", d: `M${58 + dx} ${80 + dy} L${70 + dx} ${64 + dy}`, stroke: "#ff7a1a", width: 3, cap: "round" },
      ],
    },
    {
      id: "lens",
      origin: at(72, 64),
      showIn: ["searching"],
      shapes: [
        { kind: "circle", cx: 70 + dx, cy: 62 + dy, r: 8, fill: "#e8f4ff", stroke: "#4a5570", width: 2.4, opacity: 0.95 },
        { kind: "line", x: 76 + dx, y: 68 + dy, x2: 83 + dx, y2: 75 + dy, stroke: "#4a5570", width: 3.4, cap: "round" },
      ],
    },
    {
      id: "arrow",
      origin: at(76, 60),
      showIn: ["screen"],
      shapes: [
        { kind: "polygon", points: [72 + dx, 50 + dy, 72 + dx, 70 + dy, 77 + dx, 65 + dy, 80.5 + dx, 73 + dy, 84 + dx, 71.5 + dy, 80.5 + dx, 63.5 + dy, 87 + dx, 63.5 + dy], fill: "#ffffff", stroke: INK, width: 1.4, join: "round" },
      ],
    },
    {
      id: "bolt",
      origin: at(80, 32),
      showIn: ["running"],
      shapes: [{ kind: "polygon", points: [80 + dx, 20 + dy, 88 + dx, 20 + dy, 82 + dx, 30 + dy, 88 + dx, 30 + dy, 76 + dx, 45 + dy, 79 + dx, 33 + dy, 74 + dx, 33 + dy], fill: "#ffc93d", stroke: "#e8901c", width: 1, join: "round" }],
    },
    {
      id: "dots",
      origin: at(76, 20),
      showIn: ["thinking"],
      shapes: [
        { kind: "circle", cx: 70 + dx, cy: 24 + dy, r: 2.2, fill: "#b8b3c4" },
        { kind: "circle", cx: 77 + dx, cy: 18 + dy, r: 3, fill: "#b8b3c4" },
        { kind: "circle", cx: 86 + dx, cy: 12 + dy, r: 4, fill: "#b8b3c4" },
      ],
    },
    {
      id: "waves",
      origin: at(80, 42),
      showIn: ["listening", "speaking"],
      shapes: [
        { kind: "path", d: `M${76 + dx} ${34 + dy} Q${82 + dx} ${42 + dy} ${76 + dx} ${50 + dy}`, stroke: "#ff6f61", width: 2.2, cap: "round" },
        { kind: "path", d: `M${82 + dx} ${29 + dy} Q${91 + dx} ${42 + dy} ${82 + dx} ${55 + dy}`, stroke: "#ff6f61", width: 2.2, cap: "round", opacity: 0.55 },
      ],
    },
    {
      id: "heart",
      origin: at(50, 12),
      showIn: ["done"],
      shapes: [
        { kind: "path", d: `M${50 + dx} ${20 + dy} C${40 + dx} ${13 + dy} ${43 + dx} ${4 + dy} ${50 + dx} ${9 + dy} C${57 + dx} ${4 + dy} ${60 + dx} ${13 + dy} ${50 + dx} ${20 + dy} Z`, fill: "#ff5f7e" },
      ],
    },
    {
      id: "sweat",
      origin: at(72, 30),
      showIn: ["error"],
      shapes: [
        { kind: "path", d: `M${73 + dx} ${24 + dy} C${70 + dx} ${29 + dy} ${69 + dx} ${32 + dy} ${72 + dx} ${34 + dy} C${75 + dx} ${35 + dy} ${77 + dx} ${31 + dy} ${73 + dx} ${24 + dy} Z`, fill: "#7cc7ff", stroke: "#3d8fd6", width: 0.8 },
      ],
    },
    {
      id: "zzz",
      origin: at(74, 20),
      showIn: ["sleeping"],
      shapes: [
        { kind: "path", d: `M${68 + dx} ${24 + dy} h5 l-5 5 h5`, stroke: "#8b84a0", width: 1.6, cap: "round", join: "round" },
        { kind: "path", d: `M${76 + dx} ${14 + dy} h7 l-7 7 h7`, stroke: "#8b84a0", width: 1.9, cap: "round", join: "round", opacity: 0.7 },
      ],
    },
  ];
}

/** Motion for the shared props, identical for every pet. */
const PROP_TRACKS: Partial<Record<Activity, Record<string, Keyframe[]>>> = {
  coding: {
    code: [
      { t: 0, y: 3, o: 0, ease: "linear" },
      { t: 0.15, y: 1.5, o: 1, ease: "linear" },
      { t: 0.85, y: -5, o: 1, ease: "linear" },
      { t: 1, y: -7, o: 0, ease: "linear" },
    ],
  },
  reading: { book: [{ t: 0, r: -2 }, { t: 0.5, r: 2 }, { t: 1, r: -2 }] },
  writing: { pen: [{ t: 0, x: 0, y: 0 }, { t: 0.5, x: -8, y: 2 }, { t: 1, x: 0, y: 0 }] },
  searching: {
    lens: [
      { t: 0, x: 0, y: 0 },
      { t: 0.25, x: 4, y: -3 },
      { t: 0.5, x: 1, y: 3 },
      { t: 0.75, x: -3, y: 0 },
      { t: 1, x: 0, y: 0 },
    ],
  },
  screen: {
    arrow: [
      { t: 0, x: -3, y: -3 },
      { t: 0.4, x: 3, y: 3, ease: "out" },
      { t: 0.5, s: 0.85, ease: "out" },
      { t: 0.6, s: 1, ease: "backOut" },
      { t: 1, x: -3, y: -3 },
    ],
  },
  running: { bolt: [{ t: 0, o: 1, s: 1, ease: "hold" }, { t: 0.5, o: 0.35, s: 0.9, ease: "hold" }, { t: 1, o: 1, s: 1 }] },
  thinking: {
    dots: [
      { t: 0, o: 0.2, s: 0.7 },
      { t: 0.35, o: 1, s: 1.05, ease: "backOut" },
      { t: 0.8, o: 0.45, s: 0.9 },
      { t: 1, o: 0.2, s: 0.7 },
    ],
  },
  listening: { waves: [{ t: 0, o: 0.2, x: -2 }, { t: 0.5, o: 1, x: 1 }, { t: 1, o: 0.2, x: -2 }] },
  speaking: { waves: [{ t: 0, o: 0.35, sx: 0.85 }, { t: 0.5, o: 1, sx: 1.1 }, { t: 1, o: 0.35, sx: 0.85 }] },
  done: { heart: [{ t: 0, y: 4, s: 0.4, o: 0 }, { t: 0.25, y: 0, s: 1.15, o: 1, ease: "backOut" }, { t: 0.8, y: -6, s: 1, o: 1 }, { t: 1, y: -10, s: 0.9, o: 0 }] },
  error: { sweat: [{ t: 0, y: 0, o: 1 }, { t: 0.8, y: 6, o: 1 }, { t: 1, y: 8, o: 0 }] },
  sleeping: { zzz: [{ t: 0, y: 4, o: 0, s: 0.7 }, { t: 0.4, y: 0, o: 1, s: 1 }, { t: 1, y: -8, o: 0, s: 1.15 }] },
};

function withProps(states: CompanionSpec["states"]): CompanionSpec["states"] {
  const out: CompanionSpec["states"] = {};
  for (const [activity, state] of Object.entries(states)) {
    if (!state) continue;
    out[activity as Activity] = {
      ...state,
      tracks: { ...(PROP_TRACKS[activity as Activity] ?? {}), ...state.tracks },
    };
  }
  return out;
}

// --- Mochi -----------------------------------------------------------------------------

const FUR = "#f4a95e";
const FUR_LIGHT = "#ffe6c7";
const FUR_DARK = "#d9803a";
const PINK = "#ff9eab";

/** Mochi, an orange tabby who sits on your taskbar. */
export const MOCHI: CompanionSpec = {
  id: "mochi",
  name: "Mochi",
  kind: "pet",
  author: "Conduit",
  version: "1.0.0",
  license: "MIT",
  description: "An orange tabby. Types on a tiny laptop when Conduit writes code.",
  viewBox: "0 0 100 100",
  palette: { fur: FUR, light: FUR_LIGHT, dark: FUR_DARK, pink: PINK, ink: INK },
  parts: [
    {
      id: "shadow",
      origin: [50, 95],
      shapes: [{ kind: "ellipse", cx: 50, cy: 95, rx: 22, ry: 3.2, fill: "#000000", opacity: 0.16 }],
    },
    {
      id: "tail",
      origin: [68, 82],
      shapes: [
        { kind: "path", d: "M66 83 C82 84 91 73 88 60", stroke: "token:fur", width: 7.5, cap: "round" },
        { kind: "path", d: "M89 64 C89.5 61 88.8 58.5 87.5 57", stroke: "token:dark", width: 7.5, cap: "round" },
      ],
    },
    {
      id: "body",
      origin: [50, 92],
      shapes: [
        { kind: "ellipse", cx: 50, cy: 75, rx: 22, ry: 17.5, fill: "token:fur" },
        { kind: "ellipse", cx: 50, cy: 79, rx: 12.5, ry: 11.5, fill: "token:light" },
        { kind: "path", d: "M30 70 Q33 68 35 71 M29 76 Q32 74 34 77", stroke: "token:dark", width: 1.8, cap: "round" },
      ],
    },
    {
      id: "pawL",
      origin: [42, 90],
      shapes: [{ kind: "ellipse", cx: 42, cy: 90.5, rx: 6.2, ry: 4.4, fill: "token:light", stroke: "token:dark", width: 0.8 }],
    },
    {
      id: "pawR",
      origin: [58, 90],
      shapes: [{ kind: "ellipse", cx: 58, cy: 90.5, rx: 6.2, ry: 4.4, fill: "token:light", stroke: "token:dark", width: 0.8 }],
    },
    ...props(0, 0),
    {
      id: "head",
      origin: [50, 58],
      shapes: [
        { kind: "path", d: "M29.5 38 L31.5 15.5 L47 27.5 Z", fill: "token:fur", stroke: "token:fur", width: 3, join: "round" },
        { kind: "path", d: "M33 33 L34 21 L42.5 28 Z", fill: "token:pink" },
        { kind: "path", d: "M70.5 38 L68.5 15.5 L53 27.5 Z", fill: "token:fur", stroke: "token:fur", width: 3, join: "round" },
        { kind: "path", d: "M67 33 L66 21 L57.5 28 Z", fill: "token:pink" },
        { kind: "ellipse", cx: 50, cy: 44, rx: 22.5, ry: 19.5, fill: "token:fur" },
        { kind: "path", d: "M44 26.5 L45.2 32 M50 25.5 V32 M56 26.5 L54.8 32", stroke: "token:dark", width: 2.2, cap: "round" },
        { kind: "ellipse", cx: 50, cy: 51.5, rx: 9.5, ry: 6.5, fill: "token:light" },
        { kind: "ellipse", cx: 34.5, cy: 50, rx: 3.6, ry: 2.2, fill: "token:pink", opacity: 0.55 },
        { kind: "ellipse", cx: 65.5, cy: 50, rx: 3.6, ry: 2.2, fill: "token:pink", opacity: 0.55 },
        { kind: "polygon", points: [47.8, 48.3, 52.2, 48.3, 50, 50.8], fill: "token:pink" },
        { kind: "path", d: "M36 50.5 L26.5 48.5 M36 52.5 L26.5 53.5 M64 50.5 L73.5 48.5 M64 52.5 L73.5 53.5", stroke: "token:dark", width: 0.9, cap: "round", opacity: 0.6 },
      ],
    },
    {
      id: "mouth",
      origin: [50, 53],
      shapes: [{ kind: "path", d: "M46.8 52.3 Q48.4 54.6 50 52.8 Q51.6 54.6 53.2 52.3", stroke: "token:ink", width: 1.2, cap: "round" }],
    },
    {
      id: "eyeL",
      origin: [41, 43],
      shapes: [
        { kind: "ellipse", cx: 41, cy: 43, rx: 4.3, ry: 5.2, fill: "token:ink" },
        { kind: "circle", cx: 42.5, cy: 41.2, r: 1.7, fill: "#ffffff" },
        { kind: "circle", cx: 39.9, cy: 45.2, r: 0.8, fill: "#ffffff" },
      ],
    },
    {
      id: "eyeR",
      origin: [59, 43],
      shapes: [
        { kind: "ellipse", cx: 59, cy: 43, rx: 4.3, ry: 5.2, fill: "token:ink" },
        { kind: "circle", cx: 60.5, cy: 41.2, r: 1.7, fill: "#ffffff" },
        { kind: "circle", cx: 57.9, cy: 45.2, r: 0.8, fill: "#ffffff" },
      ],
    },
  ],
  states: withProps({
    idle: {
      loop: 4.2,
      tracks: {
        body: [{ t: 0, sy: 1 }, { t: 0.5, sy: 1.025 }, { t: 1, sy: 1 }],
        head: [{ t: 0, r: 0, y: 0 }, { t: 0.5, r: 3, y: 0.6 }, { t: 1, r: 0, y: 0 }],
        eyeL: blink,
        eyeR: blink,
        mouth: [{ t: 0, r: 0, y: 0 }, { t: 0.5, r: 3, y: 0.6 }, { t: 1, r: 0, y: 0 }],
        tail: [{ t: 0, r: 0 }, { t: 0.5, r: -12 }, { t: 1, r: 0 }],
      },
    },
    walking: {
      loop: 0.62,
      tracks: {
        body: [{ t: 0, y: 0 }, { t: 0.25, y: -1.6 }, { t: 0.5, y: 0 }, { t: 0.75, y: -1.6 }, { t: 1, y: 0 }],
        head: [{ t: 0, y: 0, r: -1 }, { t: 0.25, y: -2 }, { t: 0.5, y: 0, r: 1 }, { t: 0.75, y: -2 }, { t: 1, y: 0, r: -1 }],
        eyeL: [{ t: 0, y: 0 }, { t: 0.25, y: -2 }, { t: 0.5, y: 0 }, { t: 0.75, y: -2 }, { t: 1, y: 0 }],
        eyeR: [{ t: 0, y: 0 }, { t: 0.25, y: -2 }, { t: 0.5, y: 0 }, { t: 0.75, y: -2 }, { t: 1, y: 0 }],
        mouth: [{ t: 0, y: 0 }, { t: 0.25, y: -2 }, { t: 0.5, y: 0 }, { t: 0.75, y: -2 }, { t: 1, y: 0 }],
        pawL: [{ t: 0, y: 0 }, { t: 0.25, y: -3.5 }, { t: 0.5, y: 0 }, { t: 1, y: 0 }],
        pawR: [{ t: 0, y: 0 }, { t: 0.5, y: 0 }, { t: 0.75, y: -3.5 }, { t: 1, y: 0 }],
        tail: [{ t: 0, r: -8 }, { t: 0.5, r: 8 }, { t: 1, r: -8 }],
        shadow: [{ t: 0, sx: 1 }, { t: 0.25, sx: 0.92 }, { t: 0.5, sx: 1 }, { t: 0.75, sx: 0.92 }, { t: 1, sx: 1 }],
      },
    },
    held: {
      loop: 1.6,
      tracks: {
        body: [{ t: 0, sy: 1.08, sx: 0.95, r: -3 }, { t: 0.5, sy: 1.08, sx: 0.95, r: 3 }, { t: 1, sy: 1.08, sx: 0.95, r: -3 }],
        pawL: [{ t: 0, y: 3, r: -8 }, { t: 0.5, y: 4 }, { t: 1, y: 3, r: -8 }],
        pawR: [{ t: 0, y: 4 }, { t: 0.5, y: 3, r: 8 }, { t: 1, y: 4 }],
        tail: [{ t: 0, r: 30 }, { t: 0.5, r: 38 }, { t: 1, r: 30 }],
        eyeL: [{ t: 0, s: 1.15 }],
        eyeR: [{ t: 0, s: 1.15 }],
        mouth: [{ t: 0, sy: 1.6, sx: 0.8 }],
        shadow: [{ t: 0, o: 0.25, sx: 0.6 }],
      },
    },
    sleeping: {
      loop: 4.8,
      tracks: {
        body: [{ t: 0, sy: 0.97, y: 1.5 }, { t: 0.5, sy: 1.03, y: 0.5 }, { t: 1, sy: 0.97, y: 1.5 }],
        head: [{ t: 0, y: 4, r: -6 }, { t: 0.5, y: 3.4, r: -6 }, { t: 1, y: 4, r: -6 }],
        eyeL: [{ t: 0, sy: 0.1, y: 4.5, x: -0.6 }],
        eyeR: [{ t: 0, sy: 0.1, y: 3.2, x: -0.6 }],
        mouth: [{ t: 0, y: 3.8, r: -6 }],
        tail: [{ t: 0, r: 18 }, { t: 0.5, r: 14 }, { t: 1, r: 18 }],
      },
    },
    listening: {
      loop: 1.2,
      accent: "#ff6f61",
      tracks: {
        head: [{ t: 0, r: -6 }, { t: 0.5, r: -4, y: -1 }, { t: 1, r: -6 }],
        mouth: [{ t: 0, r: -6 }, { t: 0.5, r: -4, y: -1 }, { t: 1, r: -6 }],
        eyeL: [{ t: 0, s: 1.12, r: -6 }],
        eyeR: [{ t: 0, s: 1.12, r: -6 }],
        tail: [{ t: 0, r: -4 }, { t: 0.5, r: 4 }, { t: 1, r: -4 }],
      },
    },
    thinking: {
      loop: 2.2,
      tracks: {
        head: [{ t: 0, r: 5 }, { t: 0.5, r: 8 }, { t: 1, r: 5 }],
        mouth: [{ t: 0, r: 5 }, { t: 0.5, r: 8 }, { t: 1, r: 5 }],
        eyeL: [{ t: 0, y: -1.8, x: 1 }, { t: 0.5, y: -2, x: 1.4 }, { t: 1, y: -1.8, x: 1 }],
        eyeR: [{ t: 0, y: -1.8, x: 1 }, { t: 0.5, y: -2, x: 1.4 }, { t: 1, y: -1.8, x: 1 }],
        tail: [{ t: 0, r: -10 }, { t: 0.5, r: 6 }, { t: 1, r: -10 }],
      },
    },
    coding: {
      loop: 0.5,
      tracks: {
        head: [{ t: 0, y: 1.5 }, { t: 0.5, y: 2 }, { t: 1, y: 1.5 }],
        mouth: [{ t: 0, y: 1.5 }, { t: 0.5, y: 2 }, { t: 1, y: 1.5 }],
        eyeL: [{ t: 0, y: 2.6, sy: 0.75 }],
        eyeR: [{ t: 0, y: 2.6, sy: 0.75 }],
        pawL: [{ t: 0, y: -9, x: -1 }, { t: 0.25, y: -11.5 }, { t: 0.5, y: -9 }, { t: 1, y: -9, x: -1 }],
        pawR: [{ t: 0, y: -9, x: 1 }, { t: 0.5, y: -9 }, { t: 0.75, y: -11.5 }, { t: 1, y: -9, x: 1 }],
        tail: [{ t: 0, r: -4 }, { t: 0.5, r: 4 }, { t: 1, r: -4 }],
      },
    },
    reading: {
      loop: 2.6,
      tracks: {
        head: [{ t: 0, y: 2, r: -2 }, { t: 0.5, y: 2, r: 2 }, { t: 1, y: 2, r: -2 }],
        mouth: [{ t: 0, y: 2, r: -2 }, { t: 0.5, y: 2, r: 2 }, { t: 1, y: 2, r: -2 }],
        eyeL: [{ t: 0, x: -1.5, y: 3 }, { t: 0.45, x: 1.5, y: 3 }, { t: 0.5, x: -1.5, y: 3.4, ease: "out" }, { t: 1, x: -1.5, y: 3 }],
        eyeR: [{ t: 0, x: -1.5, y: 3 }, { t: 0.45, x: 1.5, y: 3 }, { t: 0.5, x: -1.5, y: 3.4, ease: "out" }, { t: 1, x: -1.5, y: 3 }],
        pawL: [{ t: 0, y: -7 }],
        pawR: [{ t: 0, y: -7 }],
      },
    },
    writing: {
      loop: 0.9,
      tracks: {
        head: [{ t: 0, y: 2, r: 4 }],
        mouth: [{ t: 0, y: 2, r: 4 }],
        eyeL: [{ t: 0, x: 1.5, y: 3 }],
        eyeR: [{ t: 0, x: 1.5, y: 3 }],
        pawR: [{ t: 0, y: -6, x: 4 }, { t: 0.5, y: -5, x: -3 }, { t: 1, y: -6, x: 4 }],
      },
    },
    searching: {
      loop: 2.4,
      tracks: {
        head: [{ t: 0, r: -4 }, { t: 0.5, r: 4 }, { t: 1, r: -4 }],
        mouth: [{ t: 0, r: -4 }, { t: 0.5, r: 4 }, { t: 1, r: -4 }],
        eyeL: [{ t: 0, x: 2 }, { t: 0.5, x: 0 }, { t: 1, x: 2 }],
        eyeR: [{ t: 0, x: 2 }, { t: 0.5, x: 0 }, { t: 1, x: 2 }],
        pawR: [{ t: 0, y: -10, x: 6 }],
      },
    },
    running: {
      loop: 0.36,
      tracks: {
        body: [{ t: 0, x: -0.8 }, { t: 0.5, x: 0.8 }, { t: 1, x: -0.8 }],
        tail: [{ t: 0, r: -18 }, { t: 0.5, r: 18 }, { t: 1, r: -18 }],
        pawL: [{ t: 0, y: 0 }, { t: 0.25, y: -3 }, { t: 0.5, y: 0 }],
        pawR: [{ t: 0.5, y: 0 }, { t: 0.75, y: -3 }, { t: 1, y: 0 }],
        eyeL: [{ t: 0, s: 1.1 }],
        eyeR: [{ t: 0, s: 1.1 }],
      },
    },
    screen: {
      loop: 1.8,
      tracks: {
        head: [{ t: 0, r: 3, x: 1 }, { t: 0.5, r: -3 }, { t: 1, r: 3, x: 1 }],
        mouth: [{ t: 0, r: 3, x: 1 }, { t: 0.5, r: -3 }, { t: 1, r: 3, x: 1 }],
        eyeL: [{ t: 0, x: 2.2, y: 0.6 }],
        eyeR: [{ t: 0, x: 2.2, y: 0.6 }],
        pawR: [{ t: 0, y: -12, x: 7 }, { t: 0.4, y: -13, x: 9 }, { t: 1, y: -12, x: 7 }],
      },
    },
    speaking: {
      loop: 0.6,
      tracks: {
        mouth: [{ t: 0, sy: 1 }, { t: 0.5, sy: 2, sx: 0.85 }, { t: 1, sy: 1 }],
        head: [{ t: 0, y: 0 }, { t: 0.5, y: -0.8 }, { t: 1, y: 0 }],
        eyeL: blink,
        eyeR: blink,
      },
    },
    done: {
      loop: 1.8,
      accent: "#3fbf8a",
      tracks: {
        body: [
          { t: 0, y: 0, sy: 1 },
          { t: 0.1, y: 1.5, sy: 0.9, ease: "out" },
          { t: 0.3, y: -10, sy: 1.06, ease: "out" },
          { t: 0.5, y: 0, sy: 0.93, ease: "in" },
          { t: 0.62, sy: 1, ease: "backOut" },
          { t: 1, y: 0 },
        ],
        head: [{ t: 0, y: 0 }, { t: 0.1, y: 1.5 }, { t: 0.3, y: -11, ease: "out" }, { t: 0.5, y: 0, ease: "in" }, { t: 1, y: 0 }],
        mouth: [{ t: 0, y: 0 }, { t: 0.1, y: 1.5 }, { t: 0.3, y: -11, ease: "out" }, { t: 0.5, y: 0, ease: "in" }, { t: 1, y: 0 }],
        eyeL: [{ t: 0, y: 0, sy: 0.4 }, { t: 0.3, y: -11, sy: 0.4, ease: "out" }, { t: 0.5, y: 0, sy: 0.4, ease: "in" }, { t: 1, y: 0, sy: 0.4 }],
        eyeR: [{ t: 0, y: 0, sy: 0.4 }, { t: 0.3, y: -11, sy: 0.4, ease: "out" }, { t: 0.5, y: 0, sy: 0.4, ease: "in" }, { t: 1, y: 0, sy: 0.4 }],
        pawL: [{ t: 0, y: 0 }, { t: 0.3, y: -10, ease: "out" }, { t: 0.5, y: 0, ease: "in" }, { t: 1, y: 0 }],
        pawR: [{ t: 0, y: 0 }, { t: 0.3, y: -10, ease: "out" }, { t: 0.5, y: 0, ease: "in" }, { t: 1, y: 0 }],
        tail: [{ t: 0, r: 0 }, { t: 0.3, r: -20, ease: "out" }, { t: 0.6, r: 10 }, { t: 1, r: 0 }],
        shadow: [{ t: 0, sx: 1 }, { t: 0.3, sx: 0.7, o: 0.6 }, { t: 0.5, sx: 1 }, { t: 1, sx: 1 }],
      },
    },
    error: {
      loop: 0.46,
      accent: "#ff5f52",
      tracks: {
        body: [{ t: 0, x: -1.5 }, { t: 0.5, x: 1.5 }, { t: 1, x: -1.5 }],
        head: [{ t: 0, x: -2, r: -3 }, { t: 0.5, x: 2, r: 3 }, { t: 1, x: -2, r: -3 }],
        mouth: [{ t: 0, x: -2, r: -3, sy: -1 }, { t: 0.5, x: 2, r: 3, sy: -1 }, { t: 1, x: -2, r: -3, sy: -1 }],
        eyeL: [{ t: 0, x: -2, sy: 0.55 }, { t: 0.5, x: 2, sy: 0.55 }, { t: 1, x: -2, sy: 0.55 }],
        eyeR: [{ t: 0, x: -2, sy: 0.55 }, { t: 0.5, x: 2, sy: 0.55 }, { t: 1, x: -2, sy: 0.55 }],
      },
    },
    working: {
      loop: 1.2,
      tracks: {
        head: [{ t: 0, y: 0 }, { t: 0.5, y: 1 }, { t: 1, y: 0 }],
        mouth: [{ t: 0, y: 0 }, { t: 0.5, y: 1 }, { t: 1, y: 0 }],
        tail: [{ t: 0, r: -14 }, { t: 0.5, r: 10 }, { t: 1, r: -14 }],
        eyeL: blink,
        eyeR: blink,
      },
    },
  }),
};

// --- Jelly -----------------------------------------------------------------------------

/** Jelly, a mint slime that hops instead of walking. */
export const JELLY: CompanionSpec = {
  id: "jelly",
  name: "Jelly",
  kind: "pet",
  author: "Conduit",
  version: "1.0.0",
  license: "MIT",
  description: "A mint slime. Hops about, wobbles when it is thinking.",
  viewBox: "0 0 100 100",
  palette: { body: "#7de3c0", deep: "#3fb893", shine: "#ffffff", ink: INK, blush: "#ff9eab" },
  parts: [
    {
      id: "shadow",
      origin: [50, 95],
      shapes: [{ kind: "ellipse", cx: 50, cy: 95, rx: 25, ry: 3.4, fill: "#000000", opacity: 0.15 }],
    },
    {
      id: "body",
      origin: [50, 93],
      shapes: [
        { kind: "path", d: "M20 90 C18 64 31 42 50 42 C69 42 82 64 80 90 C80 93 77 94 74 94 H26 C23 94 20 93 20 90 Z", fill: "token:body", stroke: "token:deep", width: 1.6 },
        { kind: "path", d: "M26 88 C26 80 29 74 33 70", stroke: "token:deep", width: 2, cap: "round", opacity: 0.35 },
        { kind: "ellipse", cx: 38, cy: 55, rx: 7.5, ry: 4.5, fill: "token:shine", opacity: 0.7 },
        { kind: "circle", cx: 46.5, cy: 51, r: 1.8, fill: "token:shine", opacity: 0.85 },
      ],
    },
    ...props(0, 6),
    {
      id: "face",
      origin: [50, 72],
      shapes: [
        { kind: "ellipse", cx: 37, cy: 76, rx: 3.8, ry: 2.3, fill: "token:blush", opacity: 0.6 },
        { kind: "ellipse", cx: 63, cy: 76, rx: 3.8, ry: 2.3, fill: "token:blush", opacity: 0.6 },
      ],
    },
    {
      id: "mouth",
      origin: [50, 78],
      shapes: [{ kind: "path", d: "M46 77 Q50 81 54 77", stroke: "token:ink", width: 1.6, cap: "round" }],
    },
    {
      id: "eyeL",
      origin: [42, 69],
      shapes: [
        { kind: "ellipse", cx: 42, cy: 69, rx: 3.8, ry: 4.8, fill: "token:ink" },
        { kind: "circle", cx: 43.3, cy: 67.4, r: 1.5, fill: "#ffffff" },
      ],
    },
    {
      id: "eyeR",
      origin: [58, 69],
      shapes: [
        { kind: "ellipse", cx: 58, cy: 69, rx: 3.8, ry: 4.8, fill: "token:ink" },
        { kind: "circle", cx: 59.3, cy: 67.4, r: 1.5, fill: "#ffffff" },
      ],
    },
  ],
  states: withProps(
    Object.fromEntries(
      (
        [
          ["idle", 3.6, 1.03, 0],
          ["walking", 0.7, 1.12, -8],
          ["held", 1.4, 1.2, 0],
          ["sleeping", 5, 1.02, 0],
          ["listening", 1.1, 1.06, 0],
          ["thinking", 1.6, 1.05, 0],
          ["coding", 0.5, 1.03, 0],
          ["reading", 2.6, 1.02, 0],
          ["writing", 0.9, 1.03, 0],
          ["searching", 2.2, 1.04, 0],
          ["running", 0.34, 1.05, -2],
          ["screen", 1.8, 1.03, 0],
          ["speaking", 0.6, 1.05, 0],
          ["done", 1.6, 1.15, -14],
          ["error", 0.44, 1.02, 0],
          ["working", 1, 1.05, -2],
        ] as Array<[Activity, number, number, number]>
      ).map(([activity, loop, stretch, hop]) => {
        const faceShift = activity === "sleeping" ? 2 : activity === "coding" || activity === "reading" ? 3 : 0;
        const eyes: Keyframe[] =
          activity === "sleeping"
            ? shut
            : activity === "held"
              ? [{ t: 0, s: 1.2 }]
              : activity === "error"
                ? [{ t: 0, sy: 0.5, x: -1.5 }, { t: 0.5, sy: 0.5, x: 1.5 }, { t: 1, sy: 0.5, x: -1.5 }]
                : activity === "coding" || activity === "reading"
                  ? [{ t: 0, y: faceShift, sy: 0.8 }]
                  : blink;
        const bounce: Keyframe[] = hop
          ? [
              { t: 0, y: 0, sy: 1, sx: 1 },
              { t: 0.15, y: 1, sy: 0.86, sx: 1.1, ease: "out" },
              { t: 0.45, y: hop, sy: stretch, sx: 0.94, ease: "out" },
              { t: 0.75, y: 0, sy: 0.9, sx: 1.08, ease: "in" },
              { t: 1, y: 0, sy: 1, sx: 1, ease: "backOut" },
            ]
          : activity === "thinking"
            ? [{ t: 0, sx: 1.04, sy: 0.97 }, { t: 0.5, sx: 0.96, sy: 1.04 }, { t: 1, sx: 1.04, sy: 0.97 }]
            : activity === "error"
              ? [{ t: 0, x: -1.5 }, { t: 0.5, x: 1.5 }, { t: 1, x: -1.5 }]
              : [{ t: 0, sy: 1, sx: 1 }, { t: 0.5, sy: stretch, sx: 2 - stretch }, { t: 1, sy: 1, sx: 1 }];
        const follow = (keys: Keyframe[]): Keyframe[] =>
          keys.map((k) => ({ t: k.t, y: (k.y ?? 0) * 1.05 + faceShift, x: k.x, ease: k.ease }));
        return [
          activity,
          {
            loop,
            accent: activity === "listening" ? "#ff6f61" : activity === "done" ? "#3fbf8a" : undefined,
            tracks: {
              body: bounce,
              face: follow(bounce),
              mouth:
                activity === "speaking"
                  ? [{ t: 0, sy: 1, y: 0 }, { t: 0.5, sy: 1.8, y: 0.5 }, { t: 1, sy: 1, y: 0 }]
                  : activity === "error"
                    ? [{ t: 0, sy: -1, y: 1 }]
                    : follow(bounce),
              eyeL: hop ? follow(bounce) : eyes,
              eyeR: hop ? follow(bounce) : eyes,
              shadow: hop
                ? [{ t: 0, sx: 1 }, { t: 0.45, sx: 0.7, o: 0.6 }, { t: 0.75, sx: 1.05 }, { t: 1, sx: 1 }]
                : [{ t: 0, sx: 1 }],
            },
          },
        ];
      }),
    ) as CompanionSpec["states"],
  ),
};

export const DESKTOP_PETS: CompanionSpec[] = [MOCHI, JELLY];
