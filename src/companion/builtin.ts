import { DROP } from "./drop";
import { JELLY, MOCHI } from "./pets";
import type { CompanionSpec } from "./spec";

/**
 * The companions Conduit ships with.
 *
 * They are written in exactly the format a stranger would use — same fields,
 * same restrictions, no privileged shortcuts. If the built-in pets needed
 * something the format cannot express, the format would be wrong, and every
 * community pet would be a second-class one.
 *
 * All three are drawn in the same glass language: a dark body that the bead's
 * own rim lights from the edge, light where light would collect, and
 * `currentColor` wherever the shape should take on what Conduit is doing.
 */

/** Eyes shut for two frames, once a cycle. Reused by every creature. */
const blink = [
  { t: 0, sy: 1, ease: "linear" as const },
  { t: 0.62, sy: 1, ease: "linear" as const },
  { t: 0.655, sy: 0.08, ease: "out" as const },
  { t: 0.7, sy: 1, ease: "out" as const },
  { t: 1, sy: 1, ease: "linear" as const },
];

const shut = [{ t: 0, sy: 0.08 }];

/**
 * Pebble — a glass blob with opinions.
 *
 * The props are the point: it picks up a tablet to write code, a book to read,
 * a lens to search. Knowing what Conduit is doing from across the room, without
 * reading anything, is the whole reason a pet beats a spinner.
 */
