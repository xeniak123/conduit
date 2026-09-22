import { invoke } from "@tauri-apps/api/core";
import { hideCursor } from "@/computer";
import type { Msg } from "@/llm/types";
import type { ToolContext } from "@/tools/registry";
import { runAgent } from "./agent";
import { route, saved, tiers } from "./router";
import { getSettings, type Settings } from "./config";
import { pulseCursorBirth } from "./companion";
import { useApp } from "./store";
import { formatCost, summarise } from "./usage";

/**
 * Sending a message.
 *
 * Typed and spoken input converge here — same agent, same tools, same
 * transcript. The only difference is that a spoken message is marked as such,
 * so the history shows how it arrived.
 */
export async function sendMessage(
  text: string,
  opts: {
    spoken?: boolean;
    images?: string[];
    /** Run in this chat rather than the open one (scheduled tasks). */
    conversationId?: string;
    /** Settings for this run only, e.g. a scheduled task's own model. */
    settings?: Settings;
    /**
     * Nobody is watching: anything that would need approval is declined and
     * noted in the reply, and the result arrives as a notification.
     */
    unattended?: boolean;
  } = {},
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const store = useApp.getState();
  const conversationId = opts.conversationId ?? store.activeId ?? store.newConversation();
  const base = opts.settings ?? getSettings();
  // Auto: the router picks a model for this message. Scheduled runs keep the
  // model they were given.
  const picked = !opts.settings && base.router?.enabled ? await route(trimmed, base, opts.images?.length ?? 0) : null;
  const settings = picked ? { ...base, command: picked.model } : base;
  const declined: string[] = [];
  const history = historyOf(conversationId);

  store.addMessage(conversationId, {
    id: crypto.randomUUID(),
    role: "user",
    text: trimmed,
    steps: [],
    spoken: opts.spoken,
    images: opts.images?.length ? opts.images : undefined,
  });

  const replyId = crypto.randomUUID();
  store.addMessage(conversationId, {
    id: replyId,
    role: "assistant",
    text: "",
    steps: [],
    pending: true,
  });

  // A daily ceiling is most useful exactly when it is least visible: an agent
  // working autonomously on screen spends a model call per step, and a stuck
  // loop is the expensive failure mode. Asking once beats a surprise invoice.
  if (settings.spendAlert > 0) {
    const spent = summarise().today.cost;
    if (spent >= settings.spendAlert) {
      const go = opts.unattended
        ? false
        : await store.requestApproval(
        `Today's spend is ${formatCost(spent)}, past your ${formatCost(settings.spendAlert)} limit.`,
        "Continue anyway?",
      );
      if (!go) {
        store.patchMessage(conversationId, replyId, {
          text: "Stopped — you are over today's spending limit. Raise it in Settings → Usage.",
          pending: false,
        });
        return "";
      }
    }
  }

  const controller = new AbortController();
  // A background run must not take over the Stop button of the chat the
  // person is looking at.
  if (!opts.unattended) store.setAbort(controller);

  const focus = await invoke<{ process: string; title: string }>("focused_app").catch(() => ({
    process: "",
    title: "",
  }));

  const ctx: ToolContext = {
    focus,
    conversationId,
    confirm: opts.unattended
      ? async (summary) => {
          declined.push(summary);
          return false;
        }
      : (summary, detail) => useApp.getState().requestApproval(summary, detail),
    report: (line) => useApp.getState().setCaption(line),
  };

  const startedAt = Date.now();
  let pending = "";
  let frame: number | null = null;

  try {
    const run = await runAgent(
      trimmed,
      settings,
      ctx,
      (step) => {
        const state = useApp.getState();
        state.appendStep(conversationId, replyId, step);
        // Screen tools mean the pointer is being driven; the banner has to
        // appear the moment that starts, not when the run finishes.
        if (step.tool?.startsWith("screen.") && !state.screenActive) {
          state.setScreenActive(true);
          // The companion sheds a bead, which then becomes the agent's
          // pointer. Showing where the second cursor came from is what makes
          // it read as Conduit acting rather than as something going wrong.
          pulseCursorBirth();
        }
      },
      controller.signal,
      (delta) => {
        // Appending as fragments land is what turns a long pause into
        // something that reads as thinking. Buffered to one write per frame:
        // a store write per token re-parses the whole reply as Markdown and
        // re-renders every block, which starts to stutter on a long answer.
        pending += delta;
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          const chunk = pending;
          pending = "";
          if (!chunk) return;
          const state = useApp.getState();
          const convo = state.conversations.find((x) => x.id === conversationId);
          const current = convo?.messages.find((m) => m.id === replyId)?.text ?? "";
          state.patchMessage(conversationId, replyId, { text: current + chunk });
        });
      },
      opts.images,
      history,
    );

    // A run that took a while probably finished after the user looked away.
    // Anything under half a minute they were almost certainly watching, and a
    // notification for that is just noise.
    if (opts.unattended || Date.now() - startedAt > 30_000) {
      void notifyDone(run.answer || "Finished.");
    }

    const note = declined.length
      ? `\n\n> Skipped because nobody was here to approve it: ${declined.join("; ")}`
      : "";
    useApp.getState().patchMessage(conversationId, replyId, {
      text: (run.answer || "Done.") + note,
      streaming: false,
      pending: false,
      cost: run.usage.cost,
      tokens: run.usage.input + run.usage.output,
      routed: picked
        ? {
            model: picked.model.model,
            tier: picked.tier,
            reason: picked.reason,
            saved: picked.tier === "fast" ? saved(tiers(base).strong.model, picked.model.model, run.usage.input, run.usage.output) : null,
          }
        : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Whatever had already streamed in stays; stopping should not erase it.
    const written =
      useApp.getState().conversations.find((c) => c.id === conversationId)?.messages.find((m) => m.id === replyId)?.text ?? "";
    useApp.getState().patchMessage(conversationId, replyId, {
      text: controller.signal.aborted ? written.trim() && written !== "Stopped." ? written : "Stopped." : message,
      pending: false,
      streaming: false,
    });
  } finally {
    // Whatever is still buffered must land before the final text is written,
    // or the last few words of a reply disappear.
    if (frame !== null) cancelAnimationFrame(frame);
    if (pending) {
      const state = useApp.getState();
      const convo = state.conversations.find((x) => x.id === conversationId);
      const current = convo?.messages.find((m) => m.id === replyId)?.text ?? "";
      state.patchMessage(conversationId, replyId, { text: current + pending });
      pending = "";
    }

    if (!opts.unattended) {
      const state = useApp.getState();
      state.setAbort(null);
      state.setScreenActive(false);
      void hideCursor();
    }
  }
  const final = useApp.getState().conversations.find((c) => c.id === conversationId);
  return final?.messages.find((m) => m.id === replyId)?.text ?? "";
}

