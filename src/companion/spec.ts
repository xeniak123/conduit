/**
 * The companion format.
 *
 * Anyone can make a pet for Conduit, and the format is the reason that is true
 * rather than a marketing line. Two decisions carry it:
 *
 *   **Drawing is data, not code.** A companion is a list of shapes with
 *   numeric attributes — no raw SVG markup, no script, no external references.
 *   A downloaded pet therefore cannot run anything, because there is nothing
 *   in the format capable of expressing "run". Sanitising arbitrary SVG is a
 *   game you eventually lose; not accepting it is a game you cannot lose.
 *
 *   **Motion is keyframes against activities, not a timeline.** A pet does not
 *   play an animation; it reacts to what Conduit is doing. The author writes
 *   what "writing code" looks like, and the runtime decides when that is true.
 */

/** What Conduit is doing, as far as the companion is concerned. */
export type Activity =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "coding"
  | "reading"
  | "writing"
  | "searching"
  | "running"
  | "screen"
  | "speaking"
  | "done"
  | "error"
  | "sleeping"
  | "walking"
  | "held";

export const ACTIVITIES: readonly Activity[] = [
  "idle",
  "listening",
  "thinking",
  "working",
  "coding",
  "reading",
  "writing",
  "searching",
  "running",
  "screen",
  "speaking",
  "done",
  "error",
  "sleeping",
  "walking",
  "held",
];

/** Human labels, used in Settings and in the companion's own caption. */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  working: "Working",
  coding: "Writing code",
  reading: "Reading files",
  writing: "Editing files",
  searching: "Searching",
  running: "Running a command",
  screen: "Using the screen",
  speaking: "Answering",
  done: "Done",
  error: "Something failed",
  sleeping: "Asleep",
  walking: "Walking",
  held: "Being carried",
};

export type Ease =
  | "linear"
  | "in"
  | "out"
  | "inOut"
  | "backOut"
  | "elasticOut"
  | "hold";

/** One moment in a loop. Every field is optional; absent means "unchanged". */
export interface Keyframe {
  /** Position within the loop, 0 to 1. */
  t: number;
  x?: number;
  y?: number;
  /** Degrees. */
  r?: number;
  /** Uniform scale; `sx`/`sy` override per axis. */
  s?: number;
  sx?: number;
  sy?: number;
  o?: number;
  /** How the value arrives at this key. Defaults to `inOut`. */
  ease?: Ease;
}

export type ShapeKind = "path" | "circle" | "ellipse" | "rect" | "polygon" | "line";

/**
 * A colour. Only literals and palette tokens — never `url(...)`, which is the
 * one thing in SVG paint that can reach outside the document.
 */
export type Paint = string;

export interface Shape {
  kind: ShapeKind;
  /** `path` */
  d?: string;
  /** `circle`, `ellipse` */
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  /** `rect`, `line` */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  /** `polygon` — flat pairs. */
  points?: number[];

  fill?: Paint;
  stroke?: Paint;
  width?: number;
  cap?: "round" | "butt" | "square";
  join?: "round" | "bevel" | "miter";
  opacity?: number;
  /** Dashes, as a flat list of lengths. */
  dash?: number[];
}

export interface Part {
  id: string;
  shapes: Shape[];
  /** Rotation and scale happen about this point, in viewBox units. */
  origin?: [number, number];
  /** Only drawn during these activities. Absent means always. */
  showIn?: Activity[];
  /** Draw order; lower first. Defaults to declaration order. */
  z?: number;
}

export interface StateDef {
  /** Seconds for one cycle. */
  loop: number;
  /** Keyframes per part id. A part with no track holds still. */
  tracks: Record<string, Keyframe[]>;
  /** Overrides the bead's rim colour while this activity is current. */
  accent?: Paint;
}

export interface CompanionSpec {
  id: string;
  name: string;
  /** `droplet` renders the bare glass bead; `pet` draws a creature in it. */
  kind: "droplet" | "pet";
  author?: string;
  version?: string;
  license?: string;
  description?: string;
  /** Defaults to "0 0 100 100". */
  viewBox?: string;
  /** Named colours the shapes refer to as `token:name`. */
  palette?: Record<string, string>;
  parts: Part[];
  states: Partial<Record<Activity, StateDef>>;
}

// --- validation --------------------------------------------------------------

