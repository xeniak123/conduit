import type { CompanionSpec } from "./spec";

/**
 * The bare mark, for people who want a status bead and nothing living in it.
 *
 * It is the Conduit logo — two nested brackets, a channel narrowing as
 * something passes through — and the animation is that metaphor taken
 * literally: a pulse enters the channel, is squeezed by the inner bracket, and
 * leaves. It runs slowly at rest and quickly under load, so the *rate* of the
 * thing is the load indicator. A spinner tells you to wait; this tells you how
 * hard it is working.
 */
export const DROP: CompanionSpec = {
  id: "conduit-drop",
  name: "Droplet",
  kind: "droplet",
  author: "Conduit",
  version: "1.0.0",
  license: "MIT",
  description: "The mark, with something passing through it.",
  viewBox: "0 0 100 100",
  palette: { ink: "#fffefc" },
  parts: [
    {
      id: "outer",
      origin: [42, 50],
      shapes: [
        {
          kind: "path",
          d: "M58 18H34a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h24",
          stroke: "token:ink",
          fill: "none",
          width: 12,
          cap: "round",
          opacity: 0.6,
        },
      ],
    },
    {
      id: "pulse",
      origin: [40, 50],
      showIn: ["thinking", "working", "coding", "reading", "writing", "searching", "running", "screen", "speaking", "done"],
      shapes: [{ kind: "circle", cx: 34, cy: 50, r: 6, fill: "currentColor" }],
    },
    {
      id: "inner",
      origin: [52, 50],
      shapes: [
        {
          kind: "path",
          d: "M64 40H48a8 8 0 0 0-8 8v4a8 8 0 0 0 8 8h16",
          stroke: "currentColor",
          fill: "none",
          width: 10,
          cap: "round",
        },
      ],
    },
  ],
  states: {
    idle: {
      loop: 5,
      tracks: {
        outer: [{ t: 0, s: 1, o: 0.5 }, { t: 0.5, s: 1.03, o: 0.66 }, { t: 1, s: 1, o: 0.5 }],
        inner: [{ t: 0, s: 1, x: 0 }, { t: 0.5, s: 1.05, x: 1.5 }, { t: 1, s: 1, x: 0 }],
      },
    },
    listening: {
      loop: 1.1,
      accent: "#ff5f52",
      tracks: {
        outer: [{ t: 0, s: 1, o: 0.4 }, { t: 0.5, s: 1.12, o: 0.72 }, { t: 1, s: 1, o: 0.4 }],
        inner: [{ t: 0, sy: 1 }, { t: 0.5, sy: 1.22, sx: 1.04 }, { t: 1, sy: 1 }],
      },
    },
    // A pulse travels the channel: in at the left, squeezed at the waist, out
    // at the right. The whole loop is one unit of work passing through.
    thinking: {
      loop: 1.5,
      tracks: {
        outer: [{ t: 0, o: 0.42 }, { t: 0.5, o: 0.58 }, { t: 1, o: 0.42 }],
        inner: [{ t: 0, sy: 1 }, { t: 0.45, sy: 0.84, ease: "out" }, { t: 0.7, sy: 1.06 }, { t: 1, sy: 1 }],
        pulse: [
          { t: 0, x: -14, s: 0.5, o: 0, ease: "linear" },
          { t: 0.18, x: -6, s: 1, o: 1, ease: "out" },
          { t: 0.5, x: 6, sx: 0.66, sy: 1.18, ease: "inOut" },
          { t: 0.82, x: 22, s: 1, o: 1, ease: "in" },
          { t: 1, x: 32, s: 0.5, o: 0, ease: "linear" },
        ],
      },
    },
    working: {
      loop: 0.82,
      tracks: {
        outer: [{ t: 0, o: 0.45 }, { t: 0.5, o: 0.62 }, { t: 1, o: 0.45 }],
        inner: [{ t: 0, sy: 1 }, { t: 0.45, sy: 0.8, ease: "out" }, { t: 0.7, sy: 1.08 }, { t: 1, sy: 1 }],
        pulse: [
          { t: 0, x: -14, s: 0.5, o: 0, ease: "linear" },
          { t: 0.16, x: -6, s: 1, o: 1, ease: "out" },
          { t: 0.5, x: 6, sx: 0.62, sy: 1.22, ease: "inOut" },
          { t: 0.84, x: 22, s: 1, o: 1, ease: "in" },
          { t: 1, x: 32, s: 0.5, o: 0, ease: "linear" },
        ],
      },
    },
    running: {
      loop: 0.42,
      tracks: {
        outer: [{ t: 0, o: 0.5 }, { t: 0.5, o: 0.7 }, { t: 1, o: 0.5 }],
        inner: [{ t: 0, sy: 1 }, { t: 0.45, sy: 0.78, ease: "out" }, { t: 1, sy: 1 }],
        pulse: [
          { t: 0, x: -14, s: 0.6, o: 0, ease: "linear" },
          { t: 0.15, x: -6, s: 1, o: 1, ease: "out" },
          { t: 0.5, x: 6, sx: 0.6, sy: 1.25, ease: "inOut" },
          { t: 0.85, x: 22, s: 1, o: 1, ease: "in" },
          { t: 1, x: 32, s: 0.6, o: 0, ease: "linear" },
        ],
      },
    },
    done: {
      loop: 1.6,
      accent: "#58c9a0",
      tracks: {
        outer: [
          { t: 0, s: 0.92, o: 0.4 },
          { t: 0.22, s: 1.06, o: 0.7, ease: "backOut" },
          { t: 1, s: 1, o: 0.55 },
        ],
        inner: [{ t: 0, s: 0.9 }, { t: 0.26, s: 1.08, ease: "backOut" }, { t: 1, s: 1 }],
        pulse: [
          { t: 0, x: 2, s: 0.4, o: 0, ease: "out" },
          { t: 0.2, x: 12, s: 1.3, o: 1, ease: "backOut" },
          { t: 0.6, x: 26, s: 1, o: 0.6, ease: "in" },
          { t: 1, x: 34, s: 0.4, o: 0, ease: "linear" },
        ],
      },
    },
    error: {
      loop: 0.44,
      accent: "#ff5f52",
      tracks: {
        outer: [{ t: 0, x: -1.8, o: 0.6 }, { t: 0.5, x: 1.8, o: 0.6 }, { t: 1, x: -1.8, o: 0.6 }],
        inner: [{ t: 0, x: 1.8 }, { t: 0.5, x: -1.8 }, { t: 1, x: 1.8 }],
      },
    },
    sleeping: {
      loop: 7,
      tracks: {
        outer: [{ t: 0, s: 0.96, o: 0.26 }, { t: 0.5, s: 1, o: 0.4 }, { t: 1, s: 0.96, o: 0.26 }],
        inner: [{ t: 0, o: 0.42, s: 0.96 }, { t: 0.5, o: 0.62, s: 1 }, { t: 1, o: 0.42, s: 0.96 }],
      },
    },
  },
};
