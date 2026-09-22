import { contenders } from "./arena";
import { type Settings } from "./config";
import { costOf } from "./usage";
import { decide } from "@/models/decide";
import { useRuntime } from "@/models/runtime";

/**
 * Picking a model per message.
 *
 * Most messages do not need the strongest model: a greeting, a rewording, a
 * quick fact. Sending those to a fast local or cheap model and keeping the
 * expensive one for code, reasoning and long documents is most of the saving,
 * and the reply shows which model answered and what it saved.
 *
 * With a decision model loaded, the choice is its call (one forward pass,
 * about a tenth of a second). Without one, plain rules decide.
 */

export interface Route {
  model: { provider: string; model: string };
  tier: "fast" | "strong";
  reason: string;
}

const FAST_HINT = /haiku|flash|mini|nano|small|lite|8b|7b|4b|3b|2b|1b|instant|turbo/i;

/** The two ends, filled in from what is available when not chosen explicitly. */
export function tiers(settings: Settings): { fast: Route["model"] | null; strong: Route["model"] } {
  const strong = settings.router.strong ?? settings.command;
  if (settings.router.fast) return { fast: settings.router.fast, strong };
  const loaded = useRuntime.getState().loaded;
  if (loaded && !loaded.decision) return { fast: { provider: "local", model: loaded.name }, strong };
  const cheap = contenders(settings).find(
    (c) => FAST_HINT.test(c.model) && !(c.provider === strong.provider && c.model === strong.model),
  );
  return { fast: cheap ? { provider: cheap.provider, model: cheap.model } : null, strong };
}

/** Rules for when no decision model is loaded. Errs toward the strong model. */
export function needsStrong(text: string, settings: Settings, attachments = 0): string | null {
  if (settings.code.enabled) return "Code mode is on";
  if (settings.computerUse.enabled) return "Screen control is on";
  if (attachments > 0) return "Has attachments";
  if (text.length > 600) return "Long message";
  if (/```|\bfunction\b|\bclass\b|=>|\bdef\b|\bimport\b|stack trace|traceback|exception|\berror\b|\bbug\b/i.test(text)) return "Looks like code";
  if (/\b(refactor|implement|debug|architect|prove|derive|analy[sz]e|compare|plan|strategy|step by step|optimi[sz]e|essay|report|review)\b/i.test(text)) return "Needs reasoning";
  if (/[∑∫√≤≥]|\b\d+\s*[*/^]\s*\d+/.test(text)) return "Maths";
  return null;
}

export async function route(text: string, settings: Settings, attachments = 0): Promise<Route> {
  const { fast, strong } = tiers(settings);
  if (!fast) return { model: strong, tier: "strong", reason: "No faster model is set up" };

  const loaded = useRuntime.getState().loaded;
  if (loaded?.decision && !settings.code.enabled && !settings.computerUse.enabled && attachments === 0) {
    try {
      const d = await decide(loaded.port, {
        state: `User message:\n${text.slice(0, 1800)}`,
        question: "Which model should answer this message?",
        options: [
          "a small fast model: chat, greetings, short facts, rewording, translation, simple questions",
          "the strongest model: code, multi-step reasoning, analysis, maths, planning, long or tricky requests",
        ],
      });
      const p = d.options[0].p;
      // Only take the cheap path when the decision model is fairly sure.
      if (p >= 0.6) return { model: fast, tier: "fast", reason: `Simple, ${Math.round(p * 100)}% sure (${d.ms} ms)` };
      return { model: strong, tier: "strong", reason: `Needs the strong model (${d.ms} ms)` };
    } catch {
      /* fall back to rules */
    }
  }

  const why = needsStrong(text, settings, attachments);
  return why ? { model: strong, tier: "strong", reason: why } : { model: fast, tier: "fast", reason: "Short and simple" };
}

/** What the strong model would have cost for the same tokens, minus what was paid. */
export function saved(strong: string, used: string, input: number, output: number): number | null {
  const would = costOf(strong, input, output);
  const did = costOf(used, input, output) ?? 0;
  if (would === null) return null;
  return Math.max(0, would - did);
}
