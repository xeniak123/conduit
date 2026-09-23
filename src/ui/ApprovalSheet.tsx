import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "@/core/store";
import { SPRING, materialize } from "./motion";

/**
 * The gate in front of anything destructive.
 *
 * It shows the verbatim command, never a paraphrase — a summary is how someone
 * ends up approving what they did not mean. Escape declines, so the safe answer
 * is the reflex, and the confirm button is never focused by surprise.
 */
export function ApprovalSheet() {
  const approval = useApp((s) => s.approval);
  const resolve = useApp((s) => s.resolveApproval);

  useEffect(() => {
    if (!approval) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        resolve(false);
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) resolve(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [approval, resolve]);

  return (
    <AnimatePresence>
      {approval && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          style={{ zIndex: 70 }}
        >
          <motion.div
            className="confirm"
            {...materialize}
            transition={SPRING}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm action"
          >
            <div className="confirm__head">Run this?</div>
            <pre className="confirm__cmd">{approval.summary}</pre>
            {approval.detail &&
              (isDiff(approval.detail) ? (
                <pre className="confirm__diff">
                  {approval.detail.split("\n").map((line, i) => (
                    <span key={i} data-kind={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : "same"}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              ) : (
                <div className="confirm__detail">{approval.detail}</div>
              ))}
            <div className="confirm__actions">
              <button className="btn" onPointerDown={() => resolve(false)}>
                Cancel
              </button>
              <button className="btn btn--accent" onPointerDown={() => resolve(true)}>
                Run it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A code edit's preview arrives as "- old" and "+ new" lines. */
function isDiff(detail: string): boolean {
  const lines = detail.split("\n");
  return lines.length > 1 && lines.every((l) => l.startsWith("- ") || l.startsWith("+ "));
}
