/**
 * Motion constants.
 *
 * Two springs, and a reason for each. Critically damped is the default — a
 * panel that merely appeared has no momentum to justify an overshoot. Bounce
 * is reserved for things the user physically threw or opened, where a little
 * overshoot reads as weight rather than decoration.
 */

export const SPRING = { type: "spring", bounce: 0, duration: 0.36 } as const;
export const SPRING_SOFT = { type: "spring", bounce: 0.18, duration: 0.42 } as const;
export const SPRING_SNAP = { type: "spring", bounce: 0, duration: 0.24 } as const;

/** Enter and exit along the same path — never in from the side, out the bottom. */
export const riseIn = {
  initial: { opacity: 0, y: 10, filter: "blur(3px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 6, filter: "blur(3px)" },
};

/**
 * Glass surfaces materialise: blur and scale move together so the panel reads
 * as a physical thing arriving, rather than an image fading up.
 */
export const materialize = {
  initial: { opacity: 0, scale: 0.97, filter: "blur(8px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, filter: "blur(6px)" },
};
