import { describe, expect, it } from "vitest";
import { useApp, type ChatMessage } from "./store";

const msg = (id: string, role: "user" | "assistant", text: string): ChatMessage => ({ id, role, text, steps: [] });

describe("conversation versions", () => {
  it("keeps the old version when a message is edited, and can go back to it", () => {
    useApp.setState({
      conversations: [{ id: "c", title: "t", at: 0, messages: [msg("u1", "user", "first"), msg("a1", "assistant", "old answer")] }],
    });
    const branch = useApp.getState().branchFrom("c", "u1", "second")!;
    expect(branch.version).toBe(1);
    expect(useApp.getState().conversations[0].messages).toHaveLength(0);

    // What sendMessage does with the edit.
    useApp.getState().addMessage("c", { ...msg("u2", "user", "second"), versions: branch.versions, version: 1 });
    useApp.getState().addMessage("c", msg("a2", "assistant", "new answer"));

    useApp.getState().showVersion("c", "u2", 0);
    expect(useApp.getState().conversations[0].messages.map((m) => m.text)).toEqual(["first", "old answer"]);

    useApp.getState().showVersion("c", "u2", 1);
    expect(useApp.getState().conversations[0].messages.map((m) => m.text)).toEqual(["second", "new answer"]);
  });
});
