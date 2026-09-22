import { describe, expect, it } from "vitest";
import { cells, distance, makeWorld, options, stepToward } from "./grid";

describe("the decisions game", () => {
  it("builds maps where every open square is reachable", () => {
    for (let i = 0; i < 20; i++) {
      const w = makeWorld(11);
      const open = cells(w);
      expect(open.every((p) => distance(w, open[0], p) < Infinity)).toBe(true);
    }
  });

  it("offers only legal moves and flags danger", () => {
    const w = { size: 5, walls: new Set(["1,2"]) };
    const opts = options(w, { r: 2, c: 2 }, { r: 0, c: 2 }, { r: 2, c: 4 }, []);
    expect(opts.map((o) => o.dir).sort()).toEqual(["down", "left", "right"]);
    expect(opts.find((o) => o.dir === "right")!.label).toContain("caught by the ghost");
    expect(opts.find((o) => o.dir === "left")!.label).toContain("safe");
  });

  it("moves the ghost along a shortest path", () => {
    const w = { size: 5, walls: new Set<string>() };
    expect(stepToward(w, { r: 0, c: 0 }, { r: 0, c: 3 })).toEqual({ r: 0, c: 1 });
  });
});
