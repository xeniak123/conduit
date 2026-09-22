import { describe, expect, it } from "vitest";
import { BUILTIN_COMPANIONS } from "./builtin";
import { compileState } from "./runtime";
import { parseSpec, SpecError } from "./spec";

describe("companion format", () => {
  it("accepts every companion that ships with Conduit", () => {
    for (const spec of BUILTIN_COMPANIONS) {
      expect(() => parseSpec(JSON.parse(JSON.stringify(spec))), spec.id).not.toThrow();
    }
  });

  it("compiles every state of every built-in", () => {
    for (const spec of BUILTIN_COMPANIONS) {
      for (const state of Object.values(spec.states)) {
        if (state) expect(() => compileState(state)).not.toThrow();
      }
    }
  });

  it("refuses paint that could reach outside the document", () => {
    const bad = {
      id: "evil",
      name: "Evil",
      kind: "pet",
      parts: [{ id: "a", shapes: [{ kind: "circle", cx: 1, cy: 1, r: 1, fill: "url(https://x.test/a.svg#p)" }] }],
      states: {},
    };
    expect(() => parseSpec(bad)).toThrow(SpecError);
  });

  it("refuses markup smuggled into path data", () => {
    const bad = {
      id: "evil",
      name: "Evil",
      kind: "pet",
      parts: [{ id: "a", shapes: [{ kind: "path", d: "M0 0<script>alert(1)</script>" }] }],
      states: {},
    };
    expect(() => parseSpec(bad)).toThrow(/path data/);
  });

  it("refuses a track for a part that does not exist", () => {
    const bad = {
      id: "typo",
      name: "Typo",
      kind: "pet",
      parts: [{ id: "body", shapes: [{ kind: "circle", cx: 1, cy: 1, r: 1 }] }],
      states: { idle: { loop: 1, tracks: { bodyy: [{ t: 0 }] } } },
    };
    expect(() => parseSpec(bad)).toThrow(/unknown part "bodyy"/);
  });
});
