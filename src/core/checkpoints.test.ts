import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny file system in memory, standing in for the native commands.
const disk = new Map<string, string>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: { path: string; contents?: string }) => {
    if (command === "fs_read") {
      if (!disk.has(args.path)) throw new Error("not found");
      return disk.get(args.path);
    }
    if (command === "fs_write") disk.set(args.path, args.contents ?? "");
    if (command === "fs_remove") disk.delete(args.path);
    return "";
  }),
}));
vi.mock("./host", () => ({ isTauri: () => true }));

const { beginCheckpoint, endCheckpoint, rememberBefore, snapshotBefore, undoCheckpoint, useCheckpoints } = await import(
  "./checkpoints"
);

beforeEach(() => {
  disk.clear();
  useCheckpoints.setState({ byMessage: {} });
});

describe("checkpoints", () => {
  it("puts edited files back and deletes the ones the run created", async () => {
    disk.set("a.ts", "original a");
    beginCheckpoint("c1", "m1");
    await snapshotBefore("c1", "a.ts");
    disk.set("a.ts", "changed a");
    await snapshotBefore("c1", "new.ts");
    disk.set("new.ts", "brand new");
    endCheckpoint("c1");

    const result = await undoCheckpoint("m1");
    expect(result).toEqual({ restored: 2, failed: [] });
    expect(disk.get("a.ts")).toBe("original a");
    expect(disk.has("new.ts")).toBe(false);
    expect(useCheckpoints.getState().byMessage.m1.state).toBe("undone");
  });

  it("keeps the first version when a file is written twice in one run", async () => {
    disk.set("a.ts", "v1");
    beginCheckpoint("c1", "m1");
    rememberBefore("c1", "a.ts", "v1");
    disk.set("a.ts", "v2");
    rememberBefore("c1", "a.ts", "v2");
    disk.set("a.ts", "v3");
    endCheckpoint("c1");

    await undoCheckpoint("m1");
    expect(disk.get("a.ts")).toBe("v1");
  });

  it("records nothing when no reply is running", async () => {
    rememberBefore("c1", "a.ts", "x");
    expect(useCheckpoints.getState().byMessage).toEqual({});
  });

  it("does not undo twice", async () => {
    disk.set("a.ts", "v1");
    beginCheckpoint("c1", "m1");
    rememberBefore("c1", "a.ts", "v1");
    endCheckpoint("c1");
    disk.set("a.ts", "v2");
    await undoCheckpoint("m1");
    disk.set("a.ts", "later work");
    expect(await undoCheckpoint("m1")).toEqual({ restored: 0, failed: [] });
    expect(disk.get("a.ts")).toBe("later work");
  });
});
