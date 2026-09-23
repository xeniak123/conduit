import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { explainFailure } = await import("./runs");
const { chunkText, looksLikePath, toTextJsonl } = await import("./sources");

describe("why a run failed, in words", () => {
  it("names the usual failures", () => {
    expect(explainFailure(["torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB"])).toMatch(/ran out of memory/);
    expect(explainFailure(["ModuleNotFoundError: No module named 'trl'"])).toMatch(/missing the trl package/);
    expect(explainFailure(["OSError: You are trying to access a gated repo."])).toMatch(/gated/);
    expect(explainFailure(["python is not installed, or not on PATH."])).toMatch(/Python was not found/);
  });

  it("falls back to the last error line", () => {
    expect(explainFailure(["loading", "ValueError: bad value for max_length", "done"])).toBe("ValueError: bad value for max_length");
  });
});

describe("plain text for continued pretraining", () => {
  it("keeps paragraphs whole and packs them up to the size", () => {
    const text = ["one ".repeat(100), "two ".repeat(100), "three ".repeat(100)].join("\n\n");
    const chunks = chunkText(text, 900);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("two");
    expect(chunks.every((c) => c.length <= 900)).toBe(true);
  });

  it("cuts a single enormous paragraph rather than dropping it", () => {
    const chunks = chunkText("x".repeat(5000), 2000);
    expect(chunks.map((c) => c.length)).toEqual([2000, 2000, 1000]);
  });

  it("writes one text object per line and skips empty rows", () => {
    expect(toTextJsonl([{ body: "a" }, { body: "" }, { body: "b" }], "body")).toBe('{"text":"a"}\n{"text":"b"}');
  });
});

describe("telling a pasted path from a search", () => {
  it("recognises paths", () => {
    expect(looksLikePath("C:\\models\\qwen")).toBe(true);
    expect(looksLikePath("/home/me/models")).toBe(true);
    expect(looksLikePath("~/models")).toBe(true);
    expect(looksLikePath("qwen coder")).toBe(false);
    expect(looksLikePath("Qwen/Qwen3-8B")).toBe(false);
  });
});
