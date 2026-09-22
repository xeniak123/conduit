import { describe, expect, it } from "vitest";
import { parseSpec } from "@/companion/spec";
import { parseSkill } from "@/skills";
import type { Registry } from "./types";

/**
 * The registry is what strangers install. Every entry is checked here, so a
 * pull request that breaks a pet or a skill fails in CI rather than on
 * somebody's desktop.
 */
// Vite reads the files at build time, so the test needs no Node typings.
const FILES = import.meta.glob("../../registry/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const read = (path: string): string | undefined => FILES[`../../registry/${path}`];
const registry = JSON.parse(read("registry.json") ?? "{}") as Registry;

describe("registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = registry.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{1,48}$/);
  });

  it("points only at files that exist, with safe names", () => {
    for (const item of registry.items) {
      for (const [name, path] of Object.entries(item.files ?? {})) {
        expect(name, item.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
        expect(read(path), `${item.id}: ${path}`).toBeDefined();
      }
    }
  });

  it("ships pets that pass the companion format", () => {
    for (const item of registry.items.filter((i) => i.kind === "companion")) {
      for (const path of Object.values(item.files ?? {})) {
        const raw = JSON.parse(read(path) ?? "");
        expect(() => parseSpec(raw), item.id).not.toThrow();
      }
    }
  });

  it("ships skills with a name and a description", () => {
    for (const item of registry.items.filter((i) => i.kind === "skill")) {
      for (const path of Object.values(item.files ?? {})) {
        const skill = parseSkill(read(path) ?? "", item.id, path);
        expect(skill, item.id).not.toBeNull();
      }
    }
  });

  it("marks every credential a tool server needs as a secret", () => {
    for (const item of registry.items.filter((i) => i.kind === "mcp")) {
      for (const field of item.mcp?.env ?? []) {
        if (/token|key|secret|password/i.test(field.name)) expect(field.secret, `${item.id}: ${field.name}`).toBeTruthy();
      }
    }
  });
});
