import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isGated, PROFILES, type PermissionProfile, type Settings } from "./config";

/**
 * The permission gate decides whether software running on someone's machine
 * stops to ask before it acts. It is the highest-consequence pure function in
 * the app, so it is the one place worth exhaustive tests: a regression here is
 * not a visual glitch, it is an unattended `rm -rf`.
 */

const withProfile = (
  profile: PermissionProfile,
  overrides: Partial<Settings["permissions"]> = {},
): Settings => ({
  ...DEFAULT_SETTINGS,
  permissions: { profile, alwaysAsk: [], neverAsk: [], ...overrides },
});

describe("permission profiles", () => {
  it("gates commands and deletions under Standard", () => {
    const settings = withProfile("standard");
    expect(isGated(settings, "shell.run")).toBe(true);
    expect(isGated(settings, "fs.delete")).toBe(true);
  });

  it("lets read-only tools run under Standard", () => {
    const settings = withProfile("standard");
    for (const tool of ["fs.read", "fs.list", "git.status", "web.search", "proc.list"]) {
      expect(isGated(settings, tool), tool).toBe(false);
    }
  });

  it("gates anything that writes or touches the screen under Guarded", () => {
    const settings = withProfile("guarded");
    for (const tool of ["shell.run", "fs.write", "fs.delete", "screen.click", "screen.type"]) {
      expect(isGated(settings, tool), tool).toBe(true);
    }
  });

  it("gates nothing under Trusted", () => {
    const settings = withProfile("trusted");
    for (const tool of ["shell.run", "fs.delete", "screen.type"]) {
      expect(isGated(settings, tool), tool).toBe(false);
    }
  });
});

describe("per-tool overrides", () => {
  it("can open a hole in the strictest profile", () => {
    expect(isGated(withProfile("guarded", { neverAsk: ["shell.run"] }), "shell.run")).toBe(false);
  });

  it("can close a hole in the loosest profile", () => {
    expect(isGated(withProfile("trusted", { alwaysAsk: ["fs.read"] }), "fs.read")).toBe(true);
  });

  it("resolves a contradiction toward running, matching the stated order", () => {
    // neverAsk is checked first. Documented here so the precedence cannot be
    // reversed by accident: someone who added a tool to both lists most
    // recently meant the permissive one.
    const settings = withProfile("standard", { neverAsk: ["x"], alwaysAsk: ["x"] });
    expect(isGated(settings, "x")).toBe(false);
  });
});

describe("confirm every screen action", () => {
  const paranoid: Settings = {
    ...withProfile("trusted"),
    computerUse: { enabled: true, confirmEveryAction: true, showCursor: true },
  };

  it("overrides even Trusted for screen tools", () => {
    expect(isGated(paranoid, "screen.type")).toBe(true);
    expect(isGated(paranoid, "screen.click")).toBe(true);
  });

  it("does not spill onto tools that never touch the screen", () => {
    expect(isGated(paranoid, "fs.read")).toBe(false);
    expect(isGated(paranoid, "shell.run")).toBe(false);
  });
});

describe("profile definitions", () => {
  it("names tools in the namespaced form the registry uses", () => {
    for (const profile of Object.values(PROFILES)) {
      for (const tool of profile.gated) {
        expect(tool, `${tool} should be namespaced`).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    }
  });

  it("keeps Guarded stricter than Standard, and Standard than Trusted", () => {
    expect(PROFILES.guarded.gated.length).toBeGreaterThan(PROFILES.standard.gated.length);
    expect(PROFILES.standard.gated.length).toBeGreaterThan(PROFILES.trusted.gated.length);
  });
});
