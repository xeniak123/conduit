import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { DEFAULT_SETTINGS } from "./config";
import { needsStrong } from "./router";

describe("router rules", () => {
  const s = DEFAULT_SETTINGS;
  it("keeps small talk on the fast model", () => {
    expect(needsStrong("hi, how are you?", s)).toBeNull();
    expect(needsStrong("translate 'good morning' to Polish", s)).toBeNull();
  });
  it("sends code, reasoning and attachments to the strong model", () => {
    expect(needsStrong("why does this throw? ```js\nx()\n```", s)).not.toBeNull();
    expect(needsStrong("refactor my auth module", s)).not.toBeNull();
    expect(needsStrong("look at this", s, 1)).not.toBeNull();
    expect(needsStrong("hi", { ...s, code: { ...s.code, enabled: true } })).not.toBeNull();
  });
});
