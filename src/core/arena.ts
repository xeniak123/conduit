import { getProvider } from "@/llm";
import { readyProviders } from "@/llm/catalog";
import { PROVIDER_CATALOG } from "@/llm";
import { getSettings, saveSettings, type Settings } from "./config";
import { useApp } from "./store";
import { costOf, record as recordUsage } from "./usage";

/**
 * Arena: one prompt, several models, side by side.
 *
 * Votes feed a personal Elo rating per model. It is yours, built from your own
 * questions, which is a better guide to "which model should I use" than any
 * public leaderboard. The router reads it too.
 */

export interface Contender {
  provider: string;
  model: string;
  label: string;
}

export interface Rating {
  elo: number;
  games: number;
  wins: number;
}

export const keyOf = (c: { provider: string; model: string }) => `${c.provider}::${c.model}`;

/** Every model that could answer right now, pinned ones first. */
export function contenders(settings: Settings = getSettings()): Contender[] {
  const out: Contender[] = [];
  for (const p of readyProviders(settings)) {
    const custom = settings.customProviders.find((c) => c.id === p.id);
    const models = custom?.models.length
      ? custom.models
      : settings.providerModels?.[p.id]?.length
        ? settings.providerModels[p.id]
        : [...(PROVIDER_CATALOG.find((c) => c.id === p.id)?.models ?? [])];
    for (const model of models) out.push({ provider: p.id, model, label: p.label });
  }
  return out;
}

export interface Answer {
  text: string;
  ms: number;
  firstMs: number | null;
  tokens: number;
  cost: number | null;
  error?: string;
  done: boolean;
}

/** Runs one contender, streaming into `onUpdate`. No tools: a like-for-like answer. */
export async function ask(
  c: Contender,
  prompt: string,
  onUpdate: (a: Answer) => void,
  signal?: AbortSignal,
): Promise<Answer> {
  const settings = getSettings();
  const started = performance.now();
  let text = "";
  let firstMs: number | null = null;
  const push = (patch: Partial<Answer> = {}) =>
    onUpdate({ text, ms: Math.round(performance.now() - started), firstMs, tokens: 0, cost: null, done: false, ...patch });
  try {
    const provider = getProvider(c.provider, settings);
    const req = {
      model: c.model,
      system: "You are a helpful, accurate assistant. Answer directly.",
      messages: [{ role: "user" as const, text: prompt }],
      maxTokens: 2048,
      signal,
    };
    const result = provider.completeStream
      ? await provider.completeStream(req, (delta) => {
          if (firstMs === null) firstMs = Math.round(performance.now() - started);
          text += delta;
          push();
        })
      : await provider.complete(req);
    text = result.text || text;
    const input = result.usage?.input ?? 0;
    const output = result.usage?.output ?? 0;
    const cost = costOf(c.model, input, output);
    recordUsage({ at: Date.now(), model: c.model, input, output, cost });
    const final: Answer = {
      text,
      ms: Math.round(performance.now() - started),
      firstMs,
      tokens: output,
      cost,
      done: true,
    };
    onUpdate(final);
    return final;
  } catch (e) {
    const final: Answer = {
      text,
      ms: Math.round(performance.now() - started),
      firstMs,
      tokens: 0,
      cost: null,
      done: true,
      error: e instanceof Error ? e.message : String(e),
    };
    onUpdate(final);
    return final;
  }
}

const K = 24;

/** Records a vote. `winner` null means a tie. Everyone in the round is rated pairwise. */
export async function vote(round: Contender[], winner: Contender | null): Promise<void> {
  const settings = getSettings();
  const ratings: Record<string, Rating> = { ...(settings.arena?.ratings ?? {}) };
  const get = (c: Contender) => (ratings[keyOf(c)] ??= { elo: 1000, games: 0, wins: 0 });
  for (let i = 0; i < round.length; i++) {
    for (let j = i + 1; j < round.length; j++) {
      const a = get(round[i]);
      const b = get(round[j]);
      const expectA = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
      const scoreA = winner === null ? 0.5 : keyOf(winner) === keyOf(round[i]) ? 1 : keyOf(winner) === keyOf(round[j]) ? 0 : 0.5;
      a.elo += K * (scoreA - expectA);
      b.elo += K * (1 - scoreA - (1 - expectA));
    }
  }
  for (const c of round) {
    const r = get(c);
    r.games += 1;
    if (winner && keyOf(winner) === keyOf(c)) r.wins += 1;
  }
  const next = { ...settings, arena: { ratings } };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}
