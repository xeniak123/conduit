import type { ChatMessage, Conversation } from "./store";

/**
 * Bringing history over from ChatGPT and Claude.
 *
 * Both let you export your data as a zip with a `conversations.json` inside.
 * The shapes differ: ChatGPT stores each chat as a tree (edits and
 * regenerations are branches), Claude as a flat list. Only the branch you last
 * saw in ChatGPT is kept, which is what you would expect to find.
 */

interface GptNode {
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number | null;
  } | null;
  parent?: string | null;
}

interface GptConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, GptNode>;
  current_node?: string;
}

interface ClaudeConversation {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: Array<{
    sender?: string;
    text?: string;
    content?: Array<{ type?: string; text?: string }>;
    created_at?: string;
  }>;
}

const msg = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  text,
  steps: [],
});

function fromChatGpt(c: GptConversation): Conversation | null {
  if (!c.mapping || !c.current_node) return null;
  const chain: ChatMessage[] = [];
  let id: string | null | undefined = c.current_node;
  const seen = new Set<string>();
  while (id && c.mapping[id] && !seen.has(id)) {
    seen.add(id);
    const node: GptNode = c.mapping[id];
    const m = node.message;
    const role = m?.author?.role;
    const parts = (m?.content?.parts ?? []).filter((p): p is string => typeof p === "string");
    const text = parts.join("\n").trim();
    if ((role === "user" || role === "assistant") && text && m?.content?.content_type !== "code") {
      chain.unshift(msg(role, text));
    }
    id = node.parent;
  }
  if (!chain.length) return null;
  return {
    id: crypto.randomUUID(),
    title: (c.title || chain[0].text).slice(0, 60),
    at: Math.round((c.update_time ?? c.create_time ?? Date.now() / 1000) * 1000),
    messages: chain,
  };
}

function fromClaude(c: ClaudeConversation): Conversation | null {
  const messages = (c.chat_messages ?? [])
    .map((m) => {
      const text = (m.text || (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")).trim();
      const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
      return role && text ? msg(role, text) : null;
    })
    .filter((m): m is ChatMessage => m !== null);
  if (!messages.length) return null;
  return {
    id: crypto.randomUUID(),
    title: (c.name || messages[0].text).slice(0, 60),
    at: Date.parse(c.updated_at ?? c.created_at ?? "") || Date.now(),
    messages,
  };
}

export type Source = "chatgpt" | "claude" | "conduit";

/** Reads any of the three exports and says which one it was. */
export function parseExport(raw: unknown): { source: Source; conversations: Conversation[] } {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { conversations?: unknown[] }).conversations)
      ? (raw as { conversations: unknown[] }).conversations
      : [];
  const first = list[0] as Record<string, unknown> | undefined;
  if (first && "mapping" in first) {
    return { source: "chatgpt", conversations: list.map((c) => fromChatGpt(c as GptConversation)).filter(Boolean) as Conversation[] };
  }
  if (first && "chat_messages" in first) {
    return { source: "claude", conversations: list.map((c) => fromClaude(c as ClaudeConversation)).filter(Boolean) as Conversation[] };
  }
  const own = list.filter(
    (c): c is Conversation => !!c && typeof (c as Conversation).id === "string" && Array.isArray((c as Conversation).messages),
  );
  return { source: "conduit", conversations: own };
}
