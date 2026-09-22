import { load, type Store } from "@tauri-apps/plugin-store";
import type { Conversation } from "./store";
import { isTauri } from "./host";

/**
 * Conversations that survive a restart.
 *
 * Until now chats lived in memory and vanished when the window closed, which
 * is fine for a prototype and disqualifying for anything else — the record of
 * what an agent did on your machine is the most valuable thing the app holds.
 *
 * Writes are debounced because a live run appends a step every few hundred
 * milliseconds, and persisting on each one would put the disk in the hot path
 * of the agent loop.
 */

const FILE = "conversations.json";
const DEBOUNCE_MS = 700;
const MAX_CONVERSATIONS = 500;

let store: Store | null = null;
let timer: number | null = null;
let queued: Conversation[] | null = null;

export async function loadConversations(): Promise<Conversation[]> {
  if (!isTauri()) return [];
  try {
    store = await load(FILE, { autoSave: false });
    const saved = await store.get<Conversation[]>("conversations");
    if (!Array.isArray(saved)) return [];
    // Newest first, matching how they are displayed.
    return saved.sort((a, b) => b.at - a.at).slice(0, MAX_CONVERSATIONS);
  } catch {
    // A damaged history file must not stop the app from opening. The user
    // gets an empty list rather than a dead window.
    return [];
  }
}

export function persistConversations(conversations: Conversation[]): void {
  if (!isTauri()) return;
  queued = conversations;

  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
}

/** Forces a write — used before the window closes, where a debounce would lose. */
export async function flush(): Promise<void> {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!store || !queued) return;

  const payload = queued.slice(0, MAX_CONVERSATIONS).map((c) => ({
    ...c,
    // Screenshots are megabytes each and only useful while a run is live.
    // Keeping them would turn a month of history into gigabytes.
    messages: c.messages.map(({ screenshot: _screenshot, ...rest }) => rest),
  }));

  queued = null;
  try {
    await store.set("conversations", payload);
    await store.save();
  } catch {
    /* disk full or locked; the in-memory session is still intact */
  }
}
