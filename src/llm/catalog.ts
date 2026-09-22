import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { keyKnown } from "@/core/secrets";
import { PROVIDER_CATALOG } from "./index";
import { presetFor } from "./presets";

/**
 * Every model a key can reach, asked of the provider itself.
 *
 * A hard-coded list of three OpenRouter models is a lie of omission when the
 * key behind it opens several hundred. So once a key is saved, Conduit asks
 * the provider's own `/models` and offers all of it, cached for an hour so the
 * picker opens instantly.
 */

export interface ModelInfo {
  id: string;
  /** Display name when the provider gives one. */
  name?: string;
  context?: number;
  /** Costs nothing per token (OpenRouter marks these). */
  free?: boolean;
}

export interface Listing {
  models: ModelInfo[];
  at: number;
  error?: string;
}

const TTL = 60 * 60 * 1000;
const CACHE_KEY = "conduit.models.v1";

interface Source {
  url: string;
  auth: { account: string; header: string; template: string } | null;
  headers: Record<string, string>;
}

/** Where a provider lists its models, and how the key goes along. */
export function sourceFor(id: string, settings: Settings): Source | null {
  const preset = presetFor(id);
  const custom = settings.customProviders.find((p) => p.id === id);
  const builtin = PROVIDER_CATALOG.find((p) => p.id === id);
  const needsKey = custom ? custom.needsKey : (builtin?.needsKey ?? preset?.needsKey ?? false);

  let url: string | undefined;
  if (id === "anthropic") url = "https://api.anthropic.com/v1/models?limit=1000";
  else if (preset?.modelsUrl) url = preset.modelsUrl;
  else {
    const base = custom?.baseUrl || settings.endpoints?.[id] || preset?.baseUrl;
    if (base) url = `${base.replace(/\/$/, "")}/models`;
  }
  if (!url) return null;

  const auth = needsKey
    ? {
        account: id,
        header: preset?.auth?.header ?? "authorization",
        template: preset?.auth?.template ?? "Bearer {key}",
      }
    : null;
  return { url, auth, headers: preset?.auth?.extra ?? {} };
}

/** Parses the three list shapes in the wild: OpenAI's, Anthropic's and Gemini's. */
export function parseModels(body: string): ModelInfo[] {
  const parsed = JSON.parse(body) as {
    data?: Array<Record<string, unknown>>;
    models?: Array<Record<string, unknown>>;
  };
  const rows = parsed.data ?? parsed.models ?? [];
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const row of rows) {
    const raw = (row.id ?? row.name ?? "") as string;
    const id = String(raw).replace(/^models\//, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pricing = row.pricing as { prompt?: string; completion?: string } | undefined;
    const name = (row.display_name ?? (row.id ? row.name : undefined)) as string | undefined;
    out.push({
      id,
      name: name && name !== id ? name : undefined,
      context: (row.context_length ?? row.context_window ?? row.inputTokenLimit) as number | undefined,
      free: pricing ? Number(pricing.prompt) === 0 && Number(pricing.completion) === 0 : undefined,
    });
  }
  // Embedding, speech and image models cannot hold a conversation.
  return out
    .filter((m) => !/embed|whisper|tts|dall-e|moderation|audio|transcribe|image-gen|imagen/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadCache(): Record<string, Listing> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Listing>;
  } catch {
    return {};
  }
}

function saveCache(lists: Record<string, Listing>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(lists));
  } catch {
    /* a full or blocked store only costs a refetch next time */
  }
}

interface CatalogState {
  lists: Record<string, Listing>;
  loading: Record<string, boolean>;
  refresh: (id: string, settings: Settings, force?: boolean) => Promise<void>;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  lists: loadCache(),
  loading: {},
  async refresh(id, settings, force = false) {
    if (!isTauri()) return;
    const current = get().lists[id];
    if (!force && current && !current.error && Date.now() - current.at < TTL) return;
    if (get().loading[id]) return;
    const source = sourceFor(id, settings);
    if (!source) return;
    if (source.auth && !keyKnown(id)) return;

    set((s) => ({ loading: { ...s.loading, [id]: true } }));
    let listing: Listing;
    try {
      const res = await invoke<{ status: number; body: string }>("proxy_send", {
        request: { url: source.url, method: "GET", headers: source.headers, body: null, auth: source.auth },
      });
      if (res.status === 401 || res.status === 403) throw new Error("The key was refused.");
      if (res.status !== 200) throw new Error(`Answered ${res.status}.`);
      listing = { models: parseModels(res.body), at: Date.now() };
    } catch (e) {
      listing = { models: current?.models ?? [], at: Date.now(), error: e instanceof Error ? e.message : String(e) };
    }
    set((s) => {
      const lists = { ...s.lists, [id]: listing };
      saveCache(lists);
      return { lists, loading: { ...s.loading, [id]: false } };
    });
  },
}));

/** Every provider that could answer right now: a key is saved, or none is needed. */
export function readyProviders(settings: Settings): Array<{ id: string; label: string; local: boolean }> {
  const out: Array<{ id: string; label: string; local: boolean }> = [];
  const overridden = new Set(settings.customProviders.map((p) => p.id));
  for (const p of PROVIDER_CATALOG) {
    if (overridden.has(p.id)) continue;
    // Ollama is only listed once something is actually listening there.
    if (!p.needsKey) continue;
    if (keyKnown(p.id)) out.push({ id: p.id, label: p.label, local: false });
  }
  for (const p of settings.customProviders) {
    if (!p.needsKey || keyKnown(p.id)) out.push({ id: p.id, label: p.label, local: !p.needsKey });
  }
  return out;
}
