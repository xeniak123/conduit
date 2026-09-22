import { getSettings, saveSettings } from "@/core/config";
import { useApp } from "@/core/store";
import { register, schema, str, type Tool } from "../registry";

/**
 * Memory: short facts that carry across chats.
 *
 * Only what the person would want every future chat to know (their name,
 * their stack, how they like answers) and never secrets. Each memory is one
 * sentence the user can read and delete in Settings, so nothing is kept that
 * they cannot see.
 */

function persist(memories: ReturnType<typeof getSettings>["memories"]) {
  const next = { ...useApp.getState().settings, memories };
  useApp.getState().setSettings(next);
  void saveSettings(next);
}

const saveTool: Tool = {
  name: "memory.save",
  source: "builtin",
  description:
    "Remember one lasting fact about the user for future chats, e.g. their name, role, tools, or how they like answers. " +
    "Use when they state a preference or ask you to remember something. One short sentence. Never store passwords, keys or other secrets.",
  parameters: schema({ fact: str("The fact, as one short sentence in the third person.") }, ["fact"]),
  async run(input) {
    const fact = String(input.fact ?? "").trim().slice(0, 300);
    if (!fact) return "Nothing to remember.";
    if (/(password|api[ _-]?key|secret|token|\bsk-|\bhf_)/i.test(fact)) {
      return "Not saved: memories never hold secrets.";
    }
    const settings = getSettings();
    if (!settings.autoMemory) return "Memory is turned off in Settings.";
    if (settings.memories.some((m) => m.text.toLowerCase() === fact.toLowerCase())) return "Already remembered.";
    persist([{ id: crypto.randomUUID(), text: fact, at: Date.now() }, ...settings.memories].slice(0, 200));
    return `Remembered: ${fact}`;
  },
};

const forgetTool: Tool = {
  name: "memory.forget",
  source: "builtin",
  description: "Forget remembered facts that contain the given words, when the user asks you to forget something.",
  parameters: schema({ about: str("Words that identify the memory to remove.") }, ["about"]),
  async run(input) {
    const about = String(input.about ?? "").toLowerCase().trim();
    const settings = getSettings();
    const keep = settings.memories.filter((m) => !m.text.toLowerCase().includes(about));
    const removed = settings.memories.length - keep.length;
    persist(keep);
    return removed ? `Forgot ${removed} ${removed === 1 ? "memory" : "memories"}.` : "Nothing matched.";
  },
};

export function registerMemoryTools(): void {
  register(saveTool, forgetTool);
}

/** The block added to the system prompt. */
export function memoryPrompt(): string {
  const memories = getSettings().memories ?? [];
  if (!memories.length) return "";
  return [
    "",
    "WHAT YOU KNOW ABOUT THE USER",
    "Facts they asked you to remember. Use them when relevant; do not recite them.",
    ...memories.slice(0, 60).map((m) => `- ${m.text}`),
  ].join("\n");
}
