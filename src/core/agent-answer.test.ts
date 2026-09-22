import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/computer", () => ({ captureScreen: vi.fn(), frameDescription: () => "", lastFrame: () => null }));

const replies: Array<{ text: string; calls: never[] }> = [];
vi.mock("@/llm", () => ({
  PROVIDER_CATALOG: [],
  withFallback: (p: unknown) => p,
  getProvider: () => ({
    id: "test",
    label: "Test",
    suggestedModels: [],
    complete: async () => replies.shift() ?? { text: "", calls: [], stopReason: "stop" },
  }),
}));

import { runAgent } from "./agent";
import { DEFAULT_SETTINGS } from "./config";

const ctx = {
  focus: { process: "", title: "" },
  conversationId: "c",
  confirm: async () => true,
  report: () => undefined,
};

describe("a run always ends in words", () => {
  it("asks again when the model returns an empty turn", async () => {
    replies.length = 0;
    replies.push({ text: "", calls: [] }, { text: "", calls: [] }, { text: "Here is the answer.", calls: [] });
    const run = await runAgent("hello", DEFAULT_SETTINGS, ctx, () => undefined);
    expect(run.answer).toBe("Here is the answer.");
  });

  it("says something useful even when every turn is empty", async () => {
    replies.length = 0;
    const run = await runAgent("hello", DEFAULT_SETTINGS, ctx, () => undefined);
    expect(run.answer.length).toBeGreaterThan(10);
    expect(run.answer).toMatch(/could not produce an answer/i);
  });
});
