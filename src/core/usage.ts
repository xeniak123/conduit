/**
 * What each message actually cost.
 *
 * Almost nothing in this category shows you this, and the result is that people
 * discover their spend on an invoice a month later. Conduit prices every call
 * as it happens, keeps a rolling daily total, and can warn before a runaway
 * agent loop turns into a bill — which matters most precisely when the agent is
 * working autonomously on screen, taking a model call per step.
 *
 * Prices are USD per million tokens and are inevitably a snapshot; they are
 * declared here, in one table, so correcting them is a one-line change rather
 * than an archaeology exercise.
 */

export interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  // Anthropic
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

/** Anything self-hosted costs nothing per token; only electricity. */
const FREE = ["ollama", "llama", "qwen", "mistral", "local"];

export function priceFor(model: string): Price | null {
  if (FREE.some((f) => model.toLowerCase().includes(f))) return { input: 0, output: 0 };

  const exact = PRICES[model];
  if (exact) return exact;

  // OpenRouter prefixes the vendor: "anthropic/claude-opus-5".
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return PRICES[bare] ?? null;
}

export function costOf(model: string, input: number, output: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  return (input * price.input + output * price.output) / 1_000_000;
}

export interface UsageEntry {
  at: number;
  model: string;
  input: number;
  output: number;
  /** Null when the model is not in the price table — shown as "unpriced". */
  cost: number | null;
}

const KEY = "conduit.usage";
const RETAIN_DAYS = 60;

export function record(entry: UsageEntry): void {
  const all = [...read(), entry];
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  write(all.filter((e) => e.at >= cutoff));
}

export function read(): UsageEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UsageEntry[]) : [];
  } catch {
    // A corrupt or unavailable store must not take the app down over
    // bookkeeping; the worst case is that a chart starts empty.
    return [];
  }
}

function write(entries: UsageEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* over quota or blocked; nothing here is worth failing a message for */
  }
}

export interface UsageSummary {
  today: { cost: number; tokens: number; calls: number; unpriced: number };
  month: { cost: number; tokens: number; calls: number };
  byModel: Array<{ model: string; cost: number; calls: number }>;
  /** Last 14 days, oldest first, for the sparkline. */
  daily: Array<{ day: string; cost: number }>;
}

export function summarise(entries = read()): UsageSummary {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const monthStart = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1).getTime();

  const today = { cost: 0, tokens: 0, calls: 0, unpriced: 0 };
  const month = { cost: 0, tokens: 0, calls: 0 };
  const models = new Map<string, { cost: number; calls: number }>();
  const days = new Map<string, number>();

  for (const e of entries) {
    const tokens = e.input + e.output;

    if (e.at >= dayStart) {
      today.calls++;
      today.tokens += tokens;
      if (e.cost === null) today.unpriced++;
      else today.cost += e.cost;
    }

    if (e.at >= monthStart) {
      month.calls++;
      month.tokens += tokens;
      month.cost += e.cost ?? 0;
    }

    const m = models.get(e.model) ?? { cost: 0, calls: 0 };
    m.cost += e.cost ?? 0;
    m.calls++;
    models.set(e.model, m);

    const day = new Date(e.at).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + (e.cost ?? 0));
  }

  const daily: Array<{ day: string; cost: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(dayStart - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({ day: d, cost: days.get(d) ?? 0 });
  }

  return {
    today,
    month,
    byModel: [...models.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    daily,
  };
}

export function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