const SHAPE_KINDS = new Set<string>(["path", "circle", "ellipse", "rect", "polygon", "line"]);
const EASES = new Set<string>(["linear", "in", "out", "inOut", "backOut", "elasticOut", "hold"]);

/**
 * Path data, restricted to the command letters and numbers.
 *
 * Path syntax has no way to reference anything external, so this is really a
 * shape check rather than a security boundary — but a malformed `d` silently
 * renders nothing, and an author would rather be told than shipped a pet that
 * is invisible on somebody else's machine.
 */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE ,.+-]*$/;

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `none`, `currentColor`, or `token:name`. */
const PAINT = /^(none|currentColor|#[0-9a-fA-F]{3,8}|token:[a-zA-Z0-9_-]+)$/;

export class SpecError extends Error {}

const num = (value: unknown, where: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SpecError(`${where} must be a finite number.`);
  }
  return value;
};

function paint(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !PAINT.test(value)) {
    throw new SpecError(
      `${where} must be a hex colour, "none", "currentColor", or "token:name" — got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function shape(raw: unknown, where: string): Shape {
  if (!raw || typeof raw !== "object") throw new SpecError(`${where} must be an object.`);
  const input = raw as Record<string, unknown>;

  if (typeof input.kind !== "string" || !SHAPE_KINDS.has(input.kind)) {
    throw new SpecError(`${where}.kind must be one of ${[...SHAPE_KINDS].join(", ")}.`);
  }
  const kind = input.kind as ShapeKind;
  const out: Shape = { kind };

  if (kind === "path") {
    if (typeof input.d !== "string" || !PATH_DATA.test(input.d)) {
      throw new SpecError(`${where}.d is not path data.`);
    }
    out.d = input.d;
  }

  for (const key of ["cx", "cy", "r", "rx", "ry", "x", "y", "w", "h", "x2", "y2", "width", "opacity"] as const) {
    if (input[key] !== undefined) {
      (out as unknown as Record<string, number>)[key] = num(input[key], `${where}.${key}`);
    }
  }

  if (input.points !== undefined) {
    if (!Array.isArray(input.points) || input.points.length < 4 || input.points.length % 2 !== 0) {
      throw new SpecError(`${where}.points must be an even list of at least two coordinate pairs.`);
    }
    out.points = input.points.map((p, i) => num(p, `${where}.points[${i}]`));
  }

  if (input.dash !== undefined) {
    if (!Array.isArray(input.dash)) throw new SpecError(`${where}.dash must be a list.`);
    out.dash = input.dash.map((d, i) => num(d, `${where}.dash[${i}]`));
  }

  out.fill = paint(input.fill, `${where}.fill`);
  out.stroke = paint(input.stroke, `${where}.stroke`);
  if (input.cap === "round" || input.cap === "butt" || input.cap === "square") out.cap = input.cap;
  if (input.join === "round" || input.join === "bevel" || input.join === "miter") out.join = input.join;

  return out;
}

function keyframe(raw: unknown, where: string): Keyframe {
  if (!raw || typeof raw !== "object") throw new SpecError(`${where} must be an object.`);
  const input = raw as Record<string, unknown>;
  const key: Keyframe = { t: num(input.t, `${where}.t`) };
  if (key.t < 0 || key.t > 1) throw new SpecError(`${where}.t must be between 0 and 1.`);

  for (const field of ["x", "y", "r", "s", "sx", "sy", "o"] as const) {
    if (input[field] !== undefined) key[field] = num(input[field], `${where}.${field}`);
  }
  if (input.ease !== undefined) {
    if (typeof input.ease !== "string" || !EASES.has(input.ease)) {
      throw new SpecError(`${where}.ease must be one of ${[...EASES].join(", ")}.`);
    }
    key.ease = input.ease as Ease;
  }
  return key;
}

/**
 * Turns unknown JSON into a spec, or explains exactly why it is not one.
 *
 * Every failure names the field. A creature format whose error is "invalid
 * companion" would make authoring a guessing game, and the people writing
 * these are not necessarily programmers.
 */
export function parseSpec(raw: unknown): CompanionSpec {
  if (!raw || typeof raw !== "object") throw new SpecError("A companion must be a JSON object.");
  const input = raw as Record<string, unknown>;

  if (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(input.id)) {
    throw new SpecError("id must be lowercase letters, digits and dashes, 2 to 39 characters.");
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new SpecError("name is required.");
  }
  if (input.kind !== "droplet" && input.kind !== "pet") {
    throw new SpecError('kind must be "droplet" or "pet".');
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    throw new SpecError("parts must contain at least one part.");
  }

  const seen = new Set<string>();
  const parts: Part[] = input.parts.map((rawPart, i) => {
    const where = `parts[${i}]`;
    if (!rawPart || typeof rawPart !== "object") throw new SpecError(`${where} must be an object.`);
    const partInput = rawPart as Record<string, unknown>;

    if (typeof partInput.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(partInput.id)) {
      throw new SpecError(`${where}.id must be a short identifier.`);
    }
    if (seen.has(partInput.id)) throw new SpecError(`Two parts share the id "${partInput.id}".`);
    seen.add(partInput.id);

    if (!Array.isArray(partInput.shapes) || partInput.shapes.length === 0) {
      throw new SpecError(`${where}.shapes must contain at least one shape.`);
    }

    const part: Part = {
      id: partInput.id,
      shapes: partInput.shapes.map((s, j) => shape(s, `${where}.shapes[${j}]`)),
    };

    if (partInput.origin !== undefined) {
      if (!Array.isArray(partInput.origin) || partInput.origin.length !== 2) {
        throw new SpecError(`${where}.origin must be [x, y].`);
      }
      part.origin = [
        num(partInput.origin[0], `${where}.origin[0]`),
        num(partInput.origin[1], `${where}.origin[1]`),
      ];
    }
    if (partInput.showIn !== undefined) {
      if (!Array.isArray(partInput.showIn)) throw new SpecError(`${where}.showIn must be a list.`);
      part.showIn = partInput.showIn.filter((a): a is Activity =>
        ACTIVITIES.includes(a as Activity),
      );
    }
    if (partInput.z !== undefined) part.z = num(partInput.z, `${where}.z`);
    return part;
  });

  const states: Partial<Record<Activity, StateDef>> = {};
  const rawStates = (input.states ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(rawStates)) {
    if (!ACTIVITIES.includes(name as Activity)) continue;
    if (!value || typeof value !== "object") throw new SpecError(`states.${name} must be an object.`);
    const stateInput = value as Record<string, unknown>;

    const tracks: Record<string, Keyframe[]> = {};
    const rawTracks = (stateInput.tracks ?? {}) as Record<string, unknown>;
    for (const [partId, keys] of Object.entries(rawTracks)) {
      if (!seen.has(partId)) throw new SpecError(`states.${name} animates unknown part "${partId}".`);
      if (!Array.isArray(keys)) throw new SpecError(`states.${name}.tracks.${partId} must be a list.`);
      tracks[partId] = keys
        .map((k, i) => keyframe(k, `states.${name}.tracks.${partId}[${i}]`))
        .sort((a, b) => a.t - b.t);
    }

    states[name as Activity] = {
      loop: Math.max(0.05, num(stateInput.loop ?? 1, `states.${name}.loop`)),
      tracks,
      accent: paint(stateInput.accent, `states.${name}.accent`),
    };
  }

  const palette: Record<string, string> = {};
  for (const [token, value] of Object.entries((input.palette ?? {}) as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw new SpecError(`palette key "${token}" is not a name.`);
    if (typeof value !== "string" || !/^(#[0-9a-fA-F]{3,8}|currentColor)$/.test(value)) {
      throw new SpecError(`palette.${token} must be a hex colour.`);
    }
    palette[token] = value;
  }

  const viewBox =
    typeof input.viewBox === "string" && /^[-0-9. ]+$/.test(input.viewBox)
      ? input.viewBox
      : "0 0 100 100";

  return {
    id: input.id,
    name: input.name.trim().slice(0, 60),
    kind: input.kind,
    author: typeof input.author === "string" ? input.author.slice(0, 80) : undefined,
    version: typeof input.version === "string" ? input.version.slice(0, 24) : undefined,
    license: typeof input.license === "string" ? input.license.slice(0, 40) : undefined,
    description: typeof input.description === "string" ? input.description.slice(0, 240) : undefined,
    viewBox,
    palette,
    parts,
    states,
  };
}

/** Resolves a spec paint to something CSS and SVG both accept. */
export function resolvePaint(value: Paint | undefined, palette: Record<string, string>): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("token:")) return palette[value.slice(6)] ?? "currentColor";
  return value;
}
