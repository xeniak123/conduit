import { describe, expect, it } from "vitest";
import { parse, splitInline } from "./markdown-parse";

/**
 * A reply is whatever the model sends, which means the parser meets malformed
 * input constantly — half-written fences while a reply streams in, stray
 * asterisks, lists that stop mid-item. None of that may throw, and none of it
 * may swallow text: an answer that silently loses its second half is worse
 * than one that renders imperfectly.
 */

describe("blocks", () => {
  it("reads a fenced code block with its language", () => {
    const [block] = parse("```rust\nlet x = 1;\n```");
    expect(block).toEqual({ kind: "code", lang: "rust", body: "let x = 1;" });
  });

  it("keeps an unterminated fence rather than dropping the rest of the reply", () => {
    // This is the normal state of a streamed answer for a second or two.
    const [block] = parse("```js\nconst a = 1;");
    expect(block.kind).toBe("code");
    expect((block as { body: string }).body).toBe("const a = 1;");
  });

  it("reads headings at every level it supports", () => {
    expect(parse("# One")[0]).toEqual({ kind: "heading", level: 1, body: "One" });
    expect(parse("#### Four")[0]).toEqual({ kind: "heading", level: 4, body: "Four" });
  });

  it("groups consecutive bullets into one list", () => {
    const [block] = parse("- one\n- two\n- three");
    expect(block).toEqual({ kind: "list", ordered: false, items: ["one", "two", "three"] });
  });

  it("recognises a numbered list as ordered", () => {
    const [block] = parse("1. first\n2. second");
    expect(block).toEqual({ kind: "list", ordered: true, items: ["first", "second"] });
  });

  it("joins a wrapped quote into one block", () => {
    expect(parse("> line one\n> line two")[0]).toEqual({
      kind: "quote",
      body: "line one line two",
    });
  });

  it("keeps consecutive lines together as one paragraph", () => {
    expect(parse("one\ntwo\n\nthree")).toEqual([
      { kind: "para", body: "one\ntwo" },
      { kind: "para", body: "three" },
    ]);
  });

  it("does not run a paragraph into the block that follows it", () => {
    const blocks = parse("Here it is:\n```\ncode\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["para", "code"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parse("")).toEqual([]);
    expect(parse("\n\n  \n")).toEqual([]);
  });
});

describe("inline formatting", () => {
  it("splits code, bold, italics and links out of the surrounding text", () => {
    const parts = splitInline("run `npm test` for **all** of *them* — see [docs](https://x.dev)");
    const kinds = parts.map((p) => p.type);
    expect(kinds).toContain("code");
    expect(kinds).toContain("bold");
    expect(kinds).toContain("em");
    expect(kinds).toContain("link");
  });

  it("keeps a link's text and destination apart", () => {
    const link = splitInline("[the docs](https://example.com/a)").find((p) => p.type === "link");
    expect(link).toEqual({ type: "link", text: "the docs", href: "https://example.com/a" });
  });

  it("loses no characters, whatever the input", () => {
    // The property that actually matters: reassembling the parts must give
    // back the original, so no reply can quietly lose a word.
    for (const input of [
      "plain text",
      "a `b` c **d** e *f* g",
      "unmatched ` backtick",
      "unmatched ** bold",
      "**bold at the start** and end *italic*",
      "3 * 4 * 5 arithmetic",
    ]) {
      const rebuilt = splitInline(input)
        .map((p) => {
          if (p.type === "code") return `\`${p.text}\``;
          if (p.type === "bold") return `**${p.text}**`;
          if (p.type === "em") return `*${p.text}*`;
          if (p.type === "link") return `[${p.text}](${p.href})`;
          return p.text;
        })
        .join("");
      expect(rebuilt, input).toBe(input);
    }
  });

  it("treats text with no markup as a single plain part", () => {
    expect(splitInline("nothing special here")).toEqual([
      { type: "text", text: "nothing special here" },
    ]);
  });
});
