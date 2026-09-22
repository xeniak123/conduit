import { invoke } from "@tauri-apps/api/core";
import { getSettings, saveSettings, type ApiToken, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { keyKnown } from "@/core/secrets";
import { useApp } from "@/core/store";
import { PROVIDER_CATALOG } from "@/llm";
import { useRuntime } from "@/models/runtime";

/**
 * Conduit's API, as the interface sees it.
 *
 * The server itself is native; this decides what it offers. Every model that
 * works in Conduit's own chat is offered under `provider/model`, so a client
 * pointed here gets the same list the model picker shows.
 */

export interface Route {
  id: string;
  base_url: string;
  upstream: string;
  account: string | null;
}

const NATIVE_COMPAT: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export function routes(settings: Settings = getSettings()): Route[] {
  const out: Route[] = [];
  const loaded = useRuntime.getState().loaded;
  if (loaded) {
    out.push({
      id: `local/${slug(loaded.name)}`,
      base_url: `http://127.0.0.1:${loaded.port}/v1`,
      upstream: loaded.name,
      account: null,
    });
  }

  const custom = new Set(settings.customProviders.map((p) => p.id));
  for (const provider of settings.customProviders) {
    if (provider.id === "local") continue;
    for (const model of provider.models) {
      out.push({
        id: `${provider.id}/${model}`,
        base_url: provider.baseUrl,
        upstream: model,
        account: provider.needsKey ? provider.id : null,
      });
    }
  }

  for (const entry of PROVIDER_CATALOG) {
    const base = NATIVE_COMPAT[entry.id];
    if (!base || custom.has(entry.id) || !keyKnown(entry.id)) continue;
    const models = settings.providerModels[entry.id]?.length ? settings.providerModels[entry.id] : entry.models;
    for (const model of models) {
      out.push({ id: `${entry.id}/${model}`, base_url: base, upstream: model, account: entry.id });
    }
  }
  return out;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");

export async function startApi(): Promise<number | null> {
  if (!isTauri()) return null;
  const { api } = getSettings();
  const now = Date.now();
  return invoke<number>("api_start", {
    config: {
      port: api.port,
      lan: api.lan,
      keyless_local: api.keylessLocal,
      token_hashes: api.tokens.filter((t) => !t.expires || t.expires > now).map((t) => t.hash),
      routes: routes(),
    },
  });
}

export async function stopApi(): Promise<void> {
  if (!isTauri()) return;
  await invoke("api_stop");
}

export async function apiPort(): Promise<number | null> {
  if (!isTauri()) return null;
  return invoke<number | null>("api_port");
}

/** Restarts the server whenever what it offers changes. */
export function keepApiInSync(): () => void {
  let signature = "";
  const check = () => {
    const settings = getSettings();
    if (!settings.api.enabled) {
      if (signature) {
        signature = "";
        void stopApi();
      }
      return;
    }
    const next = JSON.stringify([settings.api, routes(settings)]);
    if (next === signature) return;
    signature = next;
    void startApi().catch((e) => console.error("[conduit] API", e));
  };
  const offApp = useApp.subscribe(check);
  const offRuntime = useRuntime.subscribe(check);
  check();
  return () => {
    offApp();
    offRuntime();
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a token and returns its plaintext, which is never stored. */
export async function createToken(name: string, days: number | null): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = `cnd_${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40)}`;
  const record: ApiToken = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    hash: await sha256(token),
    prefix: token.slice(0, 9),
    created: Date.now(),
    expires: days ? Date.now() + days * 86_400_000 : null,
  };
  const settings = getSettings();
  const next = { ...settings, api: { ...settings.api, tokens: [record, ...settings.api.tokens] } };
  useApp.getState().setSettings(next);
  await saveSettings(next);
  return token;
}

export async function revokeToken(id: string): Promise<void> {
  const settings = getSettings();
  const next = { ...settings, api: { ...settings.api, tokens: settings.api.tokens.filter((t) => t.id !== id) } };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}
