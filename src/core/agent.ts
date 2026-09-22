import { captureScreen, frameDescription, lastFrame } from "@/computer";
import { getProvider, PROVIDER_CATALOG, withFallback } from "@/llm";
import { abortable } from "@/llm/transport";
import { keyKnown } from "./secrets";
import type { Msg, ToolCall } from "@/llm/types";
import { skillsPrompt } from "@/skills";
import { memoryPrompt } from "@/tools/builtin/memory";
import { getTool, toolSpecs } from "@/tools/registry";
import type { Tool, ToolContext } from "@/tools/registry";
import { recordAudit } from "./audit";
import { isGated, type Settings } from "./config";
import { costOf, formatCost, record as recordUsage, summarise as spendToday } from "./usage";

/**
 * Screen work needs far more turns than a filesystem task — opening an app,
 * finding a control and clicking it is three steps before anything useful
 * happens. The cap still exists so a confused run cannot grind forever.
 */
const MAX_TURNS = 8;
const MAX_TURNS_ON_SCREEN = 40;

export interface AgentStep {
  kind: "thought" | "tool" | "result" | "answer" | "error" | "declined";
  text: string;
  tool?: string;
  /** Milliseconds the step took, shown so slowness is attributable. */
  ms?: number;
  /** A tool call's arguments, for describing it in words. */
  input?: Record<string, unknown>;
}

export interface AgentRun {
  steps: AgentStep[];
  answer: string;
  usage: { input: number; output: number; cost: number };
}

/**
 * The tool loop.
 *
 * Hand-written rather than using an SDK's tool runner because it has to be
 * provider-agnostic — the same loop drives Anthropic, OpenAI, Gemini and a
 * local model — and because three things have to happen around every call that
 * a generic runner does not do: permission gating, audit logging, and cost
 * accounting.
 */
