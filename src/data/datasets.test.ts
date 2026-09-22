import { describe, expect, it } from "vitest";
import { conversationsToJsonl, guessMapping, parseLocalDataset, rowToChat, slugify, toChatJsonl } from "./datasets";

describe("guessing the columns", () => {
  it("finds an instruction dataset's pair", () => {
    expect(guessMapping(["instruction", "input", "output"])).toEqual({
      prompt: "instruction",
      response: "output",
      system: undefined,
      context: "input",
    });
  });

  it("does not pair a conversation column with a response column", () => {
    // `messages` already contains both sides; adding `text` would duplicate it.
    expect(guessMapping(["messages", "text"]).response).toBe("");
  });

  it("picks up a system column when there is one", () => {
    expect(guessMapping(["system", "prompt", "response"]).system).toBe("system");
  });
});

describe("turning rows into chat turns", () => {
  const mapping = { prompt: "instruction", response: "output", system: "system" };

  it("reads a pair", () => {
    expect(rowToChat({ instruction: "Hi", output: "Hello" }, mapping)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("adds Alpaca's input to the question when a row has one", () => {
    const alpaca = { prompt: "instruction", response: "output", context: "input" };
    expect(rowToChat({ instruction: "Summarise this.", input: "A long text.", output: "Short." }, alpaca)[0]).toEqual({
      role: "user",
      content: "Summarise this.\n\nA long text.",
    });
    expect(rowToChat({ instruction: "Say hi.", input: "", output: "Hi." }, alpaca)[0].content).toBe("Say hi.");
  });

  it("keeps the system turn first", () => {
    const turns = rowToChat({ system: "Be brief.", instruction: "Hi", output: "Hello" }, mapping);
    expect(turns[0]).toEqual({ role: "system", content: "Be brief." });
  });

  it("reads a ShareGPT-style conversation, including its role names", () => {
    const turns = rowToChat(
      { conversations: [{ from: "human", value: "Hi" }, { from: "gpt", value: "Hello" }] },
      { prompt: "conversations", response: "" },
    );
    expect(turns).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("drops a row with nothing to learn from", () => {
    expect(rowToChat({ instruction: "Hi", output: "" }, mapping)).toEqual([]);
    expect(rowToChat({ conversations: [{ from: "human", value: "Hi" }] }, { prompt: "conversations", response: "" })).toEqual(
      [],
    );
  });

  it("writes one JSON object per line and skips the unusable rows", () => {
    const jsonl = toChatJsonl([{ instruction: "Hi", output: "Hello" }, { instruction: "Bye" }], mapping);
    expect(jsonl.split("\n")).toHaveLength(1);
    expect(JSON.parse(jsonl)).toEqual({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });
  });
});

describe("local files", () => {
  it("reads JSONL and survives a ragged line", () => {
    const parsed = parseLocalDataset('{"a":1}\nnot json\n{"a":2,"b":3}\n', "data.jsonl");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.columns).toEqual(["a", "b"]);
  });

  it("reads a JSON array", () => {
    expect(parseLocalDataset('[{"a":1},{"a":2}]', "data.json").rows).toHaveLength(2);
  });

  it("reads CSV without losing a quoted comma", () => {
    const parsed = parseLocalDataset('instruction,output\n"Hello, friend","Hi there"\n', "data.csv");
    expect(parsed.columns).toEqual(["instruction", "output"]);
    expect(parsed.rows[0]).toEqual({ instruction: "Hello, friend", output: "Hi there" });
  });

  it("reads a doubled quote as one quote", () => {
    const parsed = parseLocalDataset('a\n"say ""hi"""\n', "data.csv");
    expect(parsed.rows[0].a).toBe('say "hi"');
  });
});

describe("your own chats as training data", () => {
  it("turns each conversation into one example", () => {
    const { jsonl, count } = conversationsToJsonl([
      {
        title: "a",
        messages: [
          { role: "user", text: "Hi" },
          { role: "assistant", text: "Hello" },
        ],
      },
      { title: "b", messages: [{ role: "user", text: "Only a question" }] },
    ]);
    expect(count).toBe(1);
    expect(JSON.parse(jsonl).messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("drops an unfinished answer and a trailing question", () => {
    const { jsonl } = conversationsToJsonl([
      {
        title: "a",
        messages: [
          { role: "user", text: "One" },
          { role: "assistant", text: "Answer one" },
          { role: "user", text: "Two" },
          { role: "assistant", text: "half", pending: true },
        ],
      },
    ]);
    expect(JSON.parse(jsonl).messages.map((m: { content: string }) => m.content)).toEqual(["One", "Answer one"]);
  });

  it("adds a system turn when one is given", () => {
    const { jsonl } = conversationsToJsonl(
      [{ title: "a", messages: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Yo" }] }],
      "Be brief.",
    );
    expect(JSON.parse(jsonl).messages[0]).toEqual({ role: "system", content: "Be brief." });
  });

  it("makes file names out of ids", () => {
    expect(slugify("tatsu-lab/alpaca")).toBe("tatsu-lab-alpaca");
    expect(slugify("///")).toBe("dataset");
  });
});
