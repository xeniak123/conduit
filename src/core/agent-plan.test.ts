import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/computer", () => ({ captureScreen: vi.fn(), frameDescription: () => "", lastFrame: () => null }));

// Whatever tools the model was offered, and the brief it was given.
const seen: { tools: string[]; system: string } = { tools: [], system: "" };
vi.mock("@/llm", () => ({
  PROVIDER_CATALOG: [],
  withFallback: (p: unknown) => p,
  getProvider: () => ({
    id: "test",
    label: "Test",
    suggestedModels: [],
    complete: async (req: { tools?: Array<{ name: string }>; system?: string }) => {
      seen.tools = (req.tools ?? []).map((t) => t.name);
      seen.system = req.system ?? "";
      return { text: "The plan.", calls: [], stopReason: "stop" };
    },
  }),
}));

import { runAgent } from "./agent";
import { DEFAULT_SETTINGS } from "./config";
import { registerCodeTools } from "@/tools/builtin/code";

registerCodeTools();

const ctx = { focus: { process: "", title: "" }, conversationId: "c", confirm: async () => true, report: () => undefined };
const code = (plan: boolean) => ({ ...DEFAULT_SETTINGS, code: { ...DEFAULT_SETTINGS.code, enabled: true, plan } });

describe("plan mode", () => {
  it("offers only tools that cannot change anything", async () => {
    await runAgent("rename the helper", code(true), ctx, () => undefined);
    expect(seen.tools).toContain("code.read");
    expect(seen.tools).toContain("code.search");
    expect(seen.tools).not.toContain("code.edit");
    expect(seen.tools).not.toContain("code.insert");
    expect(seen.tools).not.toContain("code.test");
    expect(seen.system).toContain("PLAN MODE");
  });

  it("gives the writing tools back when the plan is carried out", async () => {
    await runAgent("go ahead", code(false), ctx, () => undefined);
    expect(seen.tools).toContain("code.edit");
    expect(seen.system).not.toContain("PLAN MODE");
  });
});
