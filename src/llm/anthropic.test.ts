import { describe, expect, it } from "vitest";
import { toAnthropic } from "./anthropic";
import type { Msg } from "./types";

/**
 * Message serialisation.
 *
 * Every bug here is silent. A malformed history does not throw — the model
 * simply behaves worse, stops issuing parallel tool calls, or loses sight of a
 * screenshot, and the cause is invisible from the outside.
 */

describe("tool results", () => {
  it("batches consecutive results into a single user turn", () => {
    // Splitting them across turns teaches the model to stop making parallel
    // calls at all, which is a permanent, invisible performance loss.
    const messages: Msg[] = [
      { role: "user", text: "check both" },
      {
        role: "assistant",
        calls: [
          { id: "a", name: "fs.read", input: {} },
          { id: "b", name: "fs.list", input: {} },
        ],
      },
      { role: "tool", callId: "a", name: "fs.read", result: "one" },
      { role: "tool", callId: "b", name: "fs.list", result: "two" },
    ];

    const out = toAnthropic(messages);
    const resultTurns = out.filter(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    );

    expect(resultTurns).toHaveLength(1);
    expect((resultTurns[0].content as unknown[]).length).toBe(2);
  });

  it("marks a failed tool as an error rather than dropping it", () => {
    const out = toAnthropic([
      { role: "assistant", calls: [{ id: "a", name: "shell.run", input: {} }] },
      { role: "tool", callId: "a", name: "shell.run", result: "boom", isError: true },
    ]);

    const block = (out.at(-1)!.content as unknown as Array<Record<string, unknown>>)[0];
    expect(block.is_error).toBe(true);
    expect(block.tool_use_id).toBe("a");
  });

  it("starts a fresh turn when a result follows a plain user message", () => {
    const out = toAnthropic([
      { role: "user", text: "hello" },
      { role: "tool", callId: "a", name: "x", result: "r" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("hello");
  });
});

describe("assistant turns", () => {
  it("carries text and tool calls together", () => {
    const out = toAnthropic([
      { role: "assistant", text: "Looking now.", calls: [{ id: "a", name: "fs.read", input: { path: "x" } }] },
    ]);

    const content = out[0].content as unknown as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("tool_use");
    expect(content[1].input).toEqual({ path: "x" });
  });

  it("omits an assistant turn with nothing in it", () => {
    // An empty content array is rejected by the API outright.
    expect(toAnthropic([{ role: "assistant" }])).toHaveLength(0);
  });
});

describe("images", () => {
  it("puts the image before the text", () => {
    // The model should have the picture in view while it reads the
    // instruction; reversing this measurably weakens grounding.
    const out = toAnthropic([
      { role: "user", text: "what is this", image: { base64: "AAA", mediaType: "image/png" } },
    ]);

    const content = out[0].content as unknown as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
  });

  it("leaves a plain message as a plain string", () => {
    expect(toAnthropic([{ role: "user", text: "hello" }])[0].content).toBe("hello");
  });
});
