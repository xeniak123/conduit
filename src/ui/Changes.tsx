import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { readOrNull, undoCheckpoint, useCheckpoints, type FileSnapshot } from "@/core/checkpoints";
import { diffLines, hunks, stats, type DiffLine } from "@/core/diff";
import { Icon } from "./icons";
import { SPRING } from "./motion";

/**
 * What a reply did to your files, under the reply.
 *
 * Collapsed it is one line: how many files, how many lines in and out, and an
 * Undo. Opened, each file is a diff against what was there before the reply
 * started. The diffs are read when opened, not while the reply streams, so a
 * run that touches fifty files costs nothing until someone looks.
 */
export function Changes({ messageId, busy }: { messageId: string; busy: boolean }) {
  const checkpoint = useCheckpoints((s) => s.byMessage[messageId]);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [current, setCurrent] = useState<Record<string, string | null> | null>(null);

  const files = checkpoint?.files ?? [];
  const undone = checkpoint?.state === "undone";

  // Current contents are read when the review opens, and again whenever the
  // set of files changes while it is open.
  useEffect(() => {
    if (!open || !files.length) return;
    let live = true;
    void Promise.all(files.map(async (f) => [f.path, await readOrNull(f.path)] as const)).then((pairs) => {
      if (live) setCurrent(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [open, files, undone]);

  if (!files.length) return null;

  const undo = async () => {
    const { restored, failed } = await undoCheckpoint(messageId);
    setConfirming(false);
    setNote(
      failed.length
        ? `Put back ${restored} file${restored === 1 ? "" : "s"}. Could not restore: ${failed.join(", ")}`
        : `Put back ${restored} file${restored === 1 ? "" : "s"} the way they were before this reply.`,
    );
  };

  return (
    <div className="changes" data-undone={undone}>
      <div className="changes__bar">
        <button className="changes__toggle" aria-expanded={open} onPointerDown={() => setOpen(!open)}>
          <span className="changes__chev">
            <Icon.chevron />
          </span>
          <Icon.file />
          <span>
            {undone ? "Undone: " : "Changed "}
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </button>
        <span className="spacer" />
        {!undone && !busy && (
          <AnimatePresence mode="wait" initial={false}>
            {confirming ? (
              <motion.span key="ask" className="changes__confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span>Put every file back?</span>
                <button className="btn btn--small btn--danger" onPointerDown={() => void undo()}>
                  Undo changes
                </button>
                <button className="btn btn--small" onPointerDown={() => setConfirming(false)}>
                  Keep
                </button>
              </motion.span>
            ) : (
              <motion.button
                key="undo"
                className="btn btn--small"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onPointerDown={() => setConfirming(true)}
              >
                <Icon.refresh /> Undo
              </motion.button>
            )}
          </AnimatePresence>
        )}
      </div>

      {note && <div className="changes__note">{note}</div>}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="changes__files"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
          >
            {files.map((file) => (
              <FileDiff key={file.path} file={file} now={current ? current[file.path] : undefined} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileDiff({ file, now }: { file: FileSnapshot; now: string | null | undefined }) {
  const [open, setOpen] = useState(true);
  const lines = useMemo(
    () => (now === undefined || file.skipped ? null : diffLines(file.before ?? "", now ?? "")),
    [file.before, file.skipped, now],
  );
  const counts = lines ? stats(lines) : null;
  const parts = useMemo(() => (lines ? hunks(lines, 3) : []), [lines]);
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  const status = file.before === null ? "new" : now === null ? "deleted" : "edited";

  return (
    <div className="fdiff">
      <button className="fdiff__head" aria-expanded={open} onPointerDown={() => setOpen(!open)} title={file.path}>
        <b>{name}</b>
        <span className="fdiff__path">{file.path}</span>
        <span className="fdiff__status" data-status={status}>
          {status}
        </span>
        {counts && (
          <span className="fdiff__counts">
            <em className="fdiff__add">+{counts.added}</em>
            <em className="fdiff__del">−{counts.removed}</em>
          </span>
        )}
      </button>
      {open &&
        (file.skipped ? (
          <div className="fdiff__empty">Too large to keep a copy of, so this file cannot be undone from here.</div>
        ) : !lines ? (
          <div className="fdiff__empty">Reading…</div>
        ) : !parts.length ? (
          <div className="fdiff__empty">No difference any more.</div>
        ) : (
          <div className="fdiff__body">
            {parts.map((hunk, i) => (
              <div key={i} className="fdiff__hunk">
                {hunk.lines.map((line, j) => (
                  <Line key={j} line={line} />
                ))}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function Line({ line }: { line: DiffLine }) {
  return (
    <div className="fdiff__line" data-kind={line.kind}>
      <span className="fdiff__num">{line.old ?? ""}</span>
      <span className="fdiff__num">{line.new ?? ""}</span>
      <span className="fdiff__sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
      <code>{line.text || " "}</code>
    </div>
  );
}
