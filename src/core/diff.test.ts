import { describe, expect, it } from "vitest";
import { diffLines, hunks, stats } from "./diff";

const render = (before: string, after: string) =>
  diffLines(before, after).map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);

describe("line diffs", () => {
  it("shows a changed line as one removal and one addition", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("handles insertions and deletions at either end", () => {
    expect(render("b\nc", "a\nb\nc\nd")).toEqual(["+a", " b", " c", "+d"]);
    expect(render("a\nb\nc", "b")).toEqual(["-a", " b", "-c"]);
  });

  it("treats a new file as all additions and a cleared one as all removals", () => {
    expect(render("", "x\ny").filter((l) => l.startsWith("+"))).toHaveLength(2);
    expect(stats(diffLines("x\ny", ""))).toEqual({ added: 0, removed: 2 });
  });

  it("numbers lines on both sides", () => {
    const lines = diffLines("a\nb\nc", "a\nX\nb\nc");
    const added = lines.find((l) => l.kind === "add")!;
    expect(added.new).toBe(2);
    expect(lines.find((l) => l.text === "c")).toMatchObject({ old: 3, new: 4 });
  });

  it("stays fast on a big file with a small edit", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join("\n");
    const edited = big.replace("line 10000", "line ten thousand");
    const started = performance.now();
    const { added, removed } = stats(diffLines(big, edited));
    expect([added, removed]).toEqual([1, 1]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("hunks", () => {
  it("keeps only the changes and a little context", () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l5", "L5").replace("l25", "L25");
    const found = hunks(diffLines(before, after), 2);
    expect(found).toHaveLength(2);
    expect(found[0].lines.map((l) => l.text)).toEqual(["l3", "l4", "l5", "L5", "l6", "l7"]);
  });
});
