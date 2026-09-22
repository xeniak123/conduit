import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { resend } from "@/core/chat";
import type { AgentStep } from "@/core/agent";
import { useApp, type ChatMessage } from "@/core/store";
import { formatCost } from "@/core/usage";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { Markdown } from "./Markdown";
import { SPRING, SPRING_SNAP, riseIn } from "./motion";

export function Message({ message }: { message: ChatMessage }) {
  const [editing, setEditing] = useState(false);
  const conversationId = useApp((s) => s.activeId);
  const busy = useApp((s) => s.abort !== null);
  if (message.role === "user") {
    return (
      <motion.div className="msg msg--user" {...riseIn} transition={SPRING}>
        <div>
          {message.images && message.images.length > 0 && (
            <div className="msg__images">
              {message.images.map((data, i) => (
                <img
                  key={i}
                  className="msg__image"
                  src={`data:image/png;base64,${data}`}
                  alt="Attached"
                />
              ))}
            </div>
          )}
          {editing ? (
            <EditBox
              initial={message.text}
              onCancel={() => setEditing(false)}
              onSave={(text) => {
                setEditing(false);
                if (conversationId) void resend(conversationId, message.id, text);
              }}
            />
          ) : (
            <div className="bubble">{message.text}</div>
          )}
          {!editing && (
            <div className="msg__actions" style={{ justifyContent: "flex-end" }}>
              {message.versions && message.versions.length > 1 && conversationId && (
                <Versions
                  count={message.versions.length}
                  index={message.version ?? 0}
                  onPick={(v) => useApp.getState().showVersion(conversationId, message.id, v)}
                />
              )}
              <Action label="Copy" onAct={() => copy(message.text)} icon="copy" />
              <Action label="Edit" onAct={() => setEditing(true)} icon="compose" quiet />
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`msg${message.pending ? " msg--pending" : ""}`}
      {...riseIn}
      transition={SPRING}
    >
      <div className="assistant">
        <span className="assistant__mark">
          <Logo size={15} />
        </span>
        <div className="assistant__body">
          {message.text ? (
            <Markdown text={message.text} />
          ) : message.pending ? (
            <span className="thinking" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          ) : null}

          {message.steps.some((st) => st.kind !== "answer" && st.kind !== "thought") && <Activity message={message} />}

          {!message.pending && message.text && (
            <>
              <div className="msg__actions">
                <Action label="Copy" onAct={() => copy(message.text)} icon="copy" />
                {!busy && (
                  <Action
                    label="Regenerate"
                    icon="refresh"
                    quiet
                    onAct={() => {
                      const state = useApp.getState();
                      const convo = state.conversations.find((c) => c.id === state.activeId);
                      const index = convo?.messages.findIndex((m) => m.id === message.id) ?? -1;
                      const prompt = convo?.messages
                        .slice(0, Math.max(0, index))
                        .reverse()
                        .find((m) => m.role === "user");
                      if (convo && prompt) void resend(convo.id, prompt.id, prompt.text);
                    }}
                  />
                )}
              </div>
              {((message.cost ?? 0) > 0 || message.routed) && (
                <div className="msg__meta">
                  {message.routed && (
                    <span className="msg__route" data-tier={message.routed.tier} title={message.routed.reason}>
                      Auto · {message.routed.model}
                      {message.routed.saved ? ` · saved ${formatCost(message.routed.saved)}` : ""}
                    </span>
                  )}
                  {(message.cost ?? 0) > 0 && <span>{formatCost(message.cost ?? 0)}</span>}
                  {message.tokens ? <span>· {message.tokens.toLocaleString()} tokens</span> : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * What the agent actually did.
 *
 * Collapsed by default so the reply stays readable, but never hidden — when
 * software runs commands on your machine, "trust me" is not an acceptable
 * interface. It opens automatically while the run is live, so you watch it
 * happen, then folds away once it is done.
 */
function Activity({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const expanded = open || Boolean(message.pending);
  const toolSteps = message.steps.filter((s) => s.kind === "tool").length;
  const failed = message.steps.some((s) => s.kind === "error");

  return (
    <div className="activity">
      <button className="activity__head" onPointerDown={() => setOpen((v) => !v)}>
        <Icon.wrench />
        {message.pending
          ? (timeline(message.steps).at(-1)?.doing ?? "Working")
          : `${toolSteps} step${toolSteps === 1 ? "" : "s"}`}
        {failed && <span style={{ color: "var(--live)" }}>· had errors</span>}
        <motion.span
          className="activity__chev"
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={SPRING_SNAP}
        >
          <Icon.chevron />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            style={{ overflow: "hidden" }}
          >
            <div className="activity__list">
              {timeline(message.steps).map((item, i, all) => {
                const live = Boolean(message.pending) && i === all.length - 1 && !item.result;
                return (
                  <motion.div
                    key={i}
                    className={`tl tl--${item.state}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={SPRING_SNAP}
                  >
                    <span className="tl__dot">{live ? <span className="spin" /> : null}</span>
                    <span className="tl__body">
                      <span className="tl__title">
                        {live ? item.doing : item.done}
                        {item.ms !== undefined && item.ms > 400 && <em>{(item.ms / 1000).toFixed(1)}s</em>}
                      </span>
                      {item.detail && <span className="tl__detail">{item.detail}</span>}
                    </span>
                  </motion.div>
                );
              })}

              {message.screenshot && (
                <img
                  className="shot"
                  src={`data:image/png;base64,${message.screenshot}`}
                  alt="What the agent saw"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function Action({
  label,
  icon,
  onAct,
  quiet,
}: {
  label: string;
  icon: keyof typeof Icon;
  onAct: () => void;
  /** No "Done" flash: the action's effect is visible on its own. */
  quiet?: boolean;
}) {
  const [done, setDone] = useState(false);
  const Glyph = done ? Icon.check : Icon[icon];

  return (
    <button
      className="msg__action"
      onPointerDown={() => {
        onAct();
        if (quiet) return;
        setDone(true);
        window.setTimeout(() => setDone(false), 1300);
      }}
    >
      <Glyph />
      {done ? "Done" : label}
    </button>
  );
}

function copy(text: string): void {
  // Clipboard access can be refused; failing quietly beats an alert over a
  // convenience action the user can repeat.
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <div className="editbox">
      <textarea
        autoFocus
        className="editbox__input"
        value={text}
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) onSave(text.trim());
          }
        }}
      />
      <div className="editbox__row">
        <span className="muted">The previous version stays, behind the arrows.</span>
        <button className="btn btn--small" onPointerDown={onCancel}>
          Cancel
        </button>
        <button className="btn btn--small btn--ink" disabled={!text.trim()} onPointerDown={() => onSave(text.trim())}>
          Send
        </button>
      </div>
    </div>
  );
}

function Versions({ count, index, onPick }: { count: number; index: number; onPick: (i: number) => void }) {
  return (
    <span className="versions">
      <button aria-label="Previous version" disabled={index === 0} onPointerDown={() => onPick(index - 1)}>
        <Icon.chevron />
      </button>
      <span>
        {index + 1}/{count}
      </span>
      <button aria-label="Next version" disabled={index >= count - 1} onPointerDown={() => onPick(index + 1)}>
        <Icon.chevron />
      </button>
    </span>
  );
}

interface TimelineItem {
  doing: string;
  done: string;
  detail?: string;
  result?: string;
  ms?: number;
  state: "ok" | "error" | "declined" | "running" | "note";
}

const clip = (v: unknown, n = 60) => {
  const t = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** What a tool call was, in words a person would use. */
function phrase(tool: string, input: Record<string, unknown> = {}): { doing: string; done: string; detail?: string } {
  const name = (p: unknown) => clip(String(p ?? "").split(/[\\/]/).pop(), 48);
  switch (tool) {
    case "screen.capture":
      return { doing: "Looking at the screen…", done: "Looked at the screen" };
    case "screen.click":
      return { doing: "Clicking…", done: "Clicked", detail: input.x !== undefined ? `at ${input.x}, ${input.y}` : undefined };
    case "screen.move":
      return { doing: "Moving the pointer…", done: "Moved the pointer" };
    case "screen.drag":
      return { doing: "Dragging…", done: "Dragged" };
    case "screen.scroll":
      return { doing: "Scrolling…", done: "Scrolled", detail: clip(input.direction) };
    case "screen.type":
    case "system.type":
      return { doing: "Typing…", done: "Typed", detail: `“${clip(input.text, 50)}”` };
    case "screen.key":
    case "system.keys":
      return { doing: "Pressing keys…", done: "Pressed", detail: clip(input.keys ?? input.key) };
    case "screen.wait":
      return { doing: "Waiting for the screen…", done: "Waited" };
    case "web.search":
      return { doing: "Searching the web…", done: "Searched the web", detail: `“${clip(input.query)}”` };
    case "web.fetch":
      return { doing: "Reading a page…", done: "Read a page", detail: clip(String(input.url ?? "").replace(/^https?:\/\//, "")) };
    case "fs.read":
    case "code.read":
      return { doing: "Reading a file…", done: "Read", detail: name(input.path) };
    case "fs.write":
    case "code.edit":
      return { doing: "Writing a file…", done: "Wrote", detail: name(input.path) };
    case "fs.list":
    case "code.tree":
      return { doing: "Looking through a folder…", done: "Looked through", detail: name(input.path) };
    case "fs.delete":
      return { doing: "Deleting…", done: "Deleted", detail: name(input.path) };
    case "fs.mkdir":
      return { doing: "Creating a folder…", done: "Created folder", detail: name(input.path) };
    case "code.search":
      return { doing: "Searching the code…", done: "Searched the code", detail: `“${clip(input.query ?? input.pattern)}”` };
    case "code.test":
      return { doing: "Running the tests…", done: "Ran the tests" };
    case "shell.run":
      return { doing: "Running a command…", done: "Ran", detail: clip(input.command, 70) };
    case "system.open":
      return { doing: "Opening…", done: "Opened", detail: name(input.target) };
    case "app.focused":
    case "system.focus":
      return { doing: "Checking which window is open…", done: "Checked the open window" };
    case "app.open":
      return { doing: "Opening…", done: "Opened", detail: name(input.target ?? input.app ?? input.name) };
    case "keys.press":
      return { doing: "Pressing keys…", done: "Pressed", detail: clip(input.keys ?? input.combo) };
    case "text.insert":
      return { doing: "Typing…", done: "Typed", detail: `“${clip(input.text, 50)}”` };
    case "git.status":
      return { doing: "Checking git status…", done: "Checked git status" };
    case "git.diff":
      return { doing: "Reading the changes…", done: "Read the changes" };
    case "git.log":
      return { doing: "Reading the history…", done: "Read the git history" };
    case "net.port":
      return { doing: "Checking a port…", done: "Checked port", detail: clip(input.port) };
    case "proc.list":
      return { doing: "Listing running programs…", done: "Listed running programs" };
    case "clipboard.read":
      return { doing: "Reading the clipboard…", done: "Read the clipboard" };
    case "clipboard.write":
      return { doing: "Copying to the clipboard…", done: "Copied to the clipboard" };
    case "fs.exists":
      return { doing: "Checking a path…", done: "Checked", detail: name(input.path) };
    case "memory.save":
      return { doing: "Remembering…", done: "Remembered", detail: clip(input.fact, 70) };
    case "memory.forget":
      return { doing: "Forgetting…", done: "Forgot", detail: clip(input.about) };
    default: {
      const label = tool.replace(/^[^.]+\./, "").replace(/[_-]/g, " ");
      return { doing: `Using ${label}…`, done: `Used ${label}`, detail: Object.keys(input).length ? clip(Object.values(input)[0]) : undefined };
    }
  }
}

/** Pairs each call with its result, and drops the bookkeeping in between. */
function timeline(steps: AgentStep[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const step of steps) {
    if (step.kind === "tool") {
      out.push({ ...phrase(step.tool ?? step.text.split(" ")[0], step.input), state: "running" });
    } else if (step.kind === "result") {
      const last = [...out].reverse().find((i) => i.state === "running");
      if (last) {
        last.state = "ok";
        last.result = step.text;
        last.ms = step.ms;
      }
    } else if (step.kind === "error") {
      const last = [...out].reverse().find((i) => i.state === "running");
      if (last) {
        last.state = "error";
        last.done = `${last.done} (failed)`;
        last.detail = clip(step.text, 90);
      } else out.push({ doing: step.text, done: step.text, state: "error" });
    } else if (step.kind === "declined") {
      out.push({ doing: "Waiting for your approval…", done: "You declined", detail: clip(step.text, 70), state: "declined" });
    }
  }
  return out;
}
