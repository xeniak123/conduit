import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "./icons";
import { SPRING_SNAP } from "./motion";

/**
 * An error as a person would want to hear it: what happened, one thing to do
 * about it, and the raw message folded away for when someone asks for it.
 */
export function explain(raw: string): { title: string; hint: string } {
  const t = raw.toLowerCase();
  if (/llama-server|server program|runtime|llama\.cpp/.test(t))
    return { title: "The model runtime did not install properly.", hint: "Installing it again usually fixes this." };
  if (/out of memory|cudamalloc|cuda error|failed to allocate|oom/.test(t))
    return { title: "Not enough graphics memory for this model.", hint: "Pick a smaller quantization, or lower GPU layers in the Load options." };
  if (/did not start in time|stopped \(exit/.test(t))
    return { title: "The model stopped before it was ready.", hint: "It may be too large for this computer. A smaller file usually loads." };
  if (/rate-limit|rate limit|429|too many/.test(t))
    return { title: "Too many requests right now.", hint: "Wait a minute and try again." };
  if (/refused|401|403|invalid api key|unauthor/.test(t))
    return { title: "The key was not accepted.", hint: "Check it in the Model hub, under Cloud providers." };
  if (/gated|licen[cs]e/.test(t))
    return { title: "This model needs you to accept its licence.", hint: "Open it on huggingface.co, accept, and connect Hugging Face here." };
  if (/could not reach|unreachable|timed out|network|dns|connection/.test(t))
    return { title: "Could not connect.", hint: "Check the internet connection and try again." };
  if (/no space|disk full|not enough space/.test(t))
    return { title: "The disk is full.", hint: "Free some space, then try again." };
  if (/answered 404|not found/.test(t)) return { title: "That file is no longer where it was.", hint: "Try again; Conduit looks for the newest copy." };
  return { title: "Something went wrong.", hint: "Try again. If it keeps happening, the details below help." };
}

export function Problem({
  error,
  onRetry,
  retryLabel = "Try again",
  onDismiss,
}: {
  error: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { title, hint } = explain(error);
  return (
    <div className="problem" role="alert">
      <span className="problem__icon">!</span>
      <div className="problem__text">
        <b>{title}</b>
        <span>{hint}</span>
        <button className="problem__more" onPointerDown={() => setOpen(!open)}>
          {open ? "Hide details" : "Show details"}
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.pre
              className="problem__raw"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SNAP}
            >
              {error}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>
      <div className="problem__actions">
        {onRetry && (
          <button className="btn btn--small btn--ink" onPointerDown={onRetry}>
            <Icon.refresh /> {retryLabel}
          </button>
        )}
        {onDismiss && (
          <button className="btn btn--small" onPointerDown={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
