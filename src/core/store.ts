import { create } from "zustand";
import type { AgentStep } from "./agent";
import { DEFAULT_SETTINGS, type Settings } from "./config";

/** The main window's pages. Chat is one of them, not the whole app. */
export type Page = "chat" | "models" | "store" | "projects" | "companion" | "api" | "scheduled" | "agents";

export type HudPhase = "idle" | "listening" | "thinking" | "working" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Tool activity, rendered as a collapsible card under the reply. */
  steps: AgentStep[];
  /** Last screenshot the agent looked at, base64 PNG. */
  screenshot?: string;
  /** Images attached by the user, base64. */
  images?: string[];
  /** Still being written. */
  pending?: boolean;
  /** Text is arriving in fragments right now. */
  streaming?: boolean;
  /** Arrived by voice rather than typing. */
  spoken?: boolean;
  /** What this exchange cost, in USD, and how many tokens it moved. */
  cost?: number;
  tokens?: number;
}

export interface Conversation {
  id: string;
  title: string;
  at: number;
  messages: ChatMessage[];
  /** The project this chat belongs to, if any. */
  projectId?: string;
  /** Set when a scheduled task produced this chat. */
  scheduleId?: string;
}

export interface PendingApproval {
  summary: string;
  detail?: string;
  resolve: (approved: boolean) => void;
}

interface AppState {
  page: Page;
  setPage: (page: Page) => void;
  /** Which Model hub tab to open next, for links like "add a provider". */
  hubTab: "discover" | "device" | "cloud" | null;
  /** Bumped whenever a scheduled run starts or ends, so the page re-renders. */
  scheduleTick: number;
  openHub: (tab: "discover" | "device" | "cloud") => void;
  /** Which settings section to open on, so a page can deep-link into it. */
  settingsSection: string | null;
  openSettingsAt: (section: string) => void;

  settings: Settings;
  setSettings: (settings: Settings) => void;

  conversations: Conversation[];
  activeId: string | null;
  newConversation: (projectId?: string) => string;
  /** Selects the newest chat, creating one only if there are none. */
  ensureConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  patchMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  appendStep: (conversationId: string, messageId: string, step: AgentStep) => void;

  /** True while the agent is driving the pointer, so the UI can say so loudly. */
  screenActive: boolean;
  setScreenActive: (active: boolean) => void;
  /** Set when the user hits Stop; the running loop checks it between actions. */
  abort: AbortController | null;
  setAbort: (controller: AbortController | null) => void;

  phase: HudPhase;
  caption: string;
  steps: AgentStep[];
  level: number;

  approval: PendingApproval | null;
  settingsOpen: boolean;
  onboarding: boolean;

  setPhase: (phase: HudPhase, caption?: string) => void;
  setCaption: (caption: string) => void;
  setLevel: (level: number) => void;
  pushStep: (step: AgentStep) => void;
  clearSteps: () => void;
  requestApproval: (summary: string, detail?: string) => Promise<boolean>;
  resolveApproval: (approved: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setOnboarding: (open: boolean) => void;
  /** Replaces the whole list after loading from disk. */
  hydrate: (conversations: Conversation[]) => void;
}

const emptyConversation = (projectId?: string): Conversation => ({
  id: crypto.randomUUID(),
  title: "New chat",
  at: Date.now(),
  messages: [],
  projectId,
});

export const useApp = create<AppState>((set, get) => ({
  page: "chat",
  setPage: (page) => set({ page }),
  hubTab: null,
  scheduleTick: 0,
  openHub: (hubTab) => set({ hubTab, page: "models", settingsOpen: false }),
  settingsSection: null,
  openSettingsAt: (section) => set({ settingsSection: section, settingsOpen: true }),

  settings: DEFAULT_SETTINGS,
  setSettings: (settings) => set({ settings }),

  conversations: [],
  activeId: null,

  ensureConversation: () => {
    const existing = get().conversations[0];
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    return get().newConversation();
  },

  newConversation: (projectId) => {
    const convo = emptyConversation(projectId);
    set((s) => ({ conversations: [convo, ...s.conversations], activeId: convo.id, page: "chat" }));
    return convo.id;
  },

  selectConversation: (id) => set({ activeId: id, page: "chat" }),

  deleteConversation: (id) =>
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      return {
        conversations,
        activeId: s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId,
      };
    }),

  addMessage: (conversationId, message) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              messages: [...c.messages, message],
              at: Date.now(),
              // The first thing said becomes the title — no separate
              // naming step, and it is what people actually scan for.
              title:
                c.messages.length === 0 && message.role === "user"
                  ? message.text.slice(0, 48) || "New chat"
                  : c.title,
            },
      ),
    })),

  patchMessage: (conversationId, messageId, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
            },
      ),
    })),

  appendStep: (conversationId, messageId, step) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, steps: [...m.steps, step] } : m,
              ),
            },
      ),
    })),

  screenActive: false,
  setScreenActive: (screenActive) => set({ screenActive }),
  abort: null,
  setAbort: (abort) => set({ abort }),

  phase: "idle",
  caption: "",
  steps: [],
  level: 0,
  approval: null,
  settingsOpen: false,
  onboarding: false,

  setPhase: (phase, caption) => set((s) => ({ phase, caption: caption ?? s.caption })),
  setCaption: (caption) => set({ caption }),
  setLevel: (level) => set({ level }),
  pushStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  clearSteps: () => set({ steps: [] }),

  /**
   * Bridges a click-driven dialog into the promise a tool is awaiting. A
   * declined action resolves false rather than throwing, so the model can
   * respond to the refusal instead of the run collapsing.
   */
  requestApproval: (summary, detail) =>
    new Promise<boolean>((resolve) => set({ approval: { summary, detail, resolve } })),

  resolveApproval: (approved) => {
    get().approval?.resolve(approved);
    set({ approval: null });
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setOnboarding: (onboarding) => set({ onboarding }),
  hydrate: (conversations) =>
    set({ conversations, activeId: conversations[0]?.id ?? null }),
}));

export function activeConversation(state: AppState): Conversation | null {
  return state.conversations.find((c) => c.id === state.activeId) ?? null;
}
