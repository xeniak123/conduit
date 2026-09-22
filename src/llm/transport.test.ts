import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { abortable } from "./transport";

describe("stop", () => {
  it("settles at once when aborted, without waiting for the request", async () => {
    const never = new Promise<string>(() => undefined);
    const controller = new AbortController();
    const started = Date.now();
    const run = abortable(never, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toThrow("Aborted");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("passes the result through when not aborted", async () => {
    await expect(abortable(Promise.resolve(42), new AbortController().signal)).resolves.toBe(42);
  });
});
