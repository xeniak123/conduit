import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { setComputerUseEnabled } from "@/computer";
import { saveSettings } from "@/core/config";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: keyof typeof Icon;
  run: () => void;
}

/**
 * Ctrl+K.
 *
 * Every keyboard-first desktop tool has one, and it is the difference between
 * an app you click around and an app you drive. It also means features do not
 * have to fight for a place in the chrome: anything reachable here can stay
 * out of the sidebar.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const store = useApp();

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "new",
        label: "New chat",
        hint: "Ctrl+N",
        icon: "plus",
        run: () => store.newConversation(),
      },
      {
        id: "settings",
        label: "Open settings",
        hint: "Ctrl+,",
        icon: "settings",
        run: () => store.setSettingsOpen(true),
      },
      {
        id: "screen",
        label: store.settings.computerUse.enabled
          ? "Turn off screen control"
          : "Turn on screen control",
        hint: "Beta",
        icon: "display",
        run: () => {
          const enabled = !store.settings.computerUse.enabled;
          const next = {
            ...store.settings,
            computerUse: { ...store.settings.computerUse, enabled },
          };
          store.setSettings(next);
          void saveSettings(next);
          setComputerUseEnabled(enabled);
        },
      },
      {
        id: "theme",
        label: store.settings.appearance.theme === "dark" ? "Switch to light" : "Switch to dark",
        icon: "sparkle",
        run: () => {
          const theme: "dark" | "light" =
            store.settings.appearance.theme === "dark" ? "light" : "dark";
          const next = { ...store.settings, appearance: { ...store.settings.appearance, theme } };
          store.setSettings(next);
          void saveSettings(next);
          document.documentElement.dataset.theme = theme;
        },
      },
    ];

    // Recent chats are commands too — jumping to one by name beats scanning
    // a sidebar once there are more than a handful.
    for (const convo of store.conversations.slice(0, 8)) {
      list.push({
        id: `go:${convo.id}`,
        label: convo.title,
        hint: "Chat",
        icon: "sparkle",
        run: () => store.selectConversation(convo.id),
      });
    }

    return list;
  }, [store]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIndex(0);
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        store.newConversation();
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        store.setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const commit = (command: Command) => {
    command.run();
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim scrim--top"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: -12, scale: 0.98, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(6px)" }}
            transition={SPRING}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="palette__field">
              <Icon.sparkle />
              <input
                ref={inputRef}
                className="palette__input"
                placeholder="Search commands and chats"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIndex((i) => Math.min(i + 1, results.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndex((i) => Math.max(i - 1, 0));
                  }
                  if (e.key === "Enter" && results[index]) commit(results[index]);
                  if (e.key === "Escape") setOpen(false);
                }}
              />
              <span className="kbd">Esc</span>
            </div>

            <div className="palette__list">
              {results.length === 0 && <div className="palette__empty">Nothing matches.</div>}
              {results.map((command, i) => {
                const Glyph = Icon[command.icon];
                return (
                  <button
                    key={command.id}
                    className="palette__item"
                    aria-selected={i === index}
                    onPointerEnter={() => setIndex(i)}
                    onPointerDown={() => commit(command)}
                  >
                    {i === index && (
                      <motion.span
                        layoutId="palette-pill"
                        className="palette__pill"
                        transition={SPRING_SNAP}
                      />
                    )}
                    <span className="palette__row">
                      <Glyph />
                      <span className="palette__label">{command.label}</span>
                      {command.hint && <span className="palette__hint">{command.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
