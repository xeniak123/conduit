import { proxyFetch, type AuthSpec } from "./transport";
import type { CompleteRequest, CompleteResult, Msg, Provider } from "./types";
import { ProviderError } from "./types";

/**
 * OpenAI's chat-completions shape is the de facto lingua franca — OpenRouter,
 * Ollama, Groq, LM Studio and most self-hosted gateways all speak it. One
 * implementation, parameterised by base URL, covers every one of them.
 */
export function createOpenAICompatible(opts: {
  id: string;
  label: string;
  auth: AuthSpec | null;
  baseUrl: string;
  suggestedModels: readonly string[];
  /** OpenRouter asks for these; harmless elsewhere. */
  extraHeaders?: Record<string, string>;
}): Provider {
  return {
    id: opts.id,
    label: opts.label,
    suggestedModels: opts.suggestedModels,

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const body = {
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        messages: [{ role: "system", content: req.system }, ...toOpenAI(req.messages)],
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
            }
          : {}),
      };

      const res = await proxyFetch(opts.auth)(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...opts.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderError(
          `${opts.label} error ${res.status}: ${detail.slice(0, 300)}`,
          opts.id,
          res.status === 429 || res.status >= 500,
        );
      }

      const json = (await res.json()) as OpenAIResponse;
      const choice = json.choices?.[0];

      return {
        text: choice?.message?.content ?? "",
        calls: (choice?.message?.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          input: safeParse(c.function.arguments),
        })),
        stopReason: choice?.finish_reason ?? "stop",
        usage: json.usage
          ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens }
          : undefined,
      };
    },
  };
}

/** Arguments arrive as a generated string; malformed JSON is a normal failure. */
function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

interface OpenAIResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function toOpenAI(messages: Msg[]): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    if (msg.role === "user") {
      if (!msg.image) return { role: "user", content: msg.text };
      return {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${msg.image.mediaType};base64,${msg.image.base64}` },
          },
          { type: "text", text: msg.text },
        ],
      };
    }
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: msg.text ?? null,
        ...(msg.calls?.length
          ? {
              tool_calls: msg.calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      };
    }
    return { role: "tool", tool_call_id: msg.callId, content: msg.result };
  });
}
