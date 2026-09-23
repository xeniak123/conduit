import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/core/host";
import { hfAuth } from "@/models/hub";
import { chunkText } from "./sources";

/**
 * Datasets: the other half of running your own models.
 *
 * A model hub without a dataset browser is only half the job — the moment
 * someone wants to fine-tune, they need training data, and the two places it
 * comes from are Hugging Face and their own disk. This module reads both, and
 * turns whatever shape the rows arrive in into the one shape a trainer wants:
 * a JSONL file of chat turns.
 *
 * Only the public endpoints are used, and only for reading. The Hugging Face
 * token rides along on huggingface.co itself (attached natively, never read
 * here) so private and gated datasets are listed too; the rows service is
 * called without it.
 */

const API = "https://huggingface.co/api";
const ROWS = "https://datasets-server.huggingface.co";

export interface HubDataset {
  id: string;
  author: string;
  name: string;
  likes: number;
  downloads: number;
  updated: string | null;
  tags: string[];
}

export interface DatasetRows {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number | null;
}

/** A guess at which columns hold the conversation, so the mapping starts right. */
export interface ColumnMapping {
  /** Column holding the user's turn, or a whole conversation array. */
  prompt: string;
  /** Column holding the model's turn. Empty when `prompt` is a conversation. */
  response: string;
  /** Column holding a system instruction, if the dataset has one. */
  system?: string;
  /**
   * Extra material for the question, as in Alpaca's `input` column: "Summarise
   * this" in one column, the text to summarise in the next. Appended to the
   * question when a row has it, so those examples are not trained without
   * the very thing they are about.
   */
  context?: string;
}

export async function getJson<T>(url: string, auth = false): Promise<T> {
  if (!isTauri()) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status}.`);
    return (await res.json()) as T;
  }
  const response = await invoke<{ status: number; body: string }>("proxy_send", {
    request: {
      url,
      method: "GET",
      headers: { accept: "application/json" },
      body: null,
      auth: auth ? hfAuth() : null,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("That dataset is gated. Accept its terms on huggingface.co with the same account.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Hugging Face answered ${response.status}.`);
  }
  return JSON.parse(response.body) as T;
}

interface RawDataset {
  id: string;
  likes?: number;
  downloads?: number;
  lastModified?: string;
  tags?: string[];
}

export function toDataset(raw: RawDataset): HubDataset {
  const [author, ...rest] = raw.id.split("/");
  return {
    id: raw.id,
    author: rest.length ? author : "huggingface",
    name: rest.join("/") || raw.id,
    likes: raw.likes ?? 0,
    downloads: raw.downloads ?? 0,
    updated: raw.lastModified ?? null,
    tags: raw.tags ?? [],
  };
}

/** Shelves that answer "what would I actually train on?" rather than "what exists?". */
export const DATASET_SHELVES: Array<{ id: string; label: string; query: string }> = [
  { id: "chat", label: "Chat & instructions", query: "instruct" },
  { id: "reasoning", label: "Reasoning", query: "reasoning" },
  { id: "code", label: "Code", query: "code" },
  { id: "function", label: "Tool use", query: "function calling" },
  { id: "preference", label: "Preference (DPO)", query: "dpo" },
  { id: "small", label: "Small & clean", query: "alpaca" },
];

export async function searchDatasets(query: string): Promise<HubDataset[]> {
  const params = new URLSearchParams({ sort: "downloads", direction: "-1", limit: "40" });
  if (query.trim()) params.set("search", query.trim());
  const raw = await getJson<RawDataset[]>(`${API}/datasets?${params}`, true);
  return raw.map(toDataset);
}

/** The dataset's configurations and splits — needed before any rows can be read. */
export async function datasetSplits(id: string): Promise<Array<{ config: string; split: string }>> {
  const body = await getJson<{ splits?: Array<{ config: string; split: string }> }>(
    `${ROWS}/splits?dataset=${encodeURIComponent(id)}`,
  );
  return body.splits ?? [];
}

