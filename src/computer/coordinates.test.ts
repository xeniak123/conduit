import { afterEach, describe, expect, it } from "vitest";
import { __setFrame, toScreen, type Capture } from "./index";

/**
 * Screenshot-space to screen-space.
 *
 * This is the most consequential arithmetic in the application. The model is
 * shown a downscaled image and answers in *its* pixels; getting the mapping
 * wrong does not throw, it simply clicks somewhere else — and on a 4K display
 * "somewhere else" can be a different window entirely.
 */

const frame = (overrides: Partial<Capture> = {}): Capture => ({
  png_base64: "",
  width: 1280,
  height: 800,
  screen_width: 2560,
  screen_height: 1600,
  ...overrides,
});

afterEach(() => __setFrame(null));

describe("mapping a click onto the display", () => {
  it("scales by the ratio between the image and the screen", () => {
    __setFrame(frame());
    expect(toScreen(640, 400)).toEqual({ x: 1280, y: 800 });
    expect(toScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(toScreen(1280, 800)).toEqual({ x: 2560, y: 1600 });
  });

  it("handles a non-square scale, as an ultrawide produces", () => {
    __setFrame(frame({ width: 1280, height: 540, screen_width: 3440, screen_height: 1440 }));
    const point = toScreen(640, 270);
    expect(point.x).toBe(1720);
    expect(point.y).toBe(720);
  });

  it("passes coordinates through unscaled when the screen was not downscaled", () => {
    __setFrame(frame({ width: 1280, height: 800, screen_width: 1280, screen_height: 800 }));
    expect(toScreen(317, 211)).toEqual({ x: 317, y: 211 });
  });

  it("rounds to whole pixels, because the pointer cannot land between them", () => {
    __setFrame(frame({ width: 1000, height: 1000, screen_width: 1501, screen_height: 1501 }));
    const point = toScreen(333, 333);
    expect(Number.isInteger(point.x)).toBe(true);
    expect(Number.isInteger(point.y)).toBe(true);
  });

  it("falls back to the raw values when no frame has been captured", () => {
    // Better an unscaled click than a crash mid-run; the model will see the
    // result in the next screenshot and correct itself.
    __setFrame(null);
    expect(toScreen(100.4, 200.6)).toEqual({ x: 100, y: 201 });
  });

  it("stays accurate at the far corner, where error is largest", () => {
    // A proportional mistake is invisible near the origin and enormous here.
    __setFrame(frame({ width: 1280, height: 720, screen_width: 3840, screen_height: 2160 }));
    expect(toScreen(1279, 719)).toEqual({ x: 3837, y: 2157 });
  });
});