export const PEBBLE: CompanionSpec = {
  id: "pebble",
  name: "Pebble",
  kind: "pet",
  author: "Conduit",
  version: "1.0.0",
  license: "MIT",
  description: "A glass blob that picks up whatever Conduit is using.",
  viewBox: "0 0 100 100",
  palette: { ink: "#fffefc", deep: "#0e0e14", body: "#343545" },
  parts: [
    {
      id: "body",
      origin: [50, 72],
      shapes: [
        {
          kind: "path",
          d: "M50 30 C68 30 80 41 80 57 C80 73 67 83 50 83 C33 83 20 73 20 57 C20 41 32 30 50 30 Z",
          fill: "token:body",
          stroke: "#ffffff",
          width: 1.5,
          opacity: 0.92,
        },
        { kind: "ellipse", cx: 40, cy: 43, rx: 13, ry: 7, fill: "#ffffff", opacity: 0.14 },
      ],
    },
    {
      id: "antenna",
      origin: [50, 31],
      shapes: [
        { kind: "line", x: 50, y: 31, x2: 50, y2: 17, stroke: "currentColor", width: 2.4, cap: "round" },
        { kind: "circle", cx: 50, cy: 13, r: 3.6, fill: "currentColor" },
      ],
    },
    {
      id: "eyeL",
      origin: [40, 56],
      shapes: [
        { kind: "ellipse", cx: 40, cy: 56, rx: 6.2, ry: 7, fill: "token:ink" },
        { kind: "circle", cx: 41, cy: 57, r: 2.7, fill: "token:deep" },
        { kind: "circle", cx: 38.4, cy: 53.6, r: 1.4, fill: "#ffffff" },
      ],
    },
    {
      id: "eyeR",
      origin: [60, 56],
      shapes: [
        { kind: "ellipse", cx: 60, cy: 56, rx: 6.2, ry: 7, fill: "token:ink" },
        { kind: "circle", cx: 61, cy: 57, r: 2.7, fill: "token:deep" },
        { kind: "circle", cx: 58.4, cy: 53.6, r: 1.4, fill: "#ffffff" },
      ],
    },
    {
      id: "mouth",
      origin: [50, 70],
      showIn: ["idle", "listening", "thinking", "working", "coding", "reading", "writing", "searching", "running", "screen", "speaking", "done"],
      shapes: [
        { kind: "path", d: "M44 69 Q50 74 56 69", stroke: "token:ink", fill: "none", width: 2.3, cap: "round" },
      ],
    },
    {
      id: "frown",
      origin: [50, 72],
      showIn: ["error"],
      shapes: [
        { kind: "path", d: "M44 73 Q50 68 56 73", stroke: "currentColor", fill: "none", width: 2.3, cap: "round" },
      ],
    },
    {
      id: "spark",
      origin: [74, 26],
      showIn: ["thinking"],
      shapes: [
        { kind: "circle", cx: 66, cy: 30, r: 2.1, fill: "currentColor" },
        { kind: "circle", cx: 74, cy: 24, r: 2.8, fill: "currentColor" },
        { kind: "circle", cx: 83, cy: 29, r: 2.1, fill: "currentColor" },
      ],
    },
    {
      id: "tablet",
      origin: [74, 68],
      showIn: ["coding"],
      shapes: [
        { kind: "rect", x: 60, y: 57, w: 28, h: 22, r: 3.5, fill: "token:deep", stroke: "#ffffff", width: 1.2, opacity: 0.95 },
      ],
    },
    {
      id: "code",
      origin: [74, 68],
      showIn: ["coding"],
      shapes: [
        { kind: "path", d: "M64 62 H76", stroke: "currentColor", width: 1.8, cap: "round", fill: "none" },
        { kind: "path", d: "M64 67 H84", stroke: "token:ink", width: 1.8, cap: "round", fill: "none", opacity: 0.7 },
        { kind: "path", d: "M64 72 H72", stroke: "token:ink", width: 1.8, cap: "round", fill: "none", opacity: 0.45 },
        { kind: "path", d: "M64 77 H80", stroke: "currentColor", width: 1.8, cap: "round", fill: "none", opacity: 0.6 },
      ],
    },
    {
      id: "book",
      origin: [74, 69],
      showIn: ["reading"],
      shapes: [
        { kind: "rect", x: 60, y: 60, w: 13, h: 18, r: 2, fill: "token:deep", stroke: "#ffffff", width: 1.1 },
        { kind: "rect", x: 75, y: 60, w: 13, h: 18, r: 2, fill: "token:deep", stroke: "#ffffff", width: 1.1 },
        { kind: "path", d: "M64 66 H69 M64 70 H69 M79 66 H84 M79 70 H84", stroke: "token:ink", width: 1.3, cap: "round", fill: "none", opacity: 0.5 },
      ],
    },
    {
      id: "pen",
      origin: [76, 68],
      showIn: ["writing"],
      shapes: [
        { kind: "path", d: "M64 80 L82 58 L87 62 L69 84 Z", fill: "token:ink", opacity: 0.9 },
        { kind: "polygon", points: [64, 80, 69, 84, 62, 86], fill: "currentColor" },
      ],
    },
    {
      id: "lens",
      origin: [74, 64],
      showIn: ["searching"],
      shapes: [
        { kind: "circle", cx: 73, cy: 62, r: 9.5, stroke: "currentColor", width: 2.6, fill: "#ffffff", opacity: 0.9 },
        { kind: "line", x: 80, y: 69, x2: 88, y2: 78, stroke: "currentColor", width: 3.2, cap: "round" },
      ],
    },
    {
      id: "bolt",
      origin: [76, 66],
      showIn: ["running"],
      shapes: [
        { kind: "polygon", points: [78, 50, 88, 50, 80, 63, 88, 63, 72, 84, 77, 67, 69, 67], fill: "currentColor" },
      ],
    },
    {
      id: "arrow",
      origin: [78, 70],
      showIn: ["screen"],
      shapes: [
        { kind: "polygon", points: [70, 56, 70, 82, 76, 76, 80, 86, 84, 84, 80, 74, 88, 74], fill: "token:ink" },
      ],
    },
    {
      id: "wave",
      origin: [78, 56],
      showIn: ["speaking", "listening"],
      shapes: [
        { kind: "path", d: "M74 48 Q80 56 74 64", stroke: "currentColor", fill: "none", width: 2.2, cap: "round" },
        { kind: "path", d: "M81 43 Q90 56 81 69", stroke: "currentColor", fill: "none", width: 2.2, cap: "round", opacity: 0.55 },
      ],
    },
    {
      id: "doze",
      origin: [72, 30],
      showIn: ["sleeping"],
      shapes: [
        { kind: "circle", cx: 68, cy: 34, r: 2, fill: "token:ink", opacity: 0.5 },
        { kind: "circle", cx: 75, cy: 26, r: 2.8, fill: "token:ink", opacity: 0.35 },
        { kind: "circle", cx: 83, cy: 17, r: 3.6, fill: "token:ink", opacity: 0.2 },
      ],
    },
  ],
  states: {
    idle: {
      loop: 4.4,
      tracks: {
        body: [{ t: 0, sy: 1, sx: 1 }, { t: 0.5, sy: 1.035, sx: 0.985 }, { t: 1, sy: 1, sx: 1 }],
        antenna: [{ t: 0, r: -5 }, { t: 0.5, r: 5 }, { t: 1, r: -5 }],
        eyeL: blink,
        eyeR: blink,
      },
    },
    listening: {
      loop: 1.2,
      accent: "#ff5f52",
      tracks: {
        body: [{ t: 0, sy: 1 }, { t: 0.5, sy: 1.05, sx: 0.98 }, { t: 1, sy: 1 }],
        antenna: [{ t: 0, r: 0, sy: 1 }, { t: 0.5, r: 0, sy: 1.18 }, { t: 1, r: 0, sy: 1 }],
        eyeL: [{ t: 0, s: 1 }, { t: 0.5, s: 1.12 }, { t: 1, s: 1 }],
        eyeR: [{ t: 0, s: 1 }, { t: 0.5, s: 1.12 }, { t: 1, s: 1 }],
        wave: [{ t: 0, o: 0.2, x: -3 }, { t: 0.5, o: 1, x: 1 }, { t: 1, o: 0.2, x: -3 }],
      },
    },
    thinking: {
      loop: 2.2,
      tracks: {
        body: [{ t: 0, r: -2 }, { t: 0.5, r: 2 }, { t: 1, r: -2 }],
        antenna: [{ t: 0, r: -9 }, { t: 0.5, r: 9 }, { t: 1, r: -9 }],
        eyeL: [{ t: 0, y: -1.4, x: -0.8 }, { t: 0.5, y: -1.8, x: 0.8 }, { t: 1, y: -1.4, x: -0.8 }],
        eyeR: [{ t: 0, y: -1.4, x: -0.8 }, { t: 0.5, y: -1.8, x: 0.8 }, { t: 1, y: -1.4, x: -0.8 }],
        spark: [
          { t: 0, o: 0.2, s: 0.7 },
          { t: 0.35, o: 1, s: 1.06, ease: "backOut" },
          { t: 0.8, o: 0.4, s: 0.9 },
          { t: 1, o: 0.2, s: 0.7 },
        ],
      },
    },
    working: {
      loop: 1.5,
      tracks: {
        body: [{ t: 0, y: 0, sy: 1 }, { t: 0.5, y: -2.4, sy: 1.02 }, { t: 1, y: 0, sy: 1 }],
        antenna: [{ t: 0, r: -12 }, { t: 0.5, r: 12 }, { t: 1, r: -12 }],
        eyeL: blink,
        eyeR: blink,
      },
    },
    coding: {
      loop: 0.9,
      tracks: {
        body: [{ t: 0, r: 3, y: 0 }, { t: 0.5, r: 3, y: -1.1 }, { t: 1, r: 3, y: 0 }],
        antenna: [{ t: 0, r: 6 }, { t: 0.5, r: 12 }, { t: 1, r: 6 }],
        eyeL: [{ t: 0, y: 1.2, x: 1.4 }],
        eyeR: [{ t: 0, y: 1.2, x: 1.4 }],
        tablet: [{ t: 0, r: -4, y: 0 }, { t: 0.5, r: -4, y: -0.8 }, { t: 1, r: -4, y: 0 }],
        // The lines scroll past under the frame: a pet that is "coding" while
        // nothing on its screen moves is a pet holding a photograph.
        code: [
          { t: 0, y: 4, o: 0, ease: "linear" },
          { t: 0.12, y: 2, o: 1, ease: "linear" },
          { t: 0.86, y: -9, o: 1, ease: "linear" },
          { t: 1, y: -12, o: 0, ease: "linear" },
        ],
      },
    },
    reading: {
      loop: 2.6,
      tracks: {
        body: [{ t: 0, r: 2 }, { t: 0.5, r: 4 }, { t: 1, r: 2 }],
        eyeL: [{ t: 0, x: 1.2, y: 1.4 }, { t: 0.45, x: 2.6, y: 1.4 }, { t: 0.5, x: 0.6, y: 1.8, ease: "out" }, { t: 1, x: 1.2, y: 1.4 }],
        eyeR: [{ t: 0, x: 1.2, y: 1.4 }, { t: 0.45, x: 2.6, y: 1.4 }, { t: 0.5, x: 0.6, y: 1.8, ease: "out" }, { t: 1, x: 1.2, y: 1.4 }],
        book: [{ t: 0, r: -3, y: 0 }, { t: 0.5, r: -3, y: -1 }, { t: 1, r: -3, y: 0 }],
        antenna: [{ t: 0, r: 4 }, { t: 0.5, r: -2 }, { t: 1, r: 4 }],
      },
    },
    writing: {
      loop: 1.1,
      tracks: {
        body: [{ t: 0, r: 3 }, { t: 0.5, r: 5 }, { t: 1, r: 3 }],
        eyeL: [{ t: 0, x: 1.6, y: 1.6 }],
        eyeR: [{ t: 0, x: 1.6, y: 1.6 }],
        pen: [
          { t: 0, x: 0, y: 0, r: 0 },
          { t: 0.5, x: -5, y: 2.5, r: -7 },
          { t: 1, x: 0, y: 0, r: 0 },
        ],
      },
    },
    searching: {
      loop: 2.4,
      tracks: {
        body: [{ t: 0, r: -2 }, { t: 0.5, r: 2 }, { t: 1, r: -2 }],
        eyeL: [{ t: 0, x: 1.8 }, { t: 0.5, x: 0.4 }, { t: 1, x: 1.8 }],
        eyeR: [{ t: 0, x: 1.8 }, { t: 0.5, x: 0.4 }, { t: 1, x: 1.8 }],
        lens: [
          { t: 0, x: 0, y: 0, r: -8 },
          { t: 0.25, x: 5, y: -3, r: 0 },
          { t: 0.5, x: 2, y: 5, r: 8 },
          { t: 0.75, x: -4, y: 2, r: 0 },
          { t: 1, x: 0, y: 0, r: -8 },
        ],
      },
    },
    running: {
      loop: 0.42,
      tracks: {
        body: [{ t: 0, x: -0.9 }, { t: 0.5, x: 0.9 }, { t: 1, x: -0.9 }],
        antenna: [{ t: 0, r: -16 }, { t: 0.5, r: 16 }, { t: 1, r: -16 }],
        bolt: [
          { t: 0, o: 1, s: 1, ease: "hold" },
          { t: 0.45, o: 1, s: 1.12, ease: "hold" },
          { t: 0.5, o: 0.25, s: 0.9, ease: "hold" },
          { t: 1, o: 1, s: 1, ease: "hold" },
        ],
      },
    },
    screen: {
      loop: 2,
      accent: "#ff9f45",
      tracks: {
        body: [{ t: 0, r: 2 }, { t: 0.5, r: -2 }, { t: 1, r: 2 }],
        eyeL: [{ t: 0, x: 2, y: -0.6 }, { t: 0.5, x: 1, y: 1 }, { t: 1, x: 2, y: -0.6 }],
        eyeR: [{ t: 0, x: 2, y: -0.6 }, { t: 0.5, x: 1, y: 1 }, { t: 1, x: 2, y: -0.6 }],
        arrow: [
          { t: 0, x: -4, y: -4 },
          { t: 0.35, x: 4, y: 3, ease: "out" },
          { t: 0.45, s: 0.86, ease: "out" },
          { t: 0.55, s: 1, ease: "backOut" },
          { t: 1, x: -4, y: -4 },
        ],
      },
    },
    speaking: {
      loop: 0.66,
      tracks: {
        body: [{ t: 0, sy: 1 }, { t: 0.5, sy: 1.02 }, { t: 1, sy: 1 }],
        mouth: [{ t: 0, sy: 0.7, sx: 0.9 }, { t: 0.5, sy: 1.5, sx: 1.08 }, { t: 1, sy: 0.7, sx: 0.9 }],
        wave: [{ t: 0, o: 0.35, sx: 0.85 }, { t: 0.5, o: 1, sx: 1.1 }, { t: 1, o: 0.35, sx: 0.85 }],
      },
    },
    done: {
      loop: 1.8,
      accent: "#58c9a0",
      tracks: {
        body: [
          { t: 0, y: 0, sy: 1 },
          { t: 0.1, y: 2, sy: 0.9, ease: "out" },
          { t: 0.3, y: -9, sy: 1.07, ease: "out" },
          { t: 0.5, y: 0, sy: 0.94, ease: "in" },
          { t: 0.62, y: 0, sy: 1, ease: "backOut" },
          { t: 1, y: 0, sy: 1 },
        ],
        antenna: [{ t: 0, r: 0 }, { t: 0.3, r: -14, ease: "out" }, { t: 0.6, r: 8 }, { t: 1, r: 0 }],
        eyeL: blink,
        eyeR: blink,
      },
    },
    error: {
      loop: 0.44,
      accent: "#ff5f52",
      tracks: {
        body: [{ t: 0, x: -2, r: -2 }, { t: 0.5, x: 2, r: 2 }, { t: 1, x: -2, r: -2 }],
        eyeL: [{ t: 0, sy: 0.55, y: 1 }],
        eyeR: [{ t: 0, sy: 0.55, y: 1 }],
        antenna: [{ t: 0, r: -20 }, { t: 0.5, r: 20 }, { t: 1, r: -20 }],
      },
    },
    sleeping: {
      loop: 5.2,
      tracks: {
        body: [{ t: 0, sy: 0.98, y: 2 }, { t: 0.5, sy: 1.04, y: 0 }, { t: 1, sy: 0.98, y: 2 }],
        eyeL: shut,
        eyeR: shut,
        antenna: [{ t: 0, r: 22 }, { t: 0.5, r: 18 }, { t: 1, r: 22 }],
        doze: [
          { t: 0, o: 0, y: 6, s: 0.6, ease: "linear" },
          { t: 0.4, o: 0.9, y: 0, s: 1 },
          { t: 1, o: 0, y: -10, s: 1.2, ease: "linear" },
        ],
      },
    },
  },
};

