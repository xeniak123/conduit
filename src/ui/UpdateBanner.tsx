import { AnimatePresence, motion } from "motion/react";
import { installUpdate, useUpdates } from "@/core/updates";
import { SPRING } from "./motion";

/** A quiet card in the corner when a new version is ready. */
export function UpdateBanner() {
  const available = useUpdates((s) => s.available);
  const progress = useUpdates((s) => s.progress);
  const error = useUpdates((s) => s.error);
  return (
    <AnimatePresence>
      {available && (
        <motion.div
          className="update"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={SPRING}
        >
          <b>Conduit {available.version} is ready</b>
          <span>{error ? error : progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : "Installs in a few seconds and reopens where you were."}</span>
          <div className="update__row">
            <button className="btn btn--small" onPointerDown={() => useUpdates.setState({ available: null })}>
              Later
            </button>
            <button className="btn btn--small btn--ink" disabled={progress !== null} onPointerDown={() => void installUpdate()}>
              Update now
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
