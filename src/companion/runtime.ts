import type { Activity, CompanionSpec, Ease, Keyframe, StateDef } from "./spec";

/**
 * Playing a companion.
 *
 * The loop writes transforms straight onto the SVG nodes rather than going
 * through React. Sixty renders a second of a component tree, to move a wing,
 * would cost more than every other thing this window does put together — and
 * the companion has to stay smooth while the agent is busy, which is exactly
 * when the rest of the app is not.
 *
 * Activity changes cross-fade. A pet that snapped from "thinking" to "coding"
 * would read as two pets rather than one changing its mind.
 */

interface Vec {
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  o: number;
}

const REST: Vec = { x: 0, y: 0, r: 0, sx: 1, sy: 1, o: 1 };

interface CompiledKey {
  t: number;
  v: Vec;
  ease: Ease;
}

interface CompiledState {
  loop: number;
  tracks: Map<string, CompiledKey[]>;
}

const EASING: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // Overshoots and settles — for something that was thrown, never for something
  // that merely appeared.
  backOut: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  elasticOut: (t) =>
    t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  // A step: the value holds until the next key, then jumps. Frame-by-frame
  // effects — a blink, a flicker — need this and nothing else.
  hold: () => 0,
};

/**
 * Fills every channel on every key.
 *
 * Authors write only what changes, which is the right thing to ask of them and
 * the wrong thing to interpolate against: a key that omits `y` means "keep the
 * last y", not "y is zero". Resolving it once at load turns every later sample
 * into two lookups and a lerp.
 */
function compileTrack(keys: Keyframe[]): CompiledKey[] {
  if (keys.length === 0) return [];

  const channels: Array<keyof Vec> = ["x", "y", "r", "sx", "sy", "o"];
  const carried: Vec = { ...REST };

  // One pass to the end first: what the last key leaves behind is what the
  // first key inherits when the loop wraps, so a cycle whose opening key omits
  // a channel does not start at rest and jump on the second time round.
  for (const key of keys) {
    if (key.s !== undefined) {
      carried.sx = key.s;
      carried.sy = key.s;
    }
    for (const channel of channels) {
      const value = key[channel as keyof Keyframe];
      if (typeof value === "number") carried[channel] = value;
    }
  }

  const running: Vec = { ...carried };
  return keys.map((key) => {
    if (key.s !== undefined) {
      running.sx = key.s;
      running.sy = key.s;
    }
    for (const channel of channels) {
      const value = key[channel as keyof Keyframe];
      if (typeof value === "number") running[channel] = value;
    }
    return { t: key.t, v: { ...running }, ease: key.ease ?? "inOut" };
  });
}

export function compileState(state: StateDef): CompiledState {
  const tracks = new Map<string, CompiledKey[]>();
  for (const [part, keys] of Object.entries(state.tracks)) {
    const compiled = compileTrack(keys);
    if (compiled.length) tracks.set(part, compiled);
  }
  return { loop: state.loop, tracks };
}

/** Samples a compiled track at a phase in [0, 1). */
function sample(keys: CompiledKey[], phase: number): Vec {
  if (keys.length === 1) return keys[0].v;

  let index = -1;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    if (phase >= keys[i].t) {
      index = i;
      break;
    }
  }

  // Before the first key, the loop is still travelling from the last one —
  // the segment that crosses the boundary, which is what makes a cycle seamless.
  const from = index === -1 ? keys[keys.length - 1] : keys[index];
  const to = index === -1 ? keys[0] : keys[(index + 1) % keys.length];

  let span = to.t - from.t;
  if (span <= 0) span += 1;
  let local = phase - from.t;
  if (local < 0) local += 1;

  const raw = span === 0 ? 1 : Math.min(1, local / span);
  const t = EASING[to.ease](raw);

  return {
    x: from.v.x + (to.v.x - from.v.x) * t,
    y: from.v.y + (to.v.y - from.v.y) * t,
    r: from.v.r + (to.v.r - from.v.r) * t,
    sx: from.v.sx + (to.v.sx - from.v.sx) * t,
    sy: from.v.sy + (to.v.sy - from.v.sy) * t,
    o: from.v.o + (to.v.o - from.v.o) * t,
  };
}

const mix = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  r: a.r + (b.r - a.r) * t,
  sx: a.sx + (b.sx - a.sx) * t,
  sy: a.sy + (b.sy - a.sy) * t,
  o: a.o + (b.o - a.o) * t,
});

/** Seconds spent blending one activity into the next. */
const CROSSFADE = 0.28;

