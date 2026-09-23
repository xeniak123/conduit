import { describe, expect, it } from "vitest";
import type { Tokens } from "marked";
import { decodeEntities, lex, safeHref, type MathToken, type Token } from "./markdown-parse";

const types = (tokens: Token[]) => tokens.filter((t) => t.type !== "space").map((t) => t.type);

function inlineOf(text: string): Token[] {
  const [first] = lex(text);
  return (first as Tokens.Paragraph).tokens;
}

describe("the reply reader", () => {
  it("reads the constructs models actually answer with", () => {
    const tokens = lex(
      [
        "# Title",
        "",
        "Some **bold** and ~~struck~~ text.",
        "",
        "| a | b |",
        "|:--|--:|",
        "| 1 | 2 |",
        "",
        "- [ ] to do",
        "- [x] done",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );
    expect(types(tokens)).toEqual(["heading", "paragraph", "table", "list", "code", "hr"]);

    const table = tokens.find((t) => t.type === "table") as Tokens.Table;
    expect(table.align).toEqual(["left", "right"]);
    const list = tokens.find((t) => t.type === "list") as Tokens.List;
    expect(list.items.map((i) => [i.task, i.checked])).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it("nests lists instead of flattening them", () => {
    const list = lex("- one\n  - inner\n- two")[0] as Tokens.List;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].tokens.some((t) => t.type === "list")).toBe(true);
  });

  it("keeps an unfinished code fence as code while a reply is still streaming", () => {
    const tokens = lex("Here:\n\n```python\nprint('hi')");
    expect(types(tokens)).toEqual(["paragraph", "code"]);
    expect((tokens.find((t) => t.type === "code") as Tokens.Code).text).toBe("print('hi')");
  });

  it("keeps single line breaks, the way people write in a chat", () => {
    expect(inlineOf("line one\nline two").some((t) => t.type === "br")).toBe(true);
  });
});

describe("maths", () => {
  it("reads display maths in both spellings", () => {
    for (const source of ["$$\n\\frac{a}{b}\n$$", "\\[\\frac{a}{b}\\]"]) {
      const [token] = lex(source) as unknown as MathToken[];
      expect(token.type, source).toBe("mathBlock");
      expect(token.text).toBe("\\frac{a}{b}");
    }
  });

  it("reads inline maths", () => {
    const math = inlineOf("Area is $\\pi r^2$ and \\(e^x\\).").filter((t) => t.type === "mathInline") as unknown as MathToken[];
    expect(math.map((m) => m.text)).toEqual(["\\pi r^2", "e^x"]);
  });

  it("leaves prices alone", () => {
    const tokens = inlineOf("It costs $5 and $10 a month.");
    expect(tokens.some((t) => t.type === "mathInline")).toBe(false);
  });
});

describe("safety", () => {
  it("allows only links that go somewhere safe", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" JavaScript:alert(1)")).toBeNull();
    expect(safeHref("file:///C:/Windows")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("turns raw HTML into a token the view prints as text", () => {
    const tokens = inlineOf("before <img src=x onerror=alert(1)> after");
    expect(tokens.some((t) => t.type === "html")).toBe(true);
  });

  it("decodes entities for display", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#8212; &#x2014;")).toBe("a & b <c> \u2014 \u2014");
    expect(decodeEntities("R&D; &unknown;")).toBe("R&D; &unknown;");
  });
});
