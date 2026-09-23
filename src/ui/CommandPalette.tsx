import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { setComputerUseEnabled } from "@/computer";
import { saveSettings } from "@/core/config";
import { contenders } from "@/core/arena";
import { runTask } from "@/core/schedule";
import { applyTheme } from "@/core/theme";
import { useApp, type Page } from "@/core/store";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

interface Command {
  id: string;
  group: string;
  /** Extra text to search, e.g. a chat's messages. */
  haystack?: string;
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
    const s = store.settings;
    const save = (next: typeof s) => {
      store.setSettings(next);
      void saveSettings(next);
    };
    const list: Command[] = [
      { id: "new", group: "Actions", label: "New chat", hint: "Ctrl+N", icon: "plus", run: () => store.newConversation() },
      {
        id: "search",
        group: "Actions",
        label: s.webSearch !== false ? "Turn off web search" : "Turn on web search",
        icon: "globe",
        run: () => save({ ...s, webSearch: s.webSearch === false }),
      },
      {
        id: "code",
        group: "Actions",
        label: s.code.enabled ? "Turn off Code mode" : "Turn on Code mode",
        icon: "wrench",
        run: () => save({ ...s, code: { ...s.code, enabled: !s.code.enabled } }),
      },
      {
        id: "screen",
        group: "Actions",
        label: s.computerUse.enabled ? "Turn off screen control" : "Turn on screen control",
        icon: "display",
        run: () => {
          const enabled = !s.computerUse.enabled;
          save({ ...s, computerUse: { ...s.computerUse, enabled } });
          setComputerUseEnabled(enabled);
        },
      },
      {
        id: "auto",
        group: "Actions",
        label: s.router?.enabled ? "Turn off Auto model choice" : "Turn on Auto model choice",
        icon: "bolt",
        run: () => save({ ...s, router: { ...s.router, enabled: !s.router?.enabled, strong: s.router?.strong ?? s.command } }),
      },
      {
        id: "theme",
        group: "Actions",
        // What is on screen, not what is saved: with "system" saved, the
        // label used to offer dark while the app was already dark.
        label: document.documentElement.dataset.theme === "dark" ? "Switch to light" : "Switch to dark",
        icon: "sparkle",
        run: () => {
          const theme: "dark" | "light" = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
          save({ ...s, appearance: { ...s.appearance, theme } });
          applyTheme(theme);
        },
      },
    ];

    const pages: Array<[Page, string, keyof typeof Icon]> = [
      ["models", "Model hub", "grid"],
      ["arena", "Arena", "chart"],
      ["tune", "Train", "brain"],
      ["projects", "Projects", "folder"],
      ["scheduled", "Scheduled", "clock"],
      ["agents", "Agents", "terminal"],
      ["decide", "Decisions", "bolt"],
      ["store", "Store", "store"],
      ["companion", "Companion", "sparkle"],
      ["api", "API", "plug"],
    ];
    for (const [page, label, icon] of pages) {
      list.push({ id: `page:${page}`, group: "Go to", label, icon, run: () => store.setPage(page) });
    }

    const sections: Array<[string, string]> = [
      ["general", "General"],
      ["appearance", "Appearance"],
      ["voice", "Voice"],
      ["models", "Dictation model"],
      ["permissions", "Tools and safety"],
      ["memory", "Memory"],
      ["prompts", "Saved prompts"],
      ["shortcuts", "Shortcuts"],
      ["usage", "Usage and spend"],
      ["data", "Data, import and export"],
      ["about", "About and updates"],
    ];
    for (const [id, label] of sections) {
      list.push({ id: `set:${id}`, group: "Settings", label: `Settings: ${label}`, icon: "settings", run: () => store.openSettingsAt(id) });
    }

    for (const m of contenders(s)) {
      list.push({
        id: `model:${m.provider}:${m.model}`,
        group: "Models",
        label: `Use ${m.model}`,
        hint: m.label,
        icon: "cpu",
        run: () => save({ ...s, command: { provider: m.provider, model: m.model }, router: { ...s.router, enabled: false } }),
      });
    }

    for (const p of s.projects) {
      list.push({
        id: `project:${p.id}`,
        group: "Projects",
        label: `New chat in ${p.name}`,
        icon: "folder",
        run: () => {
          save({ ...s, activeProjectId: p.id });
          store.newConversation(p.id);
        },
      });
    }

    for (const t of s.schedules ?? []) {
      list.push({ id: `task:${t.id}`, group: "Scheduled", label: `Run “${t.name}” now`, icon: "clock", run: () => void runTask(t) });
    }

    for (const convo of store.conversations) {
      if (!convo.messages.length) continue;
      list.push({
        id: `go:${convo.id}`,
        group: "Chats",
        label: convo.title,
        hint: "Chat",
        icon: "compose",
        // The whole chat is searchable, not only its title.
        haystack: convo.messages.map((m) => m.text).join(" ").slice(0, 20_000).toLowerCase(),
        run: () => store.selectConversation(convo.id),
      });
    }

    return list;
  }, [store]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const chats = commands.filter((c) => c.group === "Chats").slice(0, 6);
      return [...commands.filter((c) => c.group === "Actions" || c.group === "Go to"), ...chats];
    }
    const score = (c: Command) => {
      const label = c.label.toLowerCase();
      if (label.startsWith(q)) return 3;
      if (label.includes(q)) return 2;
      if (q.length >= 3 && c.haystack?.includes(q)) return 1;
      return 0;
    };
    return commands
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
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
                placeholder="Search chats, models, pages, settings…"
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
                const header = i === 0 || results[i - 1].group !== command.group ? command.group : null;
                return (
                  <div key={command.id}>
                  {header && <div className="palette__group">{header}</div>}
                  <button
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
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