export async function runAgent(
  utterance: string,
  settings: Settings,
  ctx: ToolContext,
  onStep: (step: AgentStep) => void,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
  images?: string[],
  history: Msg[] = [],
): Promise<AgentRun> {
  // Code can have a deliberately stronger or cheaper dedicated model without
  // changing the model used for ordinary desktop requests.
  // One model at a time: the one in the switcher. A hidden second model for
  // Code mode meant the switcher said one thing while another answered.
  const command = settings.command;
  // Search is a switch in the message box; off means the model never sees
  // the web tools at all rather than seeing them and being refused.
  const specs = () =>
    toolSpecs().filter(
      (t) =>
        (settings.webSearch !== false || !t.name.startsWith("web.")) &&
        (settings.computerUse.enabled || !t.name.startsWith("screen.")),
    );
  const provider = withFallback(
    getProvider(command.provider, settings),
    PROVIDER_CATALOG.filter(
      // Only providers we know are configured. A local runtime needs no key,
      // which made it look available even when nothing was listening — and a
      // fallback to a dead port blocks until the request times out.
      (p) => p.id !== command.provider && p.needsKey && keyKnown(p.id),
    )
      .map((p) => {
        try {
          return getProvider(p.id, settings);
        } catch {
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
  );
  const steps: AgentStep[] = [];
  const usage = { input: 0, output: 0, cost: 0 };

  const emit = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
  };

  // Waiving the ceiling applies to the rest of this run, not to every
  // subsequent turn — being asked again on step 12 after saying yes on step 4
  // would train people to dismiss the prompt without reading it.
  let budgetWaived = false;
  // One free retry when a model answers with nothing at all.
  let nudged = false;

  const messages: Msg[] = [
    // Earlier turns of this chat, as plain text. Without them every message
    // was a first message, and "make it shorter" had nothing to refer to.
    ...history,
    {
      role: "user",
      text: utterance,
      // Only the first image rides on the opening turn. Several would need a
      // multi-part shape that not every provider accepts, and in practice a
      // second screenshot is a second question.
      ...(images?.length ? { image: { base64: images[0], mediaType: "image/png" as const } } : {}),
    },
  ];
  const canSeeScreen = specs().some((t) => t.name.startsWith("screen."));
  const limit = canSeeScreen ? MAX_TURNS_ON_SCREEN : MAX_TURNS;

  for (let turn = 0; turn < limit; turn++) {
    if (signal?.aborted) break;

    /**
     * The spending ceiling, checked *during* the run rather than only before
     * it.
     *
     * The limit exists for exactly this case: a screen-control run spends a
     * model call per step and can take forty of them. Checking once at the
     * start means a single request can sail past the ceiling and only be
     * caught on the next message — by which time the money is gone.
     */
    if (settings.spendAlert > 0 && turn > 0) {
      const spent = spendToday().today.cost;
      if (spent >= settings.spendAlert && !budgetWaived) {
        const go = await ctx.confirm(
          `Spent ${formatCost(spent)} today, past your ${formatCost(settings.spendAlert)} limit.`,
          "Keep going?",
        );
        if (!go) {
          const stopped = "Stopped at your spending limit.";
          emit({ kind: "error", text: stopped });
          return { steps, answer: stopped, usage };
        }
        budgetWaived = true;
      }
    }

    const request = {
      model: command.model,
      system: systemPrompt(ctx, settings),
      messages: pruneFrames(messages),
      tools: specs(),
      maxTokens: 4096,
      signal,
    };

    // Streaming only earns its complexity for the reply the user reads. Once
    // the model is chaining tool calls, the text between them is bookkeeping
    // and the buffered path is simpler and no slower in practice.
    const response = await abortable(
      onDelta && provider.completeStream ? provider.completeStream(request, onDelta) : provider.complete(request),
      signal,
    );

    if (response.usage) {
      usage.input += response.usage.input;
      usage.output += response.usage.output;
      const cost = costOf(command.model, response.usage.input, response.usage.output, command.provider);
      usage.cost += cost ?? 0;
      recordUsage({
        at: Date.now(),
        model: command.model,
        input: response.usage.input,
        output: response.usage.output,
        cost,
      });
    }

    if (response.text.trim()) {
      emit({ kind: response.calls.length ? "thought" : "answer", text: response.text.trim() });
    }

    if (!response.calls.length) {
      const said = response.text.trim();
      if (said) return { steps, answer: said, usage };
      // Some models (small or free ones especially) return an empty turn.
      // One nudge, then a plain request for the answer, so a run never ends
      // with a blank reply.
      if (!nudged) {
        nudged = true;
        messages.push({ role: "assistant", text: "" });
        messages.push({ role: "user", text: "You replied with nothing. Answer the request now, in plain words." });
        continue;
      }
      const forced = await finish(messages);
      return { steps, answer: forced || "I could not produce an answer for that. Try rewording it, or pick another model.", usage };
    }

    messages.push({ role: "assistant", text: response.text, calls: response.calls });

    // Screen actions are sequential by nature: the second click depends on what
    // the first one did. Everything else can overlap, and parallel results must
    // go back in one batch — splitting them teaches the model to stop issuing
    // parallel calls at all.
    const touchesScreen = response.calls.some((c) => getTool(c.name)?.visual);
    const results: Msg[] = [];

    if (touchesScreen) {
      for (const call of response.calls) {
        if (signal?.aborted) break;
        results.push(await abortable(executeCall(call, ctx, settings, emit), signal));
      }
    } else {
      results.push(
        ...(await abortable(
          Promise.all(response.calls.map((c) => executeCall(c, ctx, settings, emit))),
          signal,
        )),
      );
    }
    messages.push(...results);

    if (touchesScreen && !signal?.aborted) {
      const shot = await refreshScreen();
      if (shot) messages.push(shot);
    }
  }

  if (signal?.aborted) return { steps, answer: "Stopped.", usage };
  // The step ceiling is not a dead end: whatever the run learned is worth an
  // answer, with the limit stated honestly.
  const summary = await finish(messages, true);
  const capped = summary
    ? `${summary}\n\n> I stopped after ${limit} steps. Ask me to continue if that was not the whole job.`
    : "I ran out of steps before finishing. Try a narrower request.";
  emit({ kind: "answer", text: capped });
  return { steps, answer: capped, usage };

  /** One last turn with no tools, so the run always ends in words. */
  async function finish(history: Msg[], capped = false): Promise<string> {
    try {
      const result = await abortable(
        provider.complete({
          model: command.model,
          system: systemPrompt(ctx, settings),
          messages: [
            ...pruneFrames(history),
            {
              role: "user",
              text: capped
                ? "You have reached the step limit. Tell the user what you did, what you found, and what is left, in a short answer. Do not call any tools."
                : "Answer the request now in plain words, using what you already found. Do not call any tools.",
            },
          ],
          maxTokens: 1024,
          signal,
        }),
        signal,
      );
      if (result.usage) {
        usage.input += result.usage.input;
        usage.output += result.usage.output;
        usage.cost += costOf(command.model, result.usage.input, result.usage.output, command.provider) ?? 0;
      }
      return result.text.trim();
    } catch {
      return "";
    }
  }
}

async function executeCall(
  call: ToolCall,
  ctx: ToolContext,
  settings: Settings,
  emit: (step: AgentStep) => void,
): Promise<Msg> {
  const tool = getTool(call.name);

  if (!tool) {
    emit({ kind: "error", text: `Unknown tool: ${call.name}`, tool: call.name });
    return {
      role: "tool",
      callId: call.id,
      name: call.name,
      result: `No tool named "${call.name}" is registered.`,
      isError: true,
    };
  }

  // Permission is decided here, once, from the user's profile — not inside
  // each tool. Scattering the decision is how a tool eventually ships without
  // one, and how the same action ends up asking twice.
  let approved = false;
  if (isGated(settings, tool.name)) {
    approved = await ctx.confirm(summarise(tool, call), contextLine(call, ctx));
    if (!approved) {
      emit({ kind: "declined", text: `${call.name} — declined`, tool: call.name });
      void recordAudit({
        at: Date.now(),
        conversationId: ctx.conversationId,
        tool: call.name,
        input: call.input,
        outcome: "declined",
        detail: "User declined.",
        approved: false,
      });
      return {
        role: "tool",
        callId: call.id,
        name: call.name,
        result: "The user declined this action. Do not retry it; ask what they would prefer.",
      };
    }
  }

  emit({ kind: "tool", text: describe(call), tool: call.name, input: call.input });
  const started = performance.now();

  try {
    const result = await tool.run(call.input, ctx);
    const ms = Math.round(performance.now() - started);
    emit({ kind: "result", text: result, tool: call.name, ms });

    if (settings.auditLog) {
      void recordAudit({
        at: Date.now(),
        conversationId: ctx.conversationId,
        tool: call.name,
        input: call.input,
        outcome: "ran",
        detail: result,
        approved,
      });
    }
    return { role: "tool", callId: call.id, name: call.name, result };
  } catch (e) {
    // A failed tool still has to come back as a result — dropping it leaves
    // the conversation malformed and the model unable to recover.
    const message = e instanceof Error ? e.message : String(e);
    emit({ kind: "error", text: message, tool: call.name });

    if (settings.auditLog) {
      void recordAudit({
        at: Date.now(),
        conversationId: ctx.conversationId,
        tool: call.name,
        input: call.input,
        outcome: "failed",
        detail: message,
        approved,
      });
    }
    return { role: "tool", callId: call.id, name: call.name, result: message, isError: true };
  }
}

/**
 * What the confirmation dialog says.
 *
 * For a command it is the verbatim command line, never a paraphrase — a
 * summary is exactly how somebody approves what they did not mean.
 */
function summarise(tool: Tool, call: ToolCall): string {
  if (call.name === "shell.run") return String(call.input.command ?? "");
  if (call.name.startsWith("fs.")) return `${tool.name}  ${String(call.input.path ?? "")}`;
  // A code edit is approved on what it does to the file, not on the tool's
  // name: the user needs to see the lines going out and the lines coming in.
  if (call.name === "code.edit") return `${call.name}  ${String(call.input.path ?? "")}`;
  if (call.name.startsWith("code.")) return `${call.name}  ${String(call.input.path ?? "")}`;
  if (call.name === "screen.type") return `Type: ${String(call.input.text ?? "")}`;
  if (call.name === "screen.key") return `Press ${(call.input.keys as string[])?.join("+")}`;
  if (call.name === "screen.click") return `Click at (${call.input.x}, ${call.input.y})`;
  return describe(call);
}

function contextLine(call: ToolCall, ctx: ToolContext): string | undefined {
  if (call.name === "code.edit") return editPreview(call);
  if (call.input.cwd) return `in ${String(call.input.cwd)}`;
  if (call.name.startsWith("screen.") && ctx.focus.process) return `in ${ctx.focus.process}`;
  return undefined;
}

/** The edit as a diff, so what is approved is what will happen. */
function editPreview(call: ToolCall): string {
  const minus = String(call.input.find ?? "")
    .split("\n")
    .slice(0, 12)
    .map((line) => `- ${line}`);
  const plus = String(call.input.replace ?? "")
    .split("\n")
    .slice(0, 12)
    .map((line) => `+ ${line}`);
  return [...minus, ...plus].join("\n");
}

/**
 * Shows the agent the screen as it is *now*.
 *
 * Only the newest screenshot survives in the conversation — `pruneFrames`
 * strips the rest. A ten-step task would otherwise carry ten full images,
 * which is ruinously expensive and *worse* for accuracy, because the model
 * starts reasoning about a screen from four actions ago.
 */
async function refreshScreen(): Promise<Msg | null> {
  try {
    await captureScreen();
    const image = lastFrame();
    if (!image) return null;
    return { role: "user", text: `Screen after that action. ${frameDescription()}`, image };
  } catch {
    return null;
  }
}

function pruneFrames(messages: Msg[]): Msg[] {
  let seen = false;
  const kept: Msg[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && msg.image) {
      if (seen) {
        kept.push({ role: "user", text: `${msg.text} [earlier screenshot omitted]` });
        continue;
      }
      seen = true;
    }
    kept.push(msg);
  }

  return kept.reverse();
}

function describe(call: ToolCall): string {
  const args = Object.values(call.input)
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(" ");
  return args ? `${call.name} ${args}`.slice(0, 160) : call.name;
}

function systemPrompt(ctx: ToolContext, settings: Settings): string {
  const where = ctx.focus.process
    ? `The user is currently in ${ctx.focus.process} — window title "${ctx.focus.title}". ` +
      `When they say "here" or "this", they mean that window.`
    : `The focused application is unknown.`;

  const project = settings.projects.find((p) => p.id === settings.activeProjectId);
  const canSeeScreen = toolSpecs().some((t) => t.name.startsWith("screen."));

  const base = [
    "You are Conduit, an assistant running on the user's desktop. Requests may",
    "be typed or spoken. A spoken one arrives transcribed, so expect false",
    "starts, filler words and homophone errors — infer the intent rather than",
    "asking about transcription noise.",
    "",
    where,
    `This computer's language is ${typeof navigator !== "undefined" ? navigator.language : "unknown"}; use it when a message does not make its language clear.`,
  ];

  if (project) {
    base.push(
      "",
      `Active project: ${project.name}, rooted at ${project.root}. Resolve relative`,
      "paths and run commands there unless told otherwise.",
    );
    if (project.brief.trim()) base.push("", `Project instructions: ${project.brief.trim()}`);
  }

  base.push(
    "",
    "Always reply in the language of the user's latest message. A greeting",
    "like \"hej\" from a Polish speaker is Polish, not Swedish: when a short",
    "message is ambiguous, prefer the language of earlier messages.",
    "",
    "Act rather than explain. If a request maps to tools, call them. Ask a",
    "clarifying question only when getting it wrong would be destructive or a",
    "required detail genuinely cannot be inferred.",
    "",
    "Some actions need the user's confirmation before they run. If one is",
    "declined, do not retry it — ask what they would prefer instead.",
    "",
    "Keep your final reply to one or two plain sentences saying what you did.",
  );

  const skills = skillsPrompt();
  if (skills) base.push(skills);
  const memory = memoryPrompt();
  if (memory) base.push(memory);

  // Code mode changes the brief rather than adding to it. An assistant told to
  // act immediately and keep it short does the wrong thing in a repository,
  // where reading before writing is most of the work.
  if (settings.code.enabled) {
    base.push(
      "",
      "CODE MODE",
      "You are working in a codebase. Read before you write: open the files you",
      "are about to change and the ones that call them, and match what is already",
      "there — its naming, its idioms, its comment density — rather than importing",
      "a house style of your own.",
      "",
      "- Prefer a small, surgical edit to a rewrite. If a rewrite is genuinely",
      "  better, say why before doing it.",
      "- Never invent an API. If you are not certain a function exists, look.",
      "- After an edit, say what you changed and what you did not verify.",
      "- Never claim a test or a build passed unless you ran it and saw it pass.",
      "- A zero exit code from a pipeline belongs to the last command in it.",
      "  Check the one you actually care about.",
      "",
      "Working method in an unfamiliar project: code.context to see what it is,",
      "code.tree or code.search to find the right file, code.outline to find the",
      "right part of it, code.read to see the lines, then code.edit or",
      "code.insert. Finish with code.diff and read it: it is the last chance to",
      "catch an edit that went somewhere you did not mean. code.undo puts a file",
      "back if it did.",
    );

    const test = settings.code.testCommand.trim();
    if (test) {
      base.push(
        "",
        `After changing code, run: ${test}`,
        "Report the result. If it fails, fix it or say plainly that you could not.",
      );
    }
    if (settings.code.guardDirtyFiles) {
      base.push(
        "",
        "Before writing to a file, check whether it has uncommitted changes. If it",
        "does, show what you intend to change and ask first — overwriting somebody's",
        "unsaved work cannot be undone.",
      );
    }
  }

  if (!canSeeScreen) return base.join("\n");

  return [
    ...base,
    "",
    "SCREEN CONTROL",
    "You can see the screen and operate the machine directly. Working method:",
    "",
    "1. Call screen.capture and actually look before acting. Never guess at a",
    "   coordinate you have not seen.",
    "2. Give coordinates in the screenshot's pixel space, aiming at the centre",
    "   of the target, not its edge.",
    "3. Take one action at a time. After each one you are shown a fresh",
    "   screenshot — check it did what you expected before continuing.",
    "4. Prefer keyboard over mouse where it is reliable: a shortcut, the start",
    "   menu, or typing a URL beats hunting for a small target.",
    "5. To type into a field, click it first. Typing does not move focus.",
    "6. If an action did not work, look again and try a different route rather",
    "   than repeating the same click.",
    "",
    "Stop and say so if the screen shows a password prompt, a payment form, or",
    "anything you were not asked to touch. Never enter credentials or card",
    "details, and never confirm a purchase, even if asked to.",
  ].join("\n");
}
