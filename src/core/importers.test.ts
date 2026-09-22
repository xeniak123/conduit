import { describe, expect, it } from "vitest";
import { parseExport } from "./importers";
import { nextAfter } from "./schedule";

describe("chat import", () => {
  it("follows the branch last seen in a ChatGPT export", () => {
    const gpt = [
      {
        title: "Trip",
        update_time: 1700000000,
        current_node: "c",
        mapping: {
          root: { message: null, parent: null },
          a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["Plan a trip"] } }, parent: "root" },
          b: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["Old answer"] } }, parent: "a" },
          c: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["Regenerated"] } }, parent: "a" },
        },
      },
    ];
    const { source, conversations } = parseExport(gpt);
    expect(source).toBe("chatgpt");
    expect(conversations[0].messages.map((m) => m.text)).toEqual(["Plan a trip", "Regenerated"]);
    expect(conversations[0].title).toBe("Trip");
  });

  it("reads a Claude export", () => {
    const claude = [
      { uuid: "1", name: "Hi", chat_messages: [{ sender: "human", text: "Hello" }, { sender: "assistant", text: "Hi there" }] },
    ];
    const { source, conversations } = parseExport(claude);
    expect(source).toBe("claude");
    expect(conversations[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("schedule", () => {
  it("skips weekends for weekday tasks", () => {
    const saturday = new Date(2026, 8, 19, 10, 0); // Sat 19 Sep 2026
    const next = nextAfter({ kind: "weekdays", time: "08:00" }, saturday)!;
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(8);
  });

  it("runs later the same day when the time has not passed", () => {
    const morning = new Date(2026, 8, 22, 7, 30);
    const next = nextAfter({ kind: "daily", time: "09:15" }, morning)!;
    expect(next.getDate()).toBe(22);
    expect(next.getMinutes()).toBe(15);
  });

  it("never schedules manual tasks", () => {
    expect(nextAfter({ kind: "manual" }, new Date())).toBeNull();
  });
});
