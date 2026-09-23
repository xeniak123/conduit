/**
 * How much of a conversation a model is shown.
 *
 * The history used to be cut at a fixed sixty thousand characters for every
 * model. That was two different bugs at once: a model with a million-token
 * window forgot the start of any long chat for no reason, and a local model
 * started with an 8K context was sent more than it could hold, so long chats
 * with it simply failed. The share now follows the model's own window, capped
 * for cloud models so a long conversation does not quietly cost a dollar a
 * message.
 */

/** A rough, conservative average for English and code; Polish runs a little lower. */
export const CHARS_PER_TOKEN = 3.6;

/** Cloud models: never send more than this much history per message. */
const CLOUD_HISTORY_CAP = 150_000;

const LOCAL_PROVIDERS = ["local", "ollama", "lmstudio", "llamacpp"];

/** The model's context window, in tokens, as far as it can be known from its name. */
export function contextWindow(provider: string, model: string, localContext?: number): number {
  if (provider === "local") return localContext && localContext > 0 ? localContext : 8_192;
  if (LOCAL_PROVIDERS.includes(provider)) return 8_192;

  // OpenRouter and friends prefix the vendor: judge the model, not the route.
  const name = (model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model).toLowerCase();

  if (/^claude-(opus|sonnet|fable|mythos)-(5|4-[5-9])/.test(name)) return 1_000_000;
  if (name.startsWith("claude-")) return 200_000;
  if (/^gpt-4\.1/.test(name)) return 1_000_000;
  if (/^gpt-5/.test(name)) return 400_000;
  if (/^(o3|o4)/.test(name)) return 200_000;
  if (/^gpt-4o/.test(name)) return 128_000;
  if (/^gemini-(2\.5|3)/.test(name)) return 1_000_000;
  if (/^gemini/.test(name)) return 1_000_000;
  if (/^(deepseek|qwen|kimi|glm|mistral|llama)/.test(name)) return 128_000;
  return 128_000;
}

/** How many tokens of earlier conversation to send with the next message. */
export function historyTokens(provider: string, model: string, localContext?: number): number {
  const window = contextWindow(provider, model, localContext);
  // A local model also has to fit the instructions, the tool list and its own
  // answer in the same window, and those are not small next to 8K.
  if (provider === "local" || LOCAL_PROVIDERS.includes(provider)) return Math.floor(window * 0.4);
  return Math.min(Math.floor(window * 0.5), CLOUD_HISTORY_CAP);
}

export function historyChars(provider: string, model: string, localContext?: number): number {
  return Math.floor(historyTokens(provider, model, localContext) * CHARS_PER_TOKEN);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface Usage {
  /** Tokens of history the next message will carry. */
  sent: number;
  /** The most history the model will be given. */
  budget: number;
  window: number;
  /** Earlier messages that no longer fit and will not be sent. */
  dropped: number;
}

/** What the next message will carry, for the meter under the message box. */
export function usageOf(
  messages: Array<{ text: string; pending?: boolean }>,
  provider: string,
  model: string,
  localContext?: number,
): Usage {
  const budgetChars = historyChars(provider, model, localContext);
  let used = 0;
  let kept = 0;
  const usable = messages.filter((m) => !m.pending && m.text.trim());
  for (let i = usable.length - 1; i >= 0; i--) {
    if (used + usable[i].text.length > budgetChars) break;
    used += usable[i].text.length;
    kept += 1;
  }
  return {
    sent: Math.ceil(used / CHARS_PER_TOKEN),
    budget: historyTokens(provider, model, localContext),
    window: contextWindow(provider, model, localContext),
    dropped: usable.length - kept,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
