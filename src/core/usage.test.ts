import { describe, expect, it } from "vitest";
import { costOf, formatCost, formatTokens, priceFor, summarise, type UsageEntry } from "./usage";

/**
 * Money. An error here is not cosmetic — it either understates what somebody
 * is spending, or it fires a budget warning that trains them to ignore budget
 * warnings.
 */

describe("pricing", () => {
  it("prices a known model per million tokens", () => {
    // Opus 5 is $5 in, $25 out per million.
    expect(costOf("claude-opus-5", 1_000_000, 1_000_000)).toBeCloseTo(30, 9);
    expect(costOf("claude-opus-5", 500_000, 0)).toBeCloseTo(2.5, 9);
  });

  it("resolves a vendor-prefixed OpenRouter model to the same price", () => {
    expect(costOf("anthropic/claude-sonnet-5", 1_000_000, 0)).toBe(
      costOf("claude-sonnet-5", 1_000_000, 0),
    );
  });

  it("treats anything running locally as free", () => {
    for (const [model, provider] of [
      ["llama3.3", "ollama"],
      ["qwen2.5-coder", "local"],
      ["Qwen3-8B-Q4_K_M.gguf", "local"],
    ]) {
      expect(costOf(model, 1_000_000, 1_000_000, provider), model).toBe(0);
    }
    expect(costOf("local/qwen3-8b", 1_000_000, 1_000_000)).toBe(0);
  });

  it("does not call a cloud model free because of its name", () => {
    // Qwen on OpenRouter is billed. It used to be priced at zero because the
    // name contains "qwen", which hid real spending from the daily budget.
    for (const model of ["qwen/qwen3-max", "meta-llama/llama-4-maverick", "mistralai/mistral-large"]) {
      expect(costOf(model, 1_000_000, 1_000_000, "openrouter"), model).not.toBe(0);
    }
  });

  it("returns null rather than zero for a model it does not know", () => {
    // Zero would silently understate the bill; null lets the UI say "unpriced".
    expect(costOf("model-released-next-tuesday", 1000, 1000)).toBeNull();
    expect(priceFor("model-released-next-tuesday")).toBeNull();
  });
});

describe("summarising", () => {
  const entry = (overrides: Partial<UsageEntry> = {}): UsageEntry => ({
    at: Date.now(),
    model: "claude-opus-5",
    input: 1000,
    output: 500,
    cost: 0.0175,
    ...overrides,
  });

  it("adds up today's spend and tokens", () => {
    const summary = summarise([entry(), entry()]);
    expect(summary.today.calls).toBe(2);
    expect(summary.today.tokens).toBe(3000);
    expect(summary.today.cost).toBeCloseTo(0.035, 9);
  });

  it("counts unpriced calls separately instead of folding them in as zero", () => {
    const summary = summarise([entry(), entry({ cost: null })]);
    expect(summary.today.unpriced).toBe(1);
    expect(summary.today.cost).toBeCloseTo(0.0175, 9);
  });

  it("ignores entries from before today in the daily figure", () => {
    const threeDaysAgo = Date.now() - 3 * 86_400_000;
    const summary = summarise([entry(), entry({ at: threeDaysAgo })]);
    expect(summary.today.calls).toBe(1);
  });

  it("always reports a fortnight of days, including empty ones", () => {
    const summary = summarise([]);
    expect(summary.daily).toHaveLength(14);
    expect(summary.daily.every((d) => d.cost === 0)).toBe(true);
  });

  it("ranks models by spend", () => {
    const summary = summarise([
      entry({ model: "cheap", cost: 0.001 }),
      entry({ model: "dear", cost: 0.5 }),
    ]);
    expect(summary.byModel[0].model).toBe("dear");
  });
});

describe("formatting", () => {
  it("keeps sub-cent amounts legible instead of rounding them to nothing", () => {
    // $0.0003 shown as "$0.00" makes every small call look free.
    expect(formatCost(0.0003)).toBe("$0.0003");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("abbreviates large token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(3_200_000)).toBe("3.2M");
  });
});
