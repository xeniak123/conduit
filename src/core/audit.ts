import { load, type Store } from "@tauri-apps/plugin-store";
import { isTauri } from "./host";

/**
 * A record of every action the agent took on this machine.
 *
 * This is the feature that decides whether a company will let this run on a
 * work laptop at all. An assistant that can open a shell needs to be able to
 * answer, afterwards, exactly what it ran, when, on whose instruction, and
 * whether a human approved it — in a form that can be handed to somebody else.
 *
 * Append-only from the app's side: entries are never edited, only added and
 * eventually aged out.
 */

export interface AuditEntry {
  at: number;
  /** Conversation this belongs to, so an entry can be traced back to intent. */
  conversationId: string;
  tool: string;
  /** Arguments as the model supplied them, with obvious secrets masked. */
  input: Record<string, unknown>;
  outcome: "ran" | "declined" | "failed";
  /** Result or error, truncated — this is a log, not a data store. */
  detail: string;
  /** Whether a human explicitly approved this one. */
  approved: boolean;
}

const FILE = "audit.json";
const RETAIN_DAYS = 180;
const MAX_ENTRIES = 20_000;

let store: Store | null = null;
let entries: AuditEntry[] = [];
let ready = false;

export async function initAudit(): Promise<void> {
  if (!isTauri() || ready) return;
  try {
    store = await load(FILE, { autoSave: false });
    entries = (await store.get<AuditEntry[]>("entries")) ?? [];
    ready = true;
  } catch {
    ready = true;
  }
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  entries.push({ ...entry, input: mask(entry.input), detail: entry.detail.slice(0, 2000) });

  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  entries = entries.filter((e) => e.at >= cutoff).slice(-MAX_ENTRIES);

  if (!store) return;
  try {
    await store.set("entries", entries);
    await store.save();
  } catch {
    /* logging must never break the action it is logging */
  }
}

export function readAudit(limit = 500): AuditEntry[] {
  return entries.slice(-limit).reverse();
}

/**
 * Exports the log as CSV.
 *
 * CSV rather than JSON because the people who ask for this open it in a
 * spreadsheet, not an editor.
 */
export function exportCsv(): string {
  const header = ["timestamp", "tool", "outcome", "approved", "input", "detail"];
  const rows = entries.map((e) => [
    new Date(e.at).toISOString(),
    e.tool,
    e.outcome,
    e.approved ? "yes" : "no",
    JSON.stringify(e.input),
    e.detail,
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

const SECRET_HINTS = /(key|token|secret|password|passwd|auth|credential)/i;

/**
 * Arguments can carry a credential the user dictated into a command. Logging
 * it would turn the audit trail into the very leak it exists to prevent.
 */
function mask(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_HINTS.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      out[key] = value
        .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted]")
        .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, "[redacted]")
        .slice(0, 800);
      continue;
    }
    out[key] = value;
  }
  return out;
}