/**
 * The chat so far, as the model should see it.
 *
 * Text only: old screenshots and tool transcripts cost a great deal and add
 * little once a turn is over. Capped by characters rather than turns, since a
 * single pasted file can outweigh fifty short exchanges.
 */
function historyOf(conversationId: string, budget = 60_000): Msg[] {
  const convo = useApp.getState().conversations.find((c) => c.id === conversationId);
  if (!convo) return [];
  const out: Msg[] = [];
  let used = 0;
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    const m = convo.messages[i];
    if (m.pending || !m.text.trim()) continue;
    if (used + m.text.length > budget) break;
    used += m.text.length;
    out.unshift(m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", text: m.text });
  }
  // Providers want the first turn to be the user and roles to alternate.
  while (out.length && out[0].role !== "user") out.shift();
  const merged: Msg[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && (m.role === "user" || m.role === "assistant")) {
      (last as { text?: string }).text = `${(last as { text?: string }).text ?? ""}

${(m as { text?: string }).text ?? ""}`;
    } else merged.push({ ...m });
  }
  if (merged.length && merged[merged.length - 1].role === "user") merged.pop();
  return merged;
}

/** Halts a run between actions and puts the pointer back under the user. */
export function stopRun(): void {
  const state = useApp.getState();
  state.abort?.abort();
  state.setAbort(null);
  for (const c of state.conversations) {
    const pending = c.messages.find((m) => m.role === "assistant" && m.pending);
    if (pending) state.patchMessage(c.id, pending.id, { pending: false, streaming: false, text: pending.text || "Stopped." });
  }
  state.setScreenActive(false);
  void hideCursor();
}


/**
 * A desktop notification when a long run lands.
 *
 * Best-effort throughout: the permission may be refused, the platform may not
 * have a notification centre, and neither is worth an error in front of a
 * result the user can already see.
 */
async function notifyDone(summary: string): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;

    sendNotification({
      title: "Conduit finished",
      body: summary.slice(0, 160),
    });
  } catch {
    /* notifications are a courtesy, never a requirement */
  }
}