/**
 * Finch — the same material, a different temperament.
 *
 * Where Pebble picks things up, Finch is all wings and attention: it beats
 * faster the harder Conduit is working, and tucks its head to sleep.
 */
export const FINCH: CompanionSpec = {
  id: "finch",
  name: "Finch",
  kind: "pet",
  author: "Conduit",
  version: "1.0.0",
  license: "MIT",
  description: "A glass bird. Wings beat with the workload.",
  viewBox: "0 0 100 100",
  palette: { ink: "#fffefc", deep: "#0e0e14", body: "#343545" },
  parts: [
    {
      id: "tail",
      origin: [28, 62],
      shapes: [
        { kind: "path", d: "M30 60 L10 52 L13 63 L8 70 L30 68 Z", fill: "token:body", stroke: "#ffffff", width: 1, opacity: 0.9 },
      ],
    },
    {
      id: "wingBack",
      origin: [46, 58],
      shapes: [
        { kind: "path", d: "M46 56 C56 48 68 50 70 58 C62 66 50 66 46 56 Z", fill: "token:deep", opacity: 0.75 },
      ],
    },
    {
      id: "body",
      origin: [46, 70],
      shapes: [
        { kind: "ellipse", cx: 46, cy: 62, rx: 22, ry: 17, fill: "token:body", stroke: "#ffffff", width: 1.5, opacity: 0.92 },
        { kind: "ellipse", cx: 39, cy: 53, rx: 10, ry: 5, fill: "#ffffff", opacity: 0.14 },
      ],
    },
    {
      id: "legs",
      origin: [48, 79],
      shapes: [
        { kind: "path", d: "M43 78 V86 M53 78 V86 M39 86 H47 M49 86 H57", stroke: "currentColor", width: 2, cap: "round", fill: "none" },
      ],
    },
    {
      id: "head",
      origin: [68, 44],
      shapes: [
        { kind: "circle", cx: 68, cy: 42, r: 14, fill: "token:body", stroke: "#ffffff", width: 1.5, opacity: 0.94 },
        { kind: "ellipse", cx: 63, cy: 35, rx: 6, ry: 3.4, fill: "#ffffff", opacity: 0.16 },
      ],
    },
    {
      id: "crest",
      origin: [66, 30],
      shapes: [
        { kind: "path", d: "M60 31 C62 20 70 18 74 24", stroke: "currentColor", width: 3, cap: "round", fill: "none" },
      ],
    },
    {
      id: "beak",
      origin: [81, 44],
      shapes: [{ kind: "polygon", points: [80, 40, 93, 45, 80, 49], fill: "currentColor" }],
    },
    {
      id: "eye",
      origin: [72, 40],
      shapes: [
        { kind: "circle", cx: 72, cy: 40, r: 4.6, fill: "token:ink" },
        { kind: "circle", cx: 73, cy: 40.6, r: 2.1, fill: "token:deep" },
        { kind: "circle", cx: 70.7, cy: 38.2, r: 1.1, fill: "#ffffff" },
      ],
    },
    {
      id: "wing",
      origin: [44, 58],
      shapes: [
        { kind: "path", d: "M42 56 C52 44 66 46 68 56 C58 68 46 68 42 56 Z", fill: "token:deep", stroke: "#ffffff", width: 1, opacity: 0.96 },
        { kind: "path", d: "M47 57 C54 51 60 51 64 56", stroke: "#ffffff", width: 1, fill: "none", opacity: 0.3 },
      ],
    },
    {
      id: "note",
      origin: [24, 34],
      showIn: ["coding", "writing"],
      shapes: [
        { kind: "rect", x: 10, y: 22, w: 28, h: 22, r: 3, fill: "token:deep", stroke: "#ffffff", width: 1.1, opacity: 0.95 },
      ],
    },
    {
      id: "noteLines",
      origin: [24, 34],
      showIn: ["coding", "writing"],
      shapes: [
        { kind: "path", d: "M15 28 H28", stroke: "currentColor", width: 1.7, cap: "round", fill: "none" },
        { kind: "path", d: "M15 33 H33", stroke: "token:ink", width: 1.7, cap: "round", fill: "none", opacity: 0.6 },
        { kind: "path", d: "M15 38 H24", stroke: "token:ink", width: 1.7, cap: "round", fill: "none", opacity: 0.4 },
      ],
    },
    {
      id: "spark",
      origin: [30, 24],
      showIn: ["thinking", "searching"],
      shapes: [
        { kind: "circle", cx: 22, cy: 28, r: 2, fill: "currentColor" },
        { kind: "circle", cx: 30, cy: 22, r: 2.7, fill: "currentColor" },
        { kind: "circle", cx: 39, cy: 27, r: 2, fill: "currentColor" },
      ],
    },
    {
      id: "ring",
      origin: [46, 62],
      showIn: ["listening", "speaking", "screen"],
      shapes: [
        { kind: "circle", cx: 46, cy: 62, r: 30, stroke: "currentColor", width: 1.8, fill: "none", opacity: 0.5 },
      ],
    },
    {
      id: "doze",
      origin: [26, 30],
      showIn: ["sleeping"],
      shapes: [
        { kind: "circle", cx: 30, cy: 34, r: 2, fill: "token:ink", opacity: 0.5 },
        { kind: "circle", cx: 23, cy: 26, r: 2.8, fill: "token:ink", opacity: 0.35 },
        { kind: "circle", cx: 15, cy: 17, r: 3.6, fill: "token:ink", opacity: 0.2 },
      ],
    },
  ],
  states: {
    idle: {
      loop: 3.8,
      tracks: {
        body: [{ t: 0, y: 0, sy: 1 }, { t: 0.5, y: -1.4, sy: 1.02 }, { t: 1, y: 0, sy: 1 }],
        head: [{ t: 0, y: 0, r: 0 }, { t: 0.3, y: -1.6, r: -4 }, { t: 0.6, y: -0.6, r: 3 }, { t: 1, y: 0, r: 0 }],
        wing: [{ t: 0, r: 0 }, { t: 0.5, r: -6 }, { t: 1, r: 0 }],
        tail: [{ t: 0, r: 2 }, { t: 0.5, r: -3 }, { t: 1, r: 2 }],
        crest: [{ t: 0, r: -3 }, { t: 0.5, r: 5 }, { t: 1, r: -3 }],
        eye: blink,
      },
    },
    listening: {
      loop: 1,
      accent: "#ff5f52",
      tracks: {
        head: [{ t: 0, r: -8 }, { t: 0.5, r: -4, y: -1 }, { t: 1, r: -8 }],
        crest: [{ t: 0, r: -10, sy: 1 }, { t: 0.5, r: -14, sy: 1.2 }, { t: 1, r: -10, sy: 1 }],
        eye: [{ t: 0, s: 1 }, { t: 0.5, s: 1.15 }, { t: 1, s: 1 }],
        ring: [{ t: 0, s: 0.4, o: 0.7, ease: "linear" }, { t: 1, s: 1.05, o: 0, ease: "out" }],
      },
    },
    thinking: {
      loop: 2,
      tracks: {
        head: [{ t: 0, r: 6, y: -2 }, { t: 0.5, r: -6, y: -3 }, { t: 1, r: 6, y: -2 }],
        crest: [{ t: 0, r: -6 }, { t: 0.5, r: 8 }, { t: 1, r: -6 }],
        spark: [
          { t: 0, o: 0.2, s: 0.7 },
          { t: 0.35, o: 1, s: 1.05, ease: "backOut" },
          { t: 0.8, o: 0.4, s: 0.9 },
          { t: 1, o: 0.2, s: 0.7 },
        ],
      },
    },
    working: {
      loop: 0.34,
      tracks: {
        body: [{ t: 0, y: 0 }, { t: 0.5, y: -2.6 }, { t: 1, y: 0 }],
        wing: [{ t: 0, r: -26, sy: 0.8 }, { t: 0.5, r: 22, sy: 1.1 }, { t: 1, r: -26, sy: 0.8 }],
        wingBack: [{ t: 0, r: 20, sy: 1.1 }, { t: 0.5, r: -22, sy: 0.85 }, { t: 1, r: 20, sy: 1.1 }],
        tail: [{ t: 0, r: -4 }, { t: 0.5, r: 5 }, { t: 1, r: -4 }],
        legs: [{ t: 0, o: 0.3 }],
      },
    },
    coding: {
      loop: 0.52,
      tracks: {
        head: [{ t: 0, r: -22, y: 4, x: -3 }, { t: 0.5, r: -34, y: 9, x: -5 }, { t: 1, r: -22, y: 4, x: -3 }],
        beak: [{ t: 0, r: -18 }, { t: 0.5, r: -30 }, { t: 1, r: -18 }],
        body: [{ t: 0, r: -3 }, { t: 0.5, r: -5 }, { t: 1, r: -3 }],
        wing: [{ t: 0, r: -4 }, { t: 0.5, r: 4 }, { t: 1, r: -4 }],
        noteLines: [
          { t: 0, y: 4, o: 0, ease: "linear" },
          { t: 0.15, y: 2, o: 1, ease: "linear" },
          { t: 0.85, y: -8, o: 1, ease: "linear" },
          { t: 1, y: -11, o: 0, ease: "linear" },
        ],
      },
    },
    reading: {
      loop: 2.4,
      tracks: {
        head: [{ t: 0, r: -14, x: -2 }, { t: 0.45, r: -14, x: 3 }, { t: 0.5, r: -14, x: -3, ease: "out" }, { t: 1, r: -14, x: -2 }],
        eye: [{ t: 0, x: -1 }, { t: 0.45, x: 1.6 }, { t: 0.5, x: -1.6, ease: "out" }, { t: 1, x: -1 }],
        body: [{ t: 0, y: 0 }, { t: 0.5, y: -1 }, { t: 1, y: 0 }],
      },
    },
    writing: {
      loop: 0.8,
      tracks: {
        head: [{ t: 0, r: -20, y: 4 }, { t: 0.5, r: -26, y: 7 }, { t: 1, r: -20, y: 4 }],
        beak: [{ t: 0, r: -16, x: 0 }, { t: 0.5, r: -22, x: -3 }, { t: 1, r: -16, x: 0 }],
        noteLines: [{ t: 0, x: 0 }, { t: 0.5, x: 1.4 }, { t: 1, x: 0 }],
      },
    },
    searching: {
      loop: 1.8,
      tracks: {
        head: [{ t: 0, r: -12, x: -2 }, { t: 0.35, r: 12, x: 2 }, { t: 0.7, r: -6, x: -1 }, { t: 1, r: -12, x: -2 }],
        body: [{ t: 0, r: -2 }, { t: 0.5, r: 2 }, { t: 1, r: -2 }],
        spark: [{ t: 0, o: 0.3, s: 0.8 }, { t: 0.5, o: 1, s: 1.05 }, { t: 1, o: 0.3, s: 0.8 }],
      },
    },
    running: {
      loop: 0.3,
      tracks: {
        body: [{ t: 0, x: -1, y: 0 }, { t: 0.5, x: 1, y: -2 }, { t: 1, x: -1, y: 0 }],
        wing: [{ t: 0, r: -30 }, { t: 0.5, r: 26 }, { t: 1, r: -30 }],
        wingBack: [{ t: 0, r: 26 }, { t: 0.5, r: -26 }, { t: 1, r: 26 }],
        legs: [{ t: 0, r: -14 }, { t: 0.5, r: 14 }, { t: 1, r: -14 }],
      },
    },
    screen: {
      loop: 1.8,
      accent: "#ff9f45",
      tracks: {
        head: [{ t: 0, r: 4, x: 1 }, { t: 0.5, r: -6, x: -1 }, { t: 1, r: 4, x: 1 }],
        beak: [{ t: 0, r: 4, x: 1 }, { t: 0.5, r: -6, x: -2 }, { t: 1, r: 4, x: 1 }],
        ring: [{ t: 0, s: 0.35, o: 0.65, ease: "linear" }, { t: 1, s: 1.1, o: 0, ease: "out" }],
        wing: [{ t: 0, r: -8 }, { t: 0.5, r: 4 }, { t: 1, r: -8 }],
      },
    },
    speaking: {
      loop: 0.6,
      tracks: {
        beak: [{ t: 0, r: -3, sy: 0.85 }, { t: 0.5, r: 9, sy: 1.15 }, { t: 1, r: -3, sy: 0.85 }],
        head: [{ t: 0, y: 0 }, { t: 0.5, y: -1 }, { t: 1, y: 0 }],
        ring: [{ t: 0, s: 0.4, o: 0.5, ease: "linear" }, { t: 1, s: 1, o: 0, ease: "out" }],
      },
    },
    done: {
      loop: 1.6,
      accent: "#58c9a0",
      tracks: {
        body: [
          { t: 0, y: 0 },
          { t: 0.18, y: -12, ease: "out" },
          { t: 0.42, y: 0, ease: "in" },
          { t: 0.52, sy: 0.9, ease: "out" },
          { t: 0.66, sy: 1, ease: "backOut" },
          { t: 1, y: 0, sy: 1 },
        ],
        head: [{ t: 0, y: 0 }, { t: 0.18, y: -13, ease: "out" }, { t: 0.45, y: 0, ease: "in" }, { t: 1, y: 0 }],
        wing: [{ t: 0, r: 0 }, { t: 0.18, r: -34, ease: "out" }, { t: 0.5, r: 6 }, { t: 1, r: 0 }],
        wingBack: [{ t: 0, r: 0 }, { t: 0.18, r: 30, ease: "out" }, { t: 0.5, r: -4 }, { t: 1, r: 0 }],
        crest: [{ t: 0, r: 0 }, { t: 0.2, r: -16, ease: "out" }, { t: 1, r: 0 }],
      },
    },
    error: {
      loop: 0.4,
      accent: "#ff5f52",
      tracks: {
        body: [{ t: 0, x: -2 }, { t: 0.5, x: 2 }, { t: 1, x: -2 }],
        head: [{ t: 0, x: -2.6, r: 3 }, { t: 0.5, x: 2.6, r: -3 }, { t: 1, x: -2.6, r: 3 }],
        eye: [{ t: 0, sy: 0.5 }],
        crest: [{ t: 0, r: 14 }, { t: 0.5, r: -14 }, { t: 1, r: 14 }],
      },
    },
    sleeping: {
      loop: 5,
      tracks: {
        body: [{ t: 0, sy: 0.98, y: 2 }, { t: 0.5, sy: 1.03, y: 0 }, { t: 1, sy: 0.98, y: 2 }],
        head: [{ t: 0, r: 26, x: -9, y: 6 }, { t: 0.5, r: 28, x: -9, y: 5 }, { t: 1, r: 26, x: -9, y: 6 }],
        eye: shut,
        crest: [{ t: 0, r: 16 }, { t: 0.5, r: 12 }, { t: 1, r: 16 }],
        wing: [{ t: 0, r: 4, y: 1 }],
        doze: [
          { t: 0, o: 0, y: 6, s: 0.6, ease: "linear" },
          { t: 0.4, o: 0.9, y: 0, s: 1 },
          { t: 1, o: 0, y: -10, s: 1.2, ease: "linear" },
        ],
      },
    },
  },
};

export { DROP } from "./drop";

export const BUILTIN_COMPANIONS: CompanionSpec[] = [DROP, MOCHI, JELLY, PEBBLE, FINCH];
