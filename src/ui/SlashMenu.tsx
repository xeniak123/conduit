import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { variablesIn, type Prompt } from "@/core/prompts";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * The `/` menu.
 *
 * Anchored above the composer rather than dropped below it, because the
 * composer already sits at the bottom of the window — a list that opened
 * downward would be clipped by the frame on every use.
 */
export function SlashMenu({
  query,
  results,
  onPick,
  onClose,
}: {
  query: string | null;
  results: Prompt[];
  onPick: (prompt: Prompt) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [query]);

  // Arrow keys and Enter belong to this menu while it is open, so it listens
  // in the capture phase and takes them before the textarea sees them.
  useEffect(() => {
    if (query === null || results.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.max(i - 1, 0));
      } else if ((e.key === "Enter" || e.key === "Tab") && results[index]) {
        e.preventDefault();
        e.stopPropagation();
        onPick(results[index]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [query, results, index, onPick, onClose]);

  return (
    <AnimatePresence>
      {query !== null && results.length > 0 && (
        <motion.div
          className="slash"
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          transition={SPRING}
        >
          <div className="slash__head">
            <Icon.sparkle />
            Prompts
            <span className="spacer" />
            <span className="slash__hint">↑↓ to choose · Enter to use</span>
          </div>

          {results.map((prompt, i) => (
            <button
              key={prompt.id}
              className="slash__item"
              aria-selected={i === index}
              onPointerEnter={() => setIndex(i)}
              onPointerDown={() => onPick(prompt)}
            >
              {i === index && (
                <motion.span layoutId="slash-pill" className="slash__pill" transition={SPRING_SNAP} />
              )}
              <span className="slash__row">
                <code className="slash__trigger">/{prompt.trigger}</code>
                <span className="slash__title">{prompt.title}</span>
                <span className="slash__meta">
                  {variablesIn(prompt.body).length > 0 && (
                    <span className="slash__vars">
                      {variablesIn(prompt.body).length} field
                      {variablesIn(prompt.body).length === 1 ? "" : "s"}
                    </span>
                  )}
                  {prompt.hint}
                </span>
              </span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Collects `{{placeholders}}` before the prompt is sent.
 *
 * A template that silently sends with empty holes produces a confusing reply
 * and teaches people not to trust the library.
 */
export function PromptFields({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: Prompt | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const fields = useMemo(() => (prompt ? variablesIn(prompt.body) : []), [prompt]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => setValues({}), [prompt]);

  const complete = fields.every((f) => (values[f] ?? "").trim().length > 0);

  return (
    <AnimatePresence>
      {prompt && fields.length > 0 && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ zIndex: 75 }}
          onPointerDown={onCancel}
        >
          <motion.div
            className="confirm"
            initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
            transition={SPRING}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="confirm__head">{prompt.title}</div>
            <div className="fields">
              {fields.map((field, i) => (
                <label className="field" key={field}>
                  <span className="field__name">{field}</span>
                  <input
                    type="text"
                    autoFocus={i === 0}
                    value={values[field] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && complete) onSubmit(values);
                      if (e.key === "Escape") onCancel();
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="confirm__actions">
              <button className="btn" onPointerDown={onCancel}>
                Cancel
              </button>
              <button
                className="btn btn--accent"
                disabled={!complete}
                onPointerDown={() => onSubmit(values)}
              >
                Run
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
