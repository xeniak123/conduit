import Anthropic from "@anthropic-ai/sdk";
import { AUTH, proxyFetch } from "./transport";
import type {
  CompleteRequest,
  CompleteResult,
  Msg,
  Provider,
  ToolSpec,
} from "./types";
import { ProviderError } from "./types";

/**
 * Requests leave from the native layer, not the webview: no CORS preflight,
 * and the credential is attached after the request has left the bundle, so a
 * compromised dependency cannot read it.
 */
export function createAnthropic(baseUrl?: string): Provider {
  const client = new Anthropic({
    // The SDK requires a key to construct; the real one is attached natively
    // on the way out and this placeholder is stripped from the request.
    apiKey: "conduit-proxied",
    baseURL: baseUrl,
    fetch: proxyFetch(AUTH.anthropic),
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });

  return {
    id: "anthropic",
    label: "Anthropic",
    suggestedModels: ["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    completeStream: streamAnthropic,

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      try {
        const response = await client.messages.create(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 4096,
            system: req.system,
            messages: toAnthropic(req.messages),
            ...(req.tools?.length ? { tools: req.tools.map(toAnthropicTool) } : {}),
            ...(req.effort ? { output_config: { effort: req.effort } } : {}),
            // Thinking is on by default on Opus 5. Disabling it is only safe
            // when there are no tools in play — with tools, a disabled-thinking
            // turn can write the call into visible text and silently skip it.
            ...(req.fastPath && !req.tools?.length
              ? { thinking: { type: "disabled" as const } }
              : {}),
          },
          { signal: req.signal },
        );

        return {
          text: response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
          calls: response.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
            .map((b) => ({
              id: b.id,
              name: b.name,
              // Never string-match a serialised tool input — escaping varies.
              input: (b.input ?? {}) as Record<string, unknown>,
            })),
          stopReason: response.stop_reason ?? "end_turn",
          usage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
          },
        };
      } catch (e) {
        throw translate(e);
      }
    },
  };
}

function translate(e: unknown): ProviderError {
  if (e instanceof Anthropic.RateLimitError) {
    return new ProviderError("Rate limited — try again shortly.", "anthropic", true);
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new ProviderError("Anthropic rejected the API key.", "anthropic", false);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ProviderError("Could not reach Anthropic — check the network.", "anthropic", true);
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    return new ProviderError(`Anthropic error ${status}: ${e.message}`, "anthropic", status >= 500);
  }
  return new ProviderError(e instanceof Error ? e.message : String(e), "anthropic", false);
}

function toAnthropicTool(tool: ToolSpec): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    // Guarantees the arguments validate, so the executor can trust them.
    strict: true,
  } as Anthropic.Tool;
}

/**
 * Collapses our flat message list into Anthropic's shape. The important part:
 * consecutive tool results must land in ONE user message — splitting them
 * teaches the model to stop making parallel calls.
 */
export function toAnthropic(messages: Msg[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (msg.image) {
        out.push({
          role: "user",
          content: [
            // Image before text: the model attends to the instruction with the
            // picture already in view, which measurably improves grounding.
            {
              type: "image",
              source: {
                type: "base64",
                media_type: msg.image.mediaType,
                data: msg.image.base64,
              },
            },
            { type: "text", text: msg.text },
          ],
        });
      } else {
        out.push({ role: "user", content: msg.text });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.text) content.push({ type: "text", text: msg.text });
      for (const call of msg.calls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      if (content.length) out.push({ role: "assistant", content });
      continue;
    }

    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: msg.callId,
      content: msg.result,
      ...(msg.isError ? { is_error: true } : {}),
    };

    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }

  return out;
}

/**
 * Streaming variant.
 *
 * Hand-rolled against the SSE frames rather than using the SDK's stream
 * helper, because the request has to go through the native proxy that holds
 * the credential — and that proxy speaks events, not a ReadableStream.
 */
export async function streamAnthropic(
  req: CompleteRequest,
  onDelta: (text: string) => void,
): Promise<CompleteResult> {
  const { streamSse, ToolCallBuffer } = await import("./stream");
  const { AUTH } = await import("./transport");

  let text = "";
  let stopReason = "end_turn";
  const usage = { input: 0, output: 0 };
  const tools = new ToolCallBuffer();

  await streamSse(
    "https://api.anthropic.com/v1/messages",
    {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: toAnthropic(req.messages),
      stream: true,
      ...(req.tools?.length ? { tools: req.tools.map(toAnthropicTool) } : {}),
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    },
    AUTH.anthropic,
    (line) => {
      const event = JSON.parse(line.data) as AnthropicEvent;

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        tools.start(event.index ?? 0, event.content_block.id ?? "", event.content_block.name ?? "");
      }
      if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && event.delta.text) {
          text += event.delta.text;
          onDelta(event.delta.text);
        }
        if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          tools.append(event.index ?? 0, event.delta.partial_json);
        }
      }
      if (event.type === "message_start" && event.message?.usage) {
        usage.input = event.message.usage.input_tokens ?? 0;
      }
      if (event.type === "message_delta") {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        if (event.usage?.output_tokens) usage.output = event.usage.output_tokens;
      }
    },
    req.signal,
    { "anthropic-version": "2023-06-01" },
  );

  return { text, calls: tools.finish(), stopReason, usage };
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: { usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
}
