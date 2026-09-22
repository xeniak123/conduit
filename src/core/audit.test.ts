import { beforeEach, describe, expect, it } from "vitest";
import { exportCsv, readAudit, recordAudit } from "./audit";

/**
 * The audit log exists so somebody can answer, later, exactly what ran on
 * their machine. Two things must hold: it records what happened, and it never
 * becomes the leak it was built to prevent.
 */

describe("redaction", () => {
  beforeEach(async () => {
    await recordAudit({
      at: Date.now(),
      conversationId: "c",
      tool: "shell.run",
      input: {
        command: "deploy --token sk-ant-api03-REALSECRETVALUE1234",
        api_key: "another-secret",
        password: "hunter2",
        path: "/safe/path",
      },
      outcome: "ran",
      detail: "deployed",
      approved: true,
    });
  });

  it("redacts fields named like a secret", () => {
    const entry = readAudit(1)[0];
    expect(entry.input.api_key).toBe("[redacted]");
    expect(entry.input.password).toBe("[redacted]");
  });

  it("redacts a key pasted inside an otherwise ordinary argument", () => {
    // Somebody dictating a deploy command is the realistic case, and the
    // field name gives no warning.
    const entry = readAudit(1)[0];
    expect(entry.input.command).not.toContain("REALSECRETVALUE");
    expect(entry.input.command).toContain("[redacted]");
  });

  it("leaves harmless arguments intact", () => {
    expect(readAudit(1)[0].input.path).toBe("/safe/path");
  });
});

describe("the record", () => {
  it("keeps the outcome and whether a human approved it", async () => {
    await recordAudit({
      at: Date.now(),
      conversationId: "c",
      tool: "fs.delete",
      input: { path: "/tmp/x" },
      outcome: "declined",
      detail: "User declined.",
      approved: false,
    });

    const entry = readAudit(1)[0];
    expect(entry.outcome).toBe("declined");
    expect(entry.approved).toBe(false);
  });

  it("returns newest first", async () => {
    await recordAudit({
      at: Date.now(),
      conversationId: "c",
      tool: "first",
      input: {},
      outcome: "ran",
      detail: "",
      approved: false,
    });
    await recordAudit({
      at: Date.now(),
      conversationId: "c",
      tool: "second",
      input: {},
      outcome: "ran",
      detail: "",
      approved: false,
    });

    expect(readAudit(2)[0].tool).toBe("second");
  });
});

describe("export", () => {
  it("writes a header row a spreadsheet will understand", () => {
    expect(exportCsv().split("\n")[0]).toBe(
      '"timestamp","tool","outcome","approved","input","detail"',
    );
  });

  it("escapes quotes so one detail cannot break the column layout", async () => {
    await recordAudit({
      at: Date.now(),
      conversationId: "c",
      tool: "shell.run",
      input: {},
      outcome: "ran",
      detail: 'said "hello", then stopped',
      approved: true,
    });

    const row = exportCsv().split("\n").at(-1)!;
    expect(row).toContain('""hello""');
    // The row must still have exactly the six fields the header promises.
    expect(row.match(/","/g)?.length).toBe(5);
  });
});