export async function datasetRows(
  id: string,
  config: string,
  split: string,
  length = 20,
  offset = 0,
): Promise<DatasetRows> {
  const params = new URLSearchParams({ dataset: id, config, split, offset: String(offset), length: String(length) });
  const body = await getJson<{
    features?: Array<{ name: string }>;
    rows?: Array<{ row: Record<string, unknown> }>;
    num_rows_total?: number;
  }>(`${ROWS}/rows?${params}`);
  return {
    columns: (body.features ?? []).map((f) => f.name),
    rows: (body.rows ?? []).map((r) => r.row),
    total: body.num_rows_total ?? null,
  };
}

/**
 * Up to `count` rows, a page at a time.
 *
 * The rows service hands out at most a hundred per request, which is also a
 * polite size; a progress callback keeps a two-thousand-row pull from looking
 * like a hang.
 */
export async function collectRows(
  id: string,
  config: string,
  split: string,
  count: number,
  onProgress?: (have: number) => void,
  signal?: AbortSignal,
): Promise<DatasetRows> {
  const rows: Array<Record<string, unknown>> = [];
  let columns: string[] = [];
  let total: number | null = null;
  while (rows.length < count) {
    if (signal?.aborted) break;
    const page = await datasetRows(id, config, split, Math.min(100, count - rows.length), rows.length);
    if (!columns.length) columns = page.columns;
    total = page.total;
    rows.push(...page.rows);
    onProgress?.(rows.length);
    if (page.rows.length === 0 || (total !== null && rows.length >= total)) break;
  }
  return { columns, rows, total };
}

/** Column names the training formats actually use, in the order they are usually right. */
const PROMPT_NAMES = ["messages", "conversations", "conversation", "instruction", "prompt", "question", "input"];
const RESPONSE_NAMES = ["output", "response", "completion", "answer", "chosen", "text"];
const SYSTEM_NAMES = ["system", "system_prompt"];

/**
 * A first guess at the mapping.
 *
 * Almost every instruction dataset uses one of a dozen column names, so this is
 * right most of the time — and when it is wrong the user changes it in two
 * clicks, which is far better than making them read the schema first.
 */
export function guessMapping(columns: string[]): ColumnMapping {
  const find = (names: string[]) => names.find((n) => columns.includes(n)) ?? "";
  const prompt = find(PROMPT_NAMES);
  // A conversation column carries both sides already; pairing it with a
  // response column would duplicate the answer.
  const conversation = ["messages", "conversations", "conversation"].includes(prompt);
  const chosenPrompt = prompt || columns[0] || "";
  return {
    prompt: chosenPrompt,
    response: conversation ? "" : find(RESPONSE_NAMES) || columns[1] || "",
    system: find(SYSTEM_NAMES) || undefined,
    context: chosenPrompt === "instruction" && columns.includes("input") ? "input" : undefined,
  };
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** Roles as the common datasets spell them. */
function normaliseRole(role: unknown): ChatTurn["role"] {
  const name = String(role ?? "").toLowerCase();
  if (name === "system") return "system";
  if (name === "assistant" || name === "gpt" || name === "model" || name === "bot") return "assistant";
  return "user";
}

/**
 * One dataset row as chat turns.
 *
 * Returns an empty array for a row that cannot be read that way, so a single
 * malformed record does not take the whole conversion down with it.
 */
export function rowToChat(row: Record<string, unknown>, mapping: ColumnMapping): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const system = mapping.system ? asText(row[mapping.system]).trim() : "";
  if (system) turns.push({ role: "system", content: system });

  const prompt = row[mapping.prompt];
  if (Array.isArray(prompt)) {
    for (const entry of prompt) {
      const item = entry as Record<string, unknown>;
      const content = asText(item.content ?? item.value ?? item.text).trim();
      if (content) turns.push({ role: normaliseRole(item.role ?? item.from), content });
    }
    return turns.some((t) => t.role === "assistant") ? turns : [];
  }

  const extra = mapping.context ? asText(row[mapping.context]).trim() : "";
  const question = asText(prompt).trim();
  const user = extra ? `${question}\n\n${extra}` : question;
  const assistant = mapping.response ? asText(row[mapping.response]).trim() : "";
  if (!user || !assistant) return [];
  turns.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  return turns;
}

