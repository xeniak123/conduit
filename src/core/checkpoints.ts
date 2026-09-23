import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "./host";

/**
 * Checkpoints: every reply that changed files can put them back.
 *
 * Before the agent writes a file for the first time in a run, what was there
 * is kept (or the fact that nothing was). The reply then offers the changes
 * for review as a diff, and a single "Undo" that restores every file the run
 * touched, deleting the ones it created. It is the difference between trusting
 * an agent with a repository and watching it nervously: a bad run costs one
 * click, not an evening with git.
 *
 * Kept in memory for the session. Files over a couple of megabytes are not
 * snapshotted, and the review says so rather than pretending it could undo
 * them.
 */

const MAX_FILE = 2_000_000;

export interface FileSnapshot {
  path: string;
  /** Contents before the run first touched it; null when it did not exist. */
  before: string | null;
  /** Too big to keep, so this one cannot be undone. */
  skipped?: boolean;
}

export interface Checkpoint {
  conversationId: string;
  messageId: string;
  at: number;
  files: FileSnapshot[];
  state: "open" | "undone";
}

interface State {
  byMessage: Record<string, Checkpoint>;
  set: (messageId: string, checkpoint: Checkpoint) => void;
}

export const useCheckpoints = create<State>((set) => ({
  byMessage: {},
  set: (messageId, checkpoint) => set((s) => ({ byMessage: { ...s.byMessage, [messageId]: checkpoint } })),
}));

/** Which reply is being written in each conversation right now. */
const running = new Map<string, string>();

export function beginCheckpoint(conversationId: string, messageId: string): void {
  running.set(conversationId, messageId);
}

export function endCheckpoint(conversationId: string): void {
  running.delete(conversationId);
}

function currentFor(conversationId: string): Checkpoint | null {
  const messageId = running.get(conversationId);
  if (!messageId) return null;
  return (
    useCheckpoints.getState().byMessage[messageId] ?? {
      conversationId,
      messageId,
      at: Date.now(),
      files: [],
      state: "open",
    }
  );
}

/** Records a file's contents the first time a run writes to it, when they are already at hand. */
export function rememberBefore(conversationId: string, path: string, before: string | null): void {
  const checkpoint = currentFor(conversationId);
  if (!checkpoint || checkpoint.files.some((f) => f.path === path)) return;
  const skipped = before !== null && before.length > MAX_FILE;
  useCheckpoints.getState().set(checkpoint.messageId, {
    ...checkpoint,
    files: [...checkpoint.files, { path, before: skipped ? null : before, skipped: skipped || undefined }],
  });
}

/** Reads and records a file before a write that did not read it first. */
export async function snapshotBefore(conversationId: string, path: string): Promise<void> {
  const checkpoint = currentFor(conversationId);
  if (!checkpoint || checkpoint.files.some((f) => f.path === path)) return;
  rememberBefore(conversationId, path, await readOrNull(path));
}

export async function readOrNull(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("fs_read", { path, limit: MAX_FILE + 1 });
  } catch {
    return null;
  }
}

/**
 * Puts every file back the way it was before the reply.
 *
 * In reverse order of first touch, so that if one file was reached under two
 * spellings of its path, the earliest snapshot is the one that ends up on
 * disk.
 */
export async function undoCheckpoint(messageId: string): Promise<{ restored: number; failed: string[] }> {
  const checkpoint = useCheckpoints.getState().byMessage[messageId];
  if (!checkpoint || checkpoint.state === "undone") return { restored: 0, failed: [] };
  const failed: string[] = [];
  let restored = 0;
  for (const file of [...checkpoint.files].reverse()) {
    if (file.skipped) {
      failed.push(file.path);
      continue;
    }
    try {
      if (file.before === null) await invoke("fs_remove", { path: file.path });
      else await invoke("fs_write", { path: file.path, contents: file.before });
      restored += 1;
    } catch {
      failed.push(file.path);
    }
  }
  useCheckpoints.getState().set(messageId, { ...checkpoint, state: "undone" });
  return { restored, failed };
}
