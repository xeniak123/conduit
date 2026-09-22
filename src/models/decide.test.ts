import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { candidatesFrom, decisionPrompt, distribution, isDecisionModel } from "./decide";

describe("decision models", () => {
  it("recognises them by name", () => {
    expect(isDecisionModel("chaoliangUNSW/Jev-Style-Qwen3.5-2B-Decision-GGUF")).toBe(true);
    expect(isDecisionModel("lostargon/Tiny-Jev")).toBe(true);
    expect(isDecisionModel("unsloth/Qwen3-8B-GGUF")).toBe(false);
  });

  it("writes the trained prompt, ending in Answer:", () => {
    const p = decisionPrompt("It rains.", "Take an umbrella?", ["Yes", "No"]);
    expect(p).toContain("A. Yes\nB. No");
    expect(p.endsWith("Answer:")).toBe(true);
  });

  it("renormalises letter probabilities, ignoring other tokens", () => {
    const c = candidatesFrom({
      completion_probabilities: [
        { top_logprobs: [{ token: " B", logprob: Math.log(0.6) }, { token: " A", logprob: Math.log(0.2) }, { token: " The", logprob: Math.log(0.2) }] },
      ],
    });
    const d = distribution(c, ["World", "Business"]);
    expect(d[1].p).toBeCloseTo(0.75);
    expect(d[0].p).toBeCloseTo(0.25);
  });

  it("reads the older probs shape too", () => {
    const c = candidatesFrom({ completion_probabilities: [{ probs: [{ tok_str: "A", prob: 0.9 }, { tok_str: "B", prob: 0.1 }] }] });
    expect(distribution(c, ["x", "y"])[0].p).toBeCloseTo(0.9);
  });
});

import real from "./decide.fixture.json";

describe("a real llama-server answer", () => {
  it("matches the model card's reported probabilities", () => {
    const d = distribution(candidatesFrom(real), ["World", "Sports", "Business", "Science/Technology"]);
    expect(d[2].p).toBeGreaterThan(0.6);
    expect(d[3].p).toBeGreaterThan(0.25);
    expect(d[2].p + d[3].p).toBeGreaterThan(0.95);
  });
});
