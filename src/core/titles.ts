import { getProvider } from "@/llm";
import type { Settings } from "./config";
import { useApp } from "./store";
import { costOf, record } from "./usage";

/**
 * Names a chat after its first exchange.
 *
 * The first forty-eight characters of the first message make a poor title:
 * "hey can you help me with something, I have a" is what the sidebar showed.
 * One tiny request, after the answer is already on screen, gives it a name a
 * person would have chosen. It never blocks anything, is priced like every
 * other call, and a chat the user named themselves is left alone.
 */
export async function nameChat(conversationId: string, question: string, answer: string, settings: Settings): Promise<void> {
  const convo = useApp.getState().conversations.find((c) => c.id === conversationId);
  if (!convo || convo.named || convo.scheduleId) return;
  try {
    const provider = getProvider(settings.command.provider, settings);
    const result = await provider.complete({
      model: settings.command.model,
      system:
        "You name conversations. Reply with only a title of two to six words, in the language the user wrote in. " +
        "No quotation marks, no full stop, no emoji.",
      messages: [
        {
          role: "user",
          text: `First message:\n${question.slice(0, 1200)}\n\nReply:\n${answer.slice(0, 1200)}\n\nTitle:`,
        },
      ],
      maxTokens: 24,
      effort: "low",
      fastPath: true,
    });
    if (result.usage) {
      record({
        at: Date.now(),
        model: settings.command.model,
        input: result.usage.input,
        output: result.usage.output,
        cost: costOf(settings.command.model, result.usage.input, result.usage.output, settings.command.provider),
      });
    }
    const title = cleanTitle(result.text);
    const now = useApp.getState().conversations.find((c) => c.id === conversationId);
    // The user may have renamed it while the request was out.
    if (title && now && !now.named) useApp.getState().renameConversation(conversationId, title);
  } catch {
    // The first words of the question are a fine title to fall back on.
  }
}

/** What a model sends back as a title, reduced to a title. */
export function cleanTitle(raw: string): string {
  const line = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return "";
  const title = line
    .replace(/^(title|tytuł)\s*[:\-–]\s*/i, "")
    .replace(/^[#*_>\s"'“”„«»`]+|[#*_\s"'“”„«»`]+$/g, "")
    .replace(/[.!。]+$/, "")
    .trim();
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title;
}
