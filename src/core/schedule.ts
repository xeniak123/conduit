import { getSettings, saveSettings, type Settings } from "./config";
import { sendMessage } from "./chat";
import { useApp, type Conversation } from "./store";

/**
 * Tasks that run on their own.
 *
 * A check every half minute against each task's next due time. A run opens a
 * fresh chat, so its result sits in the sidebar like any other conversation,
 * and a notification says it is there. Nobody is at the keyboard, so nothing
 * that needs approval happens: those steps are declined and listed in the
 * reply for the person to do by hand.
 *
 * Tasks only run while Conduit is running (it lives in the tray). A run that
 * was due while the computer was off happens once at the next start, rather
 * than being silently skipped or repeated for every missed slot.
 */

export type Cadence =
  | { kind: "hourly"; every: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "manual" };

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  enabled: boolean;
  /** Null means whatever model chat is using at the time. */
  model: { provider: string; model: string } | null;
  search: boolean;
  projectId: string | null;
  created: number;
  lastRun: number | null;
  lastConversationId: string | null;
  lastStatus?: "ok" | "failed";
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function at(base: Date, time: string): Date {
  const [h, m] = time.split(":").map((n) => Number(n) || 0);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** The first time at or after `from` that the task should run. */
export function nextAfter(cadence: Cadence, from: Date): Date | null {
  switch (cadence.kind) {
    case "manual":
      return null;
    case "hourly": {
      const step = Math.max(1, cadence.every) * 3_600_000;
      return new Date(Math.ceil(from.getTime() / step) * step);
    }
    case "daily":
    case "weekdays":
    case "weekly": {
      for (let i = 0; i < 8; i++) {
        const day = new Date(from);
        day.setDate(from.getDate() + i);
        const when = at(day, cadence.time);
        if (when < from) continue;
        const dow = when.getDay();
        if (cadence.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
        if (cadence.kind === "weekly" && dow !== cadence.day) continue;
        return when;
      }
      return null;
    }
  }
}

/** When it runs next, counting from its last run (or its creation). */
export function nextRun(task: ScheduledTask): Date | null {
  if (!task.enabled) return null;
  return nextAfter(task.cadence, new Date((task.lastRun ?? task.created) + 1000));
}

export function describe(cadence: Cadence): string {
  switch (cadence.kind) {
    case "manual":
      return "When you run it";
    case "hourly":
      return cadence.every === 1 ? "Every hour" : `Every ${cadence.every} hours`;
    case "daily":
      return `Every day at ${cadence.time}`;
    case "weekdays":
      return `Weekdays at ${cadence.time}`;
    case "weekly":
      return `Every ${DAY[cadence.day]} at ${cadence.time}`;
  }
}

export function relative(date: Date | null): string {
  if (!date) return "Not scheduled";
  const mins = Math.round((date.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "Due now";
  if (mins < 60) return `In ${mins} min`;
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

function patchTask(id: string, patch: Partial<ScheduledTask>) {
  const { settings, setSettings } = useApp.getState();
  const next: Settings = {
    ...settings,
    schedules: settings.schedules.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  setSettings(next);
  void saveSettings(next);
}

const running = new Set<string>();

export function isRunning(id: string): boolean {
  return running.has(id);
}

/** Runs one task now, in a new chat, without switching the window to it. */
export async function runTask(task: ScheduledTask): Promise<void> {
  if (running.has(task.id)) return;
  running.add(task.id);
  useApp.setState((s) => ({ scheduleTick: s.scheduleTick + 1 }));

  const convo: Conversation = {
    id: crypto.randomUUID(),
    title: task.name,
    at: Date.now(),
    messages: [],
    projectId: task.projectId ?? undefined,
    scheduleId: task.id,
  };
  useApp.setState((s) => ({ conversations: [convo, ...s.conversations] }));
  patchTask(task.id, { lastRun: Date.now(), lastConversationId: convo.id });

  const base = getSettings();
  const settings: Settings = {
    ...base,
    command: task.model ?? base.command,
    webSearch: task.search,
    // Nobody is watching, so the pointer is never handed over.
    computerUse: { ...base.computerUse, enabled: false },
    activeProjectId: task.projectId,
  };

  let ok = true;
  try {
    await sendMessage(task.prompt, { conversationId: convo.id, settings, unattended: true });
  } catch {
    ok = false;
  } finally {
    // The first message would otherwise have renamed the chat after the prompt.
    useApp.setState((s) => ({
      conversations: s.conversations.map((c) => (c.id === convo.id ? { ...c, title: task.name } : c)),
    }));
    patchTask(task.id, { lastStatus: ok ? "ok" : "failed" });
    running.delete(task.id);
    useApp.setState((s) => ({ scheduleTick: s.scheduleTick + 1 }));
  }
}

/** Starts the clock. Returns a function that stops it. */
export function startScheduler(): () => void {
  const tick = () => {
    const now = Date.now();
    for (const task of useApp.getState().settings.schedules ?? []) {
      const due = nextRun(task);
      if (due && due.getTime() <= now && !running.has(task.id)) void runTask(task);
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, 30_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Starting points, shown when there are no tasks yet. */
export const TEMPLATES: Array<Omit<ScheduledTask, "id" | "created" | "lastRun" | "lastConversationId" | "enabled" | "model" | "projectId"> & { blurb: string; icon: string }> = [
  {
    name: "Morning briefing",
    blurb: "The news that matters to you, in five bullet points.",
    icon: "sun",
    prompt:
      "Search the web for the most important news from the last 24 hours about AI, technology and anything I usually ask about. Give me five short bullet points with a link each, most important first.",
    cadence: { kind: "weekdays", time: "08:00" },
    search: true,
  },
  {
    name: "New models to try",
    blurb: "Trending open models that would run on this computer.",
    icon: "grid",
    prompt:
      "Search Hugging Face and the web for open-weight language models released or trending in the last week. List up to five with their size, what they are good at, and whether a quantized GGUF exists.",
    cadence: { kind: "weekly", day: 1, time: "09:00" },
    search: true,
  },
  {
    name: "Monitor a topic",
    blurb: "Tells you when something new appears about a subject.",
    icon: "eye",
    prompt:
      "Search the web for anything new in the last 24 hours about: <your topic>. If nothing meaningful is new, answer with one line saying so.",
    cadence: { kind: "daily", time: "12:00" },
    search: true,
  },
  {
    name: "Project health check",
    blurb: "Runs the tests in a project and reports what broke.",
    icon: "code",
    prompt:
      "In the active project, check git status, run the test command and summarise the result. If anything fails, explain the likely cause in two sentences. Do not change any files.",
    cadence: { kind: "weekdays", time: "18:00" },
    search: false,
  },
  {
    name: "Weekly review",
    blurb: "A Friday summary of what you worked on.",
    icon: "list",
    prompt:
      "Look at the files changed in the active project over the last seven days (git log) and write a short weekly review: what got done, what is half-finished, and what to do first on Monday.",
    cadence: { kind: "weekly", day: 5, time: "16:00" },
    search: false,
  },
  {
    name: "Content ideas",
    blurb: "A few post ideas each week from this week’s news.",
    icon: "spark",
    prompt:
      "Search the web for this week's most discussed stories in my field and draft five post ideas, each with a one-line hook.",
    cadence: { kind: "weekly", day: 1, time: "10:00" },
    search: true,
  },
];
