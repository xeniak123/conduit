import { AUTH, proxyFetch } from "./transport";
import type { CompleteRequest, CompleteResult, Msg, Provider } from "./types";
import { ProviderError } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini's generateContent shape: close enough to map, different enough to isolate. */
export function createGoogle(): Provider {
  return {
    id: "google",
    label: "Google Gemini",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const res = await proxyFetch(AUTH.google)(`${BASE}/models/${req.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: req.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: toGemini(req.messages),
          generationConfig: { maxOutputTokens: req.maxTokens ?? 4096 },
          ...(req.tools?.length
            ? {
                tools: [
                  {
                    functionDeclarations: req.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.parameters,
                    })),
                  },
                ],
              }
            : {}),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderError(
          `Gemini error ${res.status}: ${detail.slice(0, 300)}`,
          "google",
          res.status === 429 || res.status >= 500,
        );
      }

      const json = (await res.json()) as GeminiResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];

      return {
        text: parts.map((p) => p.text ?? "").join(""),
        calls: parts
          .filter((p) => p.functionCall)
          .map((p, i) => ({
            // Gemini issues no call ids, but the loop needs one to match results.
            id: `gemini-${Date.now()}-${i}`,
            name: p.functionCall!.name,
            input: p.functionCall!.args ?? {},
          })),
        stopReason: json.candidates?.[0]?.finishReason ?? "STOP",
      };
    },
  };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
}

function toGemini(messages: Msg[]): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    if (msg.role === "user") {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.image) {
        parts.push({
          inlineData: { mimeType: msg.image.mediaType, data: msg.image.base64 },
        });
      }
      parts.push({ text: msg.text });
      return { role: "user", parts };
    }
    if (msg.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.text) parts.push({ text: msg.text });
      for (const call of msg.calls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.input } });
      }
      return { role: "model", parts };
    }
    return {
      role: "user",
      parts: [{ functionResponse: { name: msg.name, response: { result: msg.result } } }],
    };
  });
}
