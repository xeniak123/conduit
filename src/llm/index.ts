import type { ProviderId, Settings } from "@/core/config";
import { keyKnown } from "@/core/secrets";
import { createAnthropic } from "./anthropic";
import { createGoogle } from "./google";
import { createOpenAICompatible } from "./openai-compatible";
import { AUTH } from "./transport";
import { ProviderError, type Provider } from "./types";

export * from "./types";

const OPENAI_COMPATIBLE: Record<
  string,
  {
    label: string;
    baseUrl: string;
    models: readonly string[];
    headers?: Record<string, string>;
  }
> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini"],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-opus-5", "openai/gpt-5", "google/gemini-2.5-pro"],
    headers: { "http-referer": "https://github.com/xeniak123/conduit", "x-title": "Conduit" },
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.3", "qwen2.5-coder"],
  },
};

/**
 * A missing key is the most common first-run failure by a wide margin, so it
 * gets its own type and its own sentence rather than surfacing as whatever
 * 401 body the provider happened to return.
 */
export class MissingKeyError extends Error {
  constructor(readonly provider: string) {
    super(`No API key saved for ${provider}. Open Settings → Models to add one.`);
    this.name = "MissingKeyError";
  }
}

/**
 * Built per request rather than cached, so a key or base URL changed in
 * Settings takes effect on the very next message instead of after a restart.
 */
export function getProvider(id: ProviderId, settings: Settings): Provider {
  // A user-added endpoint takes precedence: if somebody has configured one
  // under a name, that is the one they mean.
  const custom = settings.customProviders?.find((p) => p.id === id);
  if (custom) {
    if (custom.needsKey && !keyKnown(custom.id)) throw new MissingKeyError(custom.label);
    return createOpenAICompatible({
      id: custom.id,
      label: custom.label,
      auth: custom.needsKey
        ? { account: custom.id, header: "authorization", template: "Bearer {key}" }
        : null,
      baseUrl: custom.baseUrl,
      suggestedModels: custom.models,
    });
  }

  const entry = PROVIDER_CATALOG.find((p) => p.id === id);
  if (entry?.needsKey && !keyKnown(id)) throw new MissingKeyError(entry.label);

  const baseUrl = settings.endpoints?.[id];

  if (id === "anthropic") return createAnthropic(baseUrl);
  if (id === "google") return createGoogle();

  const spec = OPENAI_COMPATIBLE[id];
  if (!spec) throw new Error(`Unknown provider: ${id}`);

  return createOpenAICompatible({
    id,
    label: spec.label,
    auth: AUTH[id] ?? null,
    baseUrl: baseUrl ?? spec.baseUrl,
    suggestedModels: spec.models,
    extraHeaders: spec.headers,
  });
}

/**
 * Tries the chosen provider, then anything else the user has configured.
 *
 * A rate limit or a five-minute outage should not end a run that is twelve
 * steps in. Only retryable failures fall through — a bad request or a refused
 * key is a real answer and retrying it elsewhere would just hide the problem.
 */
export function withFallback(primary: Provider, alternates: Provider[]): Provider {
  if (!alternates.length) return primary;

  return {
    ...primary,
    async complete(req) {
      try {
        return await primary.complete(req);
      } catch (e) {
        if (!isRetryable(e) || req.signal?.aborted) throw e;
        for (const alternate of alternates) {
          try {
            return await alternate.complete(req);
          } catch {
            /* try the next one; the original error is what we finally raise */
          }
        }
        throw e;
      }
    },
  };
}

function isRetryable(e: unknown): boolean {
  return e instanceof ProviderError && e.retryable;
}

export const PROVIDER_CATALOG: ReadonlyArray<{
  id: ProviderId;
  label: string;
  /** Local runtimes need no key, so Settings hides the field entirely. */
  needsKey: boolean;
  models: readonly string[];
  /** Where to get a key, shown next to the field during onboarding. */
  keyUrl?: string;
}> = [
  {
    id: "anthropic",
    label: "Anthropic",
    needsKey: true,
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    models: OPENAI_COMPATIBLE.openai.models,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    models: OPENAI_COMPATIBLE.openrouter.models,
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "google",
    label: "Google Gemini",
    needsKey: true,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    keyUrl: "https://aistudio.google.com/apikey",
  },
  { id: "ollama", label: "Ollama", needsKey: false, models: OPENAI_COMPATIBLE.ollama.models },
];