/** The file a trainer reads: one JSON object per line, `{"messages": [...]}`. */
export function toChatJsonl(rows: Array<Record<string, unknown>>, mapping: ColumnMapping): string {
  return rows
    .map((row) => rowToChat(row, mapping))
    .filter((turns) => turns.length >= 2)
    .map((messages) => JSON.stringify({ messages }))
    .join("\n");
}

/**
 * A local file as rows.
 *
 * JSONL, JSON arrays and CSV cover what people actually have lying about. CSV
 * is parsed properly enough to survive quoted commas, because the alternative
 * is a dataset that silently loses every row containing a comma.
 */
export function parseLocalDataset(text: string, filename: string): DatasetRows {
  const name = filename.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return parseSeparated(text, name.endsWith(".tsv") ? "\t" : ",");
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    const rows = chunkText(text).map((chunk) => ({ text: chunk }));
    return { columns: ["text"], rows, total: rows.length };
  }

  const trimmed = text.trim();
  const rows: Array<Record<string, unknown>> = [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown[];
    for (const item of parsed) if (item && typeof item === "object") rows.push(item as Record<string, unknown>);
  } else {
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as unknown;
        if (item && typeof item === "object") rows.push(item as Record<string, unknown>);
      } catch {
        // A bad line is skipped rather than fatal: exports are often ragged.
      }
    }
  }
  return { columns: [...new Set(rows.flatMap((r) => Object.keys(r)))], rows, total: rows.length };
}

function parseSeparated(text: string, sep: string): DatasetRows {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === sep) {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }

  const [header = [], ...body] = records;
  const rows = body
    .filter((r) => r.some((cell) => cell.trim()))
    .map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ""])));
  return { columns: header, rows, total: rows.length };
}

/** The parts of a saved conversation a training file needs. */
export interface ConversationLike {
  title: string;
  messages: Array<{ role: "user" | "assistant"; text: string; pending?: boolean }>;
}

/**
 * Your own chats as training data.
 *
 * The most useful dataset most people have is the one they already wrote: the
 * questions they actually ask, answered the way they kept. Each conversation
 * becomes one example, cut to the turns that have both a question and a
 * finished answer, so a reply that was stopped half-way never teaches the
 * model to stop half-way.
 */
export function conversationsToJsonl(conversations: ConversationLike[], system = ""): { jsonl: string; count: number } {
  const lines: string[] = [];
  for (const conversation of conversations) {
    const turns: ChatTurn[] = system.trim() ? [{ role: "system", content: system.trim() }] : [];
    for (const message of conversation.messages) {
      const content = message.text.trim();
      if (!content || message.pending) continue;
      // Two user turns in a row (a retry, an edit) keep only the later one.
      const last = turns[turns.length - 1];
      if (last && last.role === message.role) {
        last.content = content;
        continue;
      }
      turns.push({ role: message.role, content });
    }
    // Ends on the model's answer, and has at least one exchange.
    while (turns.length && turns[turns.length - 1].role !== "assistant") turns.pop();
    if (turns.some((t) => t.role === "user") && turns.some((t) => t.role === "assistant")) {
      lines.push(JSON.stringify({ messages: turns }));
    }
  }
  return { jsonl: lines.join("\n"), count: lines.length };
}

/** A file name from a dataset or model id: "tatsu-lab/alpaca" → "tatsu-lab-alpaca". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dataset"
  );
}