export interface Choreographer {
  /** Called when what Conduit is doing changes. */
  setActivity(activity: Activity): void;
  /**
   * Extra motion layered over the loop, from the pointer's velocity. The pet
   * leans into travel the way anything being carried does.
   */
  setLean(x: number, y: number): void;
  stop(): void;
}

export function choreograph(
  root: SVGGElement,
  spec: CompanionSpec,
  initial: Activity,
  options: { reduced?: boolean } = {},
): Choreographer {
  const compiled = new Map<Activity, CompiledState>();
  for (const [activity, state] of Object.entries(spec.states)) {
    if (state) compiled.set(activity as Activity, compileState(state));
  }

  const origins = new Map<string, [number, number]>();
  for (const part of spec.parts) origins.set(part.id, part.origin ?? [50, 50]);

  const nodes = new Map<string, SVGGElement>();
  for (const node of Array.from(root.querySelectorAll<SVGGElement>("[data-part]"))) {
    const id = node.dataset.part;
    if (id) nodes.set(id, node);
  }

  let current: Activity = initial;
  let previous: Activity | null = null;
  let blend = 1;
  let phase = 0;
  let previousPhase = 0;
  let lean = { x: 0, y: 0 };
  let last = performance.now();
  let frame = 0;
  let running = true;

  const stateFor = (activity: Activity): CompiledState | undefined =>
    compiled.get(activity) ?? compiled.get("idle");

  const write = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const active = stateFor(current);
    if (active) phase = (phase + dt / active.loop) % 1;

    const old = previous ? stateFor(previous) : undefined;
    if (old) previousPhase = (previousPhase + dt / old.loop) % 1;

    if (blend < 1) {
      blend = Math.min(1, blend + dt / CROSSFADE);
      if (blend >= 1) previous = null;
    }

    for (const [id, node] of nodes) {
      const target = active?.tracks.get(id);
      let value = target ? sample(target, phase) : REST;

      if (previous && blend < 1) {
        const before = old?.tracks.get(id);
        const from = before ? sample(before, previousPhase) : REST;
        // Eased rather than linear: a linear cross-fade has a visible corner at
        // each end, which reads as a glitch rather than a change of mood.
        value = mix(from, value, EASING.inOut(blend));
      }

      const [ox, oy] = origins.get(id) ?? [50, 50];
      const x = value.x + lean.x;
      const y = value.y + lean.y;

      node.setAttribute(
        "transform",
        `translate(${round(ox + x)} ${round(oy + y)}) rotate(${round(value.r)}) scale(${round(value.sx)} ${round(value.sy)}) translate(${round(-ox)} ${round(-oy)})`,
      );
      node.style.opacity = value.o >= 1 ? "" : round(value.o).toString();
    }

    frame = requestAnimationFrame(write);
  };

  if (options.reduced) {
    // Reduced motion still means *a* state — the pet holds the first pose of
    // whatever it is doing, so the activity is still legible without anything
    // on screen moving.
    for (const [id, node] of nodes) {
      const keys = stateFor(current)?.tracks.get(id);
      const value = keys ? keys[0].v : REST;
      const [ox, oy] = origins.get(id) ?? [50, 50];
      node.setAttribute(
        "transform",
        `translate(${round(ox + value.x)} ${round(oy + value.y)}) rotate(${round(value.r)}) scale(${round(value.sx)} ${round(value.sy)}) translate(${round(-ox)} ${round(-oy)})`,
      );
    }
  } else {
    frame = requestAnimationFrame(write);
  }

  return {
    setActivity(next) {
      if (next === current) return;
      previous = current;
      previousPhase = phase;
      current = next;
      phase = 0;
      blend = 0;
    },
    setLean(x, y) {
      lean = { x, y };
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}

/** Two decimals is under a tenth of a viewBox unit, and keeps the string short. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Which activity a tool name represents.
 *
 * The pet's whole charm is that it is doing what Conduit is doing, so this
 * mapping is the feature. Unknown tools fall back to `working` rather than
 * `idle` — a busy pet standing still is worse than a busy pet being vague.
 */
export function activityForTool(tool: string): Activity {
  const group = tool.split(".")[0];
  switch (group) {
    case "screen":
      return "screen";
    case "shell":
      return "running";
    case "web":
      return "searching";
    case "code":
    case "dev":
    case "git":
      return "coding";
    default:
      break;
  }
  if (tool === "fs.read" || tool === "fs.list") return "reading";
  if (tool.startsWith("fs.")) return "writing";
  return "working";
}
