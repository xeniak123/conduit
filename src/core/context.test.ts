import { describe, expect, it } from "vitest";
import { contextWindow, historyChars, historyTokens, usageOf } from "./context";

describe("context windows", () => {
  it("knows the big cloud windows, through a router prefix too", () => {
    expect(contextWindow("anthropic", "claude-opus-5")).toBe(1_000_000);
    expect(contextWindow("openrouter", "anthropic/claude-sonnet-5")).toBe(1_000_000);
    expect(contextWindow("anthropic", "claude-haiku-4-5")).toBe(200_000);
    expect(contextWindow("openai", "gpt-5")).toBe(400_000);
    expect(contextWindow("google", "gemini-2.5-pro")).toBe(1_000_000);
  });

  it("uses the context a local model was actually started with", () => {
    expect(contextWindow("local", "qwen3-8b.gguf", 16_384)).toBe(16_384);
    expect(contextWindow("local", "qwen3-8b.gguf")).toBe(8_192);
  });
});

describe("history budget", () => {
  it("fits a small local model instead of overflowing it", () => {
    // The old fixed budget was 60K characters, about 16K tokens: more than an
    // 8K local model can hold, so long chats with it failed outright.
    expect(historyChars("local", "m", 8_192)).toBeLessThan(60_000);
    expect(historyTokens("local", "m", 8_192)).toBeLessThan(8_192 / 2);
  });

  it("gives a large model far more than before, but not its whole window", () => {
    expect(historyChars("anthropic", "claude-opus-5")).toBeGreaterThan(60_000 * 5);
    expect(historyTokens("anthropic", "claude-opus-5")).toBeLessThanOrEqual(150_000);
  });
});

describe("the meter", () => {
  it("counts what will be sent and what will not", () => {
    const long = "x".repeat(10_000);
    const messages = Array.from({ length: 10 }, () => ({ text: long }));
    const usage = usageOf(messages, "local", "m", 8_192);
    expect(usage.dropped).toBeGreaterThan(0);
    expect(usage.sent).toBeLessThanOrEqual(usage.budget);
  });

  it("ignores unfinished and empty messages", () => {
    const usage = usageOf([{ text: "hi" }, { text: "", pending: true }, { text: "  " }], "anthropic", "claude-opus-5");
    expect(usage.dropped).toBe(0);
    expect(usage.sent).toBe(1);
  });
});
