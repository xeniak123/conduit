import { invoke } from "@tauri-apps/api/core";

/**
 * Decision models ("System One", Jev-style).
 *
 * They do not write. Given a state, a question and a list of options, one
 * forward pass puts a probability on each option's letter, and that is the
 * answer: calibrated, bounded to the options, and fast enough (tens of
 * milliseconds on a small model) to sit inside a game loop, a router or a
 * filter where a chat model would be far too slow.
 *
 * The prompt format is the one these models are trained on. Sending a chat
 * message instead produces meaningless text, which is why they get their own
 * console rather than the chat window.
 */

export type DecisionKind = "choice" | "bool" | "score";

export interface Decision {
  options: Array<{ label: string; p: number }>;
  /** The winner. */
  best: string;
  /** For scores: the expected level, 0 based. */
  expected?: number;
  ms: number;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Names and tags these models are published under. */
export function isDecisionModel(text: string): boolean {
  return /jev\b|jev[-_]|\blaya\b|\bdecider\b|\bkev-\d|\bvon\b|decision[-_ ]?model|[-_]decision\b|system[-_ ]?one|systemone|semantic[-_ ]if|typed[-_ ]decisions|calibrated[-_ ]decisions/i.test(
    text,
  );
}

export function decisionPrompt(state: string, question: string, options: string[]): string {
  return [
    "You are a decision function. Read the state, then answer the question by choosing exactly one option.",
    "",
    "[State]",
    state.trim(),
    "",
    "[Question]",
    question.trim(),
    "",
    "[Options]",
    ...options.map((o, i) => `${LETTERS[i]}. ${o.trim()}`),
    "",
    "Answer:",
  ].join("\n");
}

interface Candidate {
  token: string;
  p: number;
}

/** llama-server has answered in two shapes over time; both are read here. */
export function candidatesFrom(body: unknown): Candidate[] {
  const b = body as {
    completion_probabilities?: Array<{
      probs?: Array<{ tok_str: string; prob: number }>;
      top_logprobs?: Array<{ token: string; logprob: number }>;
      top_probs?: Array<{ token: string; prob: number }>;
    }>;
  };
  const first = b.completion_probabilities?.[0];
  if (!first) return [];
  if (first.top_logprobs) return first.top_logprobs.map((t) => ({ token: t.token, p: Math.exp(t.logprob) }));
  if (first.top_probs) return first.top_probs.map((t) => ({ token: t.token, p: t.prob }));
  if (first.probs) return first.probs.map((t) => ({ token: t.tok_str, p: t.prob }));
  return [];
}

/** Probability per option, renormalised over the declared letters only. */
export function distribution(candidates: Candidate[], options: string[]): Array<{ label: string; p: number }> {
  const mass = options.map(() => 0);
  for (const c of candidates) {
    const letter = c.token.trim().replace(/[.):]$/, "").toUpperCase();
    const i = LETTERS.indexOf(letter);
    if (letter.length === 1 && i >= 0 && i < options.length) mass[i] += c.p;
  }
  const total = mass.reduce((a, b) => a + b, 0);
  return options.map((label, i) => ({ label, p: total > 0 ? mass[i] / total : 1 / options.length }));
}

/**
 * One decision against a llama-server on this machine.
 *
 * Uses the raw completion endpoint: no chat template, one token, the top
 * alternatives with their probabilities. The prompt prefix is cached by the
 * server, so repeated decisions over the same state are faster still.
 */
export async function decide(
  port: number,
  input: { state: string; question: string; options: string[]; kind?: DecisionKind },
): Promise<Decision> {
  const kind = input.kind ?? "choice";
  const options = kind === "bool" ? ["yes", "no"] : input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) throw new Error("A decision needs at least two options.");
  if (options.length > 26) throw new Error("At most 26 options.");

  const started = performance.now();
  const res = await invoke<{ status: number; body: string }>("proxy_send", {
    request: {
      url: `http://127.0.0.1:${port}/completion`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: decisionPrompt(input.state, input.question, options),
        n_predict: 1,
        n_probs: Math.min(40, Math.max(20, options.length * 2)),
        temperature: 0,
        cache_prompt: true,
      }),
      auth: null,
    },
  });
  if (res.status !== 200) throw new Error(`The model server answered ${res.status}.`);
  const dist = distribution(candidatesFrom(JSON.parse(res.body)), options);
  const ms = Math.round(performance.now() - started);
  const best = dist.reduce((a, b) => (b.p > a.p ? b : a)).label;
  const expected = kind === "score" ? dist.reduce((sum, o, i) => sum + o.p * i, 0) : undefined;
  return { options: dist, best, expected, ms };
}
