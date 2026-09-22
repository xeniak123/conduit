import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPTS, fillVariables, matchPrompts, variablesIn } from "./prompts";

describe("matching a /query", () => {
  it("puts an exact trigger first", () => {
    expect(matchPrompts(BUILTIN_PROMPTS, "commit")[0].trigger).toBe("commit");
  });

  it("ranks trigger prefixes above title matches", () => {
    const results = matchPrompts(BUILTIN_PROMPTS, "re").map((p) => p.trigger);
    expect(results[0]).toMatch(/^re/);
    expect(results.every((t) => t.startsWith("re"))).toBe(true);
  });

  it("does not match a query buried inside a title word", () => {
    // "Where has my disk gone?" must not surface for /re — it reads as a bug
    // to anyone reaching for /review.
    expect(matchPrompts(BUILTIN_PROMPTS, "re").map((p) => p.trigger)).not.toContain("space");
  });

  it("keeps a single letter to trigger prefixes only", () => {
    expect(matchPrompts(BUILTIN_PROMPTS, "c").map((p) => p.trigger)).toEqual(["commit"]);
  });

  it("still finds a trigger by a fragment once the query is longer", () => {
    expect(matchPrompts(BUILTIN_PROMPTS, "plain").map((p) => p.trigger)).toContain("explain");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(matchPrompts(BUILTIN_PROMPTS, "zzzz")).toHaveLength(0);
  });

  it("returns everything for an empty query", () => {
    expect(matchPrompts(BUILTIN_PROMPTS, "")).toHaveLength(BUILTIN_PROMPTS.length);
  });
});

describe("variables", () => {
  it("finds each placeholder once, ignoring whitespace", () => {
    expect(variablesIn("Read {{file}}, then {{ file }} and {{other}}")).toEqual(["file", "other"]);
  });

  it("finds none in a plain prompt", () => {
    expect(variablesIn("Summarise my last ten commits")).toEqual([]);
  });

  it("substitutes values", () => {
    expect(fillVariables("open {{name}} in {{where}}", { name: "site", where: "Documents" })).toBe(
      "open site in Documents",
    );
  });

  it("leaves no braces behind when a value is missing", () => {
    // A leftover {{placeholder}} reaching the model produces a confusing
    // answer and teaches people not to trust the library.
    expect(fillVariables("open {{name}}", {})).toBe("open ");
  });
});

describe("the shipped library", () => {
  it("has unique triggers", () => {
    const triggers = BUILTIN_PROMPTS.map((p) => p.trigger);
    expect(new Set(triggers).size).toBe(triggers.length);
  });

  it("uses triggers that are safe to type after a slash", () => {
    for (const prompt of BUILTIN_PROMPTS) {
      expect(prompt.trigger, prompt.trigger).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("describes every entry, so the menu is never a list of bare words", () => {
    for (const prompt of BUILTIN_PROMPTS) {
      expect(prompt.title.length, prompt.trigger).toBeGreaterThan(3);
      expect(prompt.hint.length, prompt.trigger).toBeGreaterThan(3);
    }
  });

  it("only references tools that exist", async () => {
    const { registerFsTools } = await import("@/tools/builtin/fs");
    const { registerSystemTools } = await import("@/tools/builtin/system");
    const { registerDevTools } = await import("@/tools/builtin/dev");
    const { registerWebTools } = await import("@/tools/builtin/web");
    const { listTools } = await import("@/tools/registry");

    registerFsTools();
    registerSystemTools();
    registerDevTools();
    registerWebTools();

    const known = new Set(listTools().map((t) => t.name));
    const referenced = new Set<string>();
    for (const prompt of BUILTIN_PROMPTS) {
      for (const match of prompt.body.matchAll(/\b([a-z]+\.[a-z_]+)\b/g)) referenced.add(match[1]);
    }

    // A shipped prompt naming a tool that does not exist fails the first time
    // somebody uses it, which is the worst possible moment to find out.
    expect([...referenced].filter((name) => !known.has(name))).toEqual([]);
  });
});
