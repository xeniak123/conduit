import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { saveSettings, type Project } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { SPRING } from "./motion";

/**
 * Projects: a folder, some standing instructions, and the chats about it.
 *
 * Opening a project makes it the working directory for every tool, so "run the
 * tests" and "what changed" mean something without naming a path. Conduit
 * reads the folder when it is added and fills in what it can recognise —
 * which stack, which test command — so the first chat already knows.
 */

const COLOURS = ["#ff7a1a", "#3d7bff", "#20b486", "#a36bff", "#f0487a", "#e3a008", "#1fb5d6", "#6b6b76"];

type Sort = "activity" | "name";

export function ProjectsPage() {
  const settings = useApp((s) => s.settings);
  const conversations = useApp((s) => s.conversations);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("activity");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = settings.projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q))
      .map((p) => {
        const chats = conversations.filter((c) => c.projectId === p.id && c.messages.length > 0);
        const last = chats.reduce((max, c) => Math.max(max, c.at), 0);
        return { project: p, chats, last };
      });
    return list.sort((a, b) => (sort === "name" ? a.project.name.localeCompare(b.project.name) : b.last - a.last));
  }, [settings.projects, conversations, query, sort]);

  const current = settings.projects.find((p) => p.id === open) ?? null;

  return (
    <div className="page">
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 14 }}
            transition={SPRING}
          >
            <ProjectDetail project={current} onBack={() => setOpen(null)} />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={SPRING}
          >
            <header className="page__head">
              <div>
                <h1 className="page__title">Projects</h1>
                <p className="page__sub">A folder, standing instructions, and every chat about it in one place.</p>
              </div>
              <div className="page__tools">
                <label className="searchbox searchbox--compact">
                  <Icon.search />
                  <input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="activity">Recent activity</option>
                  <option value="name">Name</option>
                </select>
                <button className="btn btn--ink" onPointerDown={() => setCreating(true)}>
                  <Icon.plus /> New project
                </button>
              </div>
            </header>

            {rows.length === 0 ? (
              <div className="emptycard emptycard--tall">
                <div className="emptycard__art">
                  <Icon.folder />
                </div>
                <b>{query ? "No project matches that" : "No projects yet"}</b>
                <span>Point Conduit at a folder and every chat in it knows where to work.</span>
                {!query && (
                  <button className="btn btn--ink" onPointerDown={() => setCreating(true)}>
                    Create your first project
                  </button>
                )}
              </div>
            ) : (
              <div className="projects">
                {rows.map(({ project, chats, last }, i) => (
                  <motion.button
                    key={project.id}
                    className="project"
                    onPointerDown={() => setOpen(project.id)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: i * 0.03 }}
                    whileHover={{ y: -2 }}
                  >
                    <span className="project__band" style={{ background: project.colour }} />
                    <span className="project__icon" style={{ color: project.colour }}>
                      <Icon.folder />
                    </span>
                    <b className="project__name">{project.name}</b>
                    <span className="project__path">{project.root}</span>
                    <span className="project__meta">
                      <span>
                        {chats.length} chat{chats.length === 1 ? "" : "s"}
                      </span>
                      {last > 0 && <span>{relative(last)}</span>}
                      {settings.activeProjectId === project.id && <span className="tag tag--on">Active</span>}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{creating && <CreateProject onClose={(id) => { setCreating(false); if (id) setOpen(id); }} />}</AnimatePresence>
    </div>
  );
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const conversations = useApp((s) => s.conversations);
  const newChat = useApp((s) => s.newConversation);
  const select = useApp((s) => s.selectConversation);
  const [brief, setBrief] = useState(project.brief);
  const [confirm, setConfirm] = useState(false);
  const [stack, setStack] = useState<Detected | null>(null);

  const chats = conversations.filter((c) => c.projectId === project.id && c.messages.length > 0);
  const active = settings.activeProjectId === project.id;

  useEffect(() => {
    void detect(project.root).then(setStack);
  }, [project.root]);

  const patch = async (next: Partial<Project>) => {
    const s = {
      ...settings,
      projects: settings.projects.map((p) => (p.id === project.id ? { ...p, ...next } : p)),
    };
    setSettings(s);
    await saveSettings(s);
  };

  const activate = async () => {
    const s = {
      ...settings,
      activeProjectId: project.id,
      code: stack?.test && !settings.code.testCommand ? { ...settings.code, testCommand: stack.test } : settings.code,
    };
    setSettings(s);
    await saveSettings(s);
  };

  const startChat = async () => {
    await activate();
    newChat(project.id);
  };

  const remove = async () => {
    const s = {
      ...settings,
      projects: settings.projects.filter((p) => p.id !== project.id),
      activeProjectId: settings.activeProjectId === project.id ? null : settings.activeProjectId,
    };
    setSettings(s);
    await saveSettings(s);
    onBack();
  };

  return (
    <div className="pdetail">
      <div className="crumbs">
        <button className="iconbtn" aria-label="Back to projects" onPointerDown={onBack}>
          <Icon.arrowLeft />
        </button>
        <span>Projects</span>
        <span className="crumbs__sep">/</span>
        <b>{project.name}</b>
      </div>

      <header className="pdetail__head">
        <span className="pdetail__icon" style={{ background: project.colour }}>
          <Icon.folder />
        </span>
        <div className="pdetail__title">
          <h1 className="page__title">{project.name}</h1>
          <code>{project.root}</code>
        </div>
        <span className="spacer" />
        {!active && (
          <button className="btn" onPointerDown={() => void activate()}>
            Make active
          </button>
        )}
        <button className="btn btn--ink" onPointerDown={() => void startChat()}>
          <Icon.compose /> New chat here
        </button>
      </header>

      {stack && (stack.kinds.length > 0 || stack.test) && (
        <div className="detected">
          {stack.kinds.map((k) => (
            <span key={k} className="pill">
              {k}
            </span>
          ))}
          {stack.test && (
            <span className="pill pill--quiet">
              Tests: <code>{stack.test}</code>
            </span>
          )}
          {stack.git && <span className="pill pill--quiet">git</span>}
        </div>
      )}

      <div className="pgrid">
        <section className="card">
          <div className="card__row card__row--top">
            <div className="card__text">
              <b>Chats</b>
              <span>{chats.length ? `${chats.length} in this project` : "None yet."}</span>
            </div>
          </div>
          <div className="pchats">
            {chats.map((c) => (
              <button key={c.id} className="pchat" onPointerDown={() => select(c.id)}>
                <Icon.compose />
                <span className="pchat__title">{c.title}</span>
                <span className="pchat__age">{relative(c.at)}</span>
              </button>
            ))}
            {chats.length === 0 && (
              <button className="linkbtn" onPointerDown={() => void startChat()}>
                Start the first one
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card__row card__row--top">
            <div className="card__text">
              <b>Instructions</b>
              <span>Sent with every chat in this project.</span>
            </div>
          </div>
          <textarea
            className="textarea"
            rows={7}
            placeholder={"Conventions, how to run things, what to leave alone.\nFor example: use pnpm; never edit files under /generated."}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onBlur={() => void patch({ brief })}
          />
          <div className="card__row">
            <div className="card__text">
              <b>Colour</b>
            </div>
            <div className="swatches">
              {COLOURS.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  aria-label={`Colour ${c}`}
                  aria-pressed={project.colour === c}
                  style={{ background: c }}
                  onPointerDown={() => void patch({ colour: c })}
                />
              ))}
            </div>
          </div>
          <div className="card__row">
            <button
              className="btn btn--small"
              onPointerDown={() => void invoke("open_target", { target: project.root }).catch(() => undefined)}
            >
              <Icon.external /> Open folder
            </button>
            <span className="spacer" />
            {confirm ? (
              <>
                <button className="btn btn--danger btn--small" onPointerDown={() => void remove()}>
                  Remove project
                </button>
                <button className="btn btn--small" onPointerDown={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="linkbtn linkbtn--danger" onPointerDown={() => setConfirm(true)}>
                Remove from Conduit
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CreateProject({ onClose }: { onClose: (id?: string) => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [colour, setColour] = useState(COLOURS[settings.projects.length % COLOURS.length]);
  const [exists, setExists] = useState<boolean | null>(null);
  const [stack, setStack] = useState<Detected | null>(null);

  useEffect(() => {
    if (!root.trim() || !isTauri()) {
      setExists(null);
      setStack(null);
      return;
    }
    const t = window.setTimeout(() => {
      void invoke<boolean>("fs_exists", { path: root.trim() }).then((ok) => {
        setExists(ok);
        if (ok) {
          void detect(root.trim()).then(setStack);
          if (!name.trim()) setName(root.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
        } else {
          setStack(null);
        }
      });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const create = async () => {
    if (!name.trim() || !root.trim()) return;
    if (exists === false) await invoke("fs_mkdir", { path: root.trim() }).catch(() => undefined);
    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      root: root.trim(),
      brief: "",
      colour,
    };
    const next = { ...settings, projects: [...settings.projects, project] };
    setSettings(next);
    await saveSettings(next);
    onClose(project.id);
  };

  return (
    <motion.div
      className="dialog-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={() => onClose()}
    >
      <motion.div
        className="dialog"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="dialog__title">New project</h2>
        <label className="form">
          <span>Folder</span>
          <input
            className="input input--mono"
            autoFocus
            placeholder="C:\Users\you\code\website  or  ~/code/website"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
          <em className={exists === false ? "form__hint form__hint--warn" : "form__hint"}>
            {exists === null
              ? "Where commands run and files are read."
              : exists
                ? stack?.kinds.length
                  ? `Found: ${stack.kinds.join(", ")}.`
                  : "Folder found."
                : "That folder does not exist yet. It will be created."}
          </em>
        </label>
        <label className="form">
          <span>Name</span>
          <input className="input" placeholder="Website" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="form">
          <span>Colour</span>
          <div className="swatches">
            {COLOURS.map((c) => (
              <button
                key={c}
                className="swatch"
                aria-label={`Colour ${c}`}
                aria-pressed={colour === c}
                style={{ background: c }}
                onPointerDown={() => setColour(c)}
              />
            ))}
          </div>
        </div>
        <div className="dialog__foot">
          <button className="btn" onPointerDown={() => onClose()}>
            Cancel
          </button>
          <button className="btn btn--ink" disabled={!name.trim() || !root.trim()} onPointerDown={() => void create()}>
            Create project
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface Detected {
  kinds: string[];
  test: string | null;
  git: boolean;
}

/** Recognises a project from the files at its root. */
async function detect(root: string): Promise<Detected> {
  if (!isTauri()) return { kinds: [], test: null, git: false };
  const entries = await invoke<Array<{ name: string }>>("fs_list", { path: root }).catch(() => []);
  const names = new Set(entries.map((e) => e.name));
  const kinds: string[] = [];
  let test: string | null = null;

  if (names.has("package.json")) {
    kinds.push(names.has("tsconfig.json") ? "TypeScript" : "JavaScript");
    const pkg = await invoke<string>("fs_read", { path: `${root}/package.json`, limit: 100_000 }).catch(() => "");
    try {
      const json = JSON.parse(pkg) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...json.dependencies, ...json.devDependencies };
      if (deps.react) kinds.push("React");
      if (deps.next) kinds.push("Next.js");
      if (deps.vue) kinds.push("Vue");
      if (deps.svelte) kinds.push("Svelte");
      if (deps["@tauri-apps/api"]) kinds.push("Tauri");
      const runner = names.has("pnpm-lock.yaml") ? "pnpm" : names.has("yarn.lock") ? "yarn" : names.has("bun.lockb") ? "bun" : "npm";
      if (json.scripts?.test) test = `${runner} ${runner === "npm" ? "test" : "test"}`;
    } catch {
      /* unreadable package.json: still a JavaScript project */
    }
  }
  if (names.has("Cargo.toml")) {
    kinds.push("Rust");
    test ??= "cargo test";
  }
  if (names.has("pyproject.toml") || names.has("requirements.txt")) {
    kinds.push("Python");
    test ??= "pytest";
  }
  if (names.has("go.mod")) {
    kinds.push("Go");
    test ??= "go test ./...";
  }
  return { kinds, test, git: names.has(".git") };
}

function relative(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
