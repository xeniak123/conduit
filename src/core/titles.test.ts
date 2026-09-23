import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/llm", () => ({ getProvider: vi.fn() }));

const { cleanTitle } = await import("./titles");

describe("chat titles", () => {
  it("keeps just the title", () => {
    expect(cleanTitle("Rust ownership explained")).toBe("Rust ownership explained");
    expect(cleanTitle('"Rust ownership explained."')).toBe("Rust ownership explained");
    expect(cleanTitle("Title: **Budget for Kraków trip**")).toBe("Budget for Kraków trip");
    expect(cleanTitle("Tytuł: Plan podróży do Krakowa")).toBe("Plan podróży do Krakowa");
  });

  it("ignores reasoning and extra lines", () => {
    expect(cleanTitle("<think>the user wants…</think>\nFixing a CUDA install\nSecond line")).toBe("Fixing a CUDA install");
  });

  it("shortens a runaway answer", () => {
    const title = cleanTitle("a".repeat(100));
    expect(title.length).toBeLessThanOrEqual(58);
    expect(title.endsWith("…")).toBe(true);
  });

  it("gives nothing for an empty reply, so the old title stays", () => {
    expect(cleanTitle("  \n ")).toBe("");
  });
});
