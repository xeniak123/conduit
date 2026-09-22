import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { sendMessage } from "@/core/chat";
import type { ChatMessage } from "@/core/store";
import { formatCost } from "@/core/usage";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { Markdown } from "./Markdown";
import { SPRING, SPRING_SNAP, riseIn } from "./motion";

export function Message({ message }: { message: ChatMessage }) {
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
          <div className="bubble">{message.text}</div>
          <div className="msg__actions" style={{ justifyContent: "flex-end" }}>
            <Action label="Copy" onAct={() => copy(message.text)} icon="file" />
            <Action label="Send again" onAct={() => void sendMessage(message.text)} icon="sparkle" />
          </div>
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

          {message.steps.length > 0 && <Activity message={message} />}

          {!message.pending && message.text && (
            <>
              <div className="msg__actions">
                <Action label="Copy" onAct={() => copy(message.text)} icon="file" />
              </div>
              {(message.cost ?? 0) > 0 && (
                <div className="msg__meta">
                  <span>{formatCost(message.cost ?? 0)}</span>
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
          ? `Working · ${toolSteps} step${toolSteps === 1 ? "" : "s"}`
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
              {message.steps.map((step, i) => (
                <motion.div
                  key={i}
                  className={`step step--${step.kind}`}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={SPRING_SNAP}
                >
                  <span className="step__dot" />
                  <span className="step__text">{step.text}</span>
                </motion.div>
              ))}

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
}: {
  label: string;
  icon: keyof typeof Icon;
  onAct: () => void;
}) {
  const [done, setDone] = useState(false);
  const Glyph = done ? Icon.check : Icon[icon];

  return (
    <button
      className="msg__action"
      onPointerDown={() => {
        onAct();
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
