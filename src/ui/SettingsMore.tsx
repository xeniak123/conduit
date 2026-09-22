import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { saveSettings, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { parseExport } from "@/core/importers";
import { checkForUpdate, useUpdates } from "@/core/updates";
import { useApp } from "@/core/store";
import { applyTheme } from "@/core/theme";
import { Setting, Switch } from "./CompanionPage";
import { Icon } from "./icons";
import { SPRING_SNAP } from "./motion";

function usePatch() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  return {
    settings,
    patch(next: Partial<Settings>) {
      const merged = { ...settings, ...next } as Settings;
      setSettings(merged);
      void saveSettings(merged);
    },
  };
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2 className="sect__title">{title}</h2>
      <p className="sect__sub">{sub}</p>
    </>
  );
}

function Segmented<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className="seg__item" aria-current={value === v} onPointerDown={() => onChange(v)}>
          {value === v && <motion.span layoutId={`${id}-pill`} className="seg__pill" transition={SPRING_SNAP} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Appearance() {
  const { settings, patch } = usePatch();
  const a = settings.appearance;
  return (
    <section className="sect">
      <Head title="Appearance" sub="How Conduit looks on this computer." />
      <div className="card">
        <Setting label="Colour scheme" help="Light, dark, or follow your system.">
          <Segmented
            id="theme"
            value={a.theme}
            options={[
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ]}
            onChange={(theme) => {
              patch({ appearance: { ...a, theme } });
              applyTheme(theme);
            }}
          />
        </Setting>
        <Setting label="Density" help="Compact fits more on screen.">
          <Segmented
            id="density"
            value={a.density}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
            onChange={(density) => {
              patch({ appearance: { ...a, density } });
              document.documentElement.dataset.density = density;
            }}
          />
        </Setting>
        <Setting label="Reduce motion" help="Follows your system unless you choose otherwise.">
          <Segmented
            id="motion"
            value={a.motion}
            options={[
              ["system", "System"],
              ["full", "Full"],
              ["off", "Reduced"],
            ]}
            onChange={(motionPref) => {
              patch({ appearance: { ...a, motion: motionPref } });
              document.documentElement.dataset.motion = motionPref;
            }}
          />
        </Setting>
      </div>
    </section>
  );
}

const SHORTCUTS: Array<{ keys: string; what: string; where: string }> = [
  { keys: "Ctrl Alt Space", what: "Hold and speak a command", where: "Anywhere" },
  { keys: "Ctrl Alt D", what: "Hold and dictate into the field you are in", where: "Anywhere" },
  { keys: "Ctrl Alt K", what: "Quick question box", where: "Anywhere" },
  { keys: "Ctrl K", what: "Command palette", where: "Conduit" },
  { keys: "Ctrl N", what: "New chat", where: "Conduit" },
  { keys: "Ctrl ,", what: "Settings", where: "Conduit" },
  { keys: "Esc", what: "Stop the agent", where: "Conduit" },
  { keys: "/", what: "Saved prompts in the message box", where: "Chat" },
  { keys: "Shift Enter", what: "New line in a message", where: "Chat" },
];

export function Shortcuts() {
  const hotkeys = useApp((s) => s.settings.hotkeys);
  const rows = SHORTCUTS.map((s) =>
    s.what.startsWith("Hold and speak")
      ? { ...s, keys: hotkeys.command.replace(/\+/g, " ") }
      : s.what.startsWith("Hold and dictate")
        ? { ...s, keys: hotkeys.dictate.replace(/\+/g, " ") }
        : s,
  );
  return (
    <section className="sect">
      <Head title="Shortcuts" sub="The two voice keys can be changed in Voice." />
      <div className="card">
        {rows.map((s) => (
          <Setting key={s.what} label={s.what} help={s.where}>
            <span className="keys">
              {s.keys.split(" ").map((k) => (
                <span key={k} className="kbd">
                  {k}
                </span>
              ))}
            </span>
          </Setting>
        ))}
      </div>
    </section>
  );
}

export function DataSection() {
  const conversations = useApp((s) => s.conversations);
  const hydrate = useApp((s) => s.hydrate);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ version: 1, conversations }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conduit-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${conversations.length} chats.`);
  };

  const importFile = async (file: File) => {
    try {
      const { source, conversations: found } = parseExport(JSON.parse(await file.text()));
      if (!found.length) {
        setMessage("No chats found in that file. Pick conversations.json from a ChatGPT or Claude export.");
        return;
      }
      const known = new Set(conversations.map((c) => c.id));
      const merged = [...conversations, ...found.filter((c) => !known.has(c.id))].sort((a, b) => b.at - a.at);
      hydrate(merged);
      const from = source === "chatgpt" ? " from ChatGPT" : source === "claude" ? " from Claude" : "";
      setMessage(`Imported ${merged.length - conversations.length} chats${from}.`);
    } catch {
      setMessage("That file is not JSON. Unzip the export first and pick conversations.json.");
    }
  };

  return (
    <section className="sect">
      <Head title="Data" sub="Everything Conduit keeps lives on this computer." />
      <div className="card">
        <Setting label="Export chats" help={`All ${conversations.length} conversations as one JSON file.`}>
          <button className="btn" onPointerDown={exportAll}>
            <Icon.download /> Export
          </button>
        </Setting>
        <Setting
          label="Import chats"
          help="From ChatGPT (Settings, Data controls, Export), Claude (Settings, Privacy, Export data) or Conduit. Unzip the export and pick conversations.json."
        >
          <label className="btn">
            Import
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </Setting>
        <Setting label="Data folder" help="Models, extensions, pets and the audit log.">
          <button
            className="btn"
            disabled={!isTauri()}
            onPointerDown={async () => {
              const dir = await invoke<string>("data_dir");
              await invoke("open_target", { target: dir }).catch(() => undefined);
            }}
          >
            Open
          </button>
        </Setting>
        <Setting label="Delete all chats" help="Cannot be undone. Export first if you might want them.">
          {confirm ? (
            <>
              <button
                className="btn btn--danger"
                onPointerDown={() => {
                  hydrate([]);
                  useApp.getState().ensureConversation();
                  setConfirm(false);
                  setMessage("All chats deleted.");
                }}
              >
                Delete {conversations.length} chats
              </button>
              <button className="btn" onPointerDown={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn--danger" onPointerDown={() => setConfirm(true)}>
              Delete all
            </button>
          )}
        </Setting>
      </div>
      {message && <div className="result">{message}</div>}
    </section>
  );
}

export function About() {
  const { settings, patch } = usePatch();
  const updates = useUpdates();
  return (
    <section className="sect">
      <Head title="About" sub="Conduit is open source under the MIT licence." />
      <div className="card">
        <Setting
          label="Version"
          help={`0.3.0 · ${updates.checking ? "checking…" : updates.available ? `${updates.available.version} is available` : updates.error ? "could not check for updates" : updates.checkedAt ? "up to date" : "updates are checked automatically"}`}
        >
          <button className="btn" disabled={updates.checking} onPointerDown={() => void checkForUpdate()}>
            <Icon.refresh /> Check for updates
          </button>
        </Setting>
        <Setting label="Help improve the pet library" help="Pets and skills come from a public repository anyone can contribute to.">
          <a className="btn" href="https://github.com/xeniak123/conduit/tree/main/registry" target="_blank" rel="noreferrer">
            <Icon.external /> Registry
          </a>
        </Setting>
        <Setting label="Show setup again" help="Walk through keys, microphone and hotkeys.">
          <button
            className="btn"
            onPointerDown={() => {
              useApp.getState().setSettingsOpen(false);
              useApp.getState().setOnboarding(true);
            }}
          >
            Run setup
          </button>
        </Setting>
        <Setting label="Keep a record of every action" help="Each tool call is written to an audit log you can review and export.">
          <Switch checked={settings.auditLog} onChange={(auditLog) => patch({ auditLog })} />
        </Setting>
      </div>
    </section>
  );
}

export function MemorySection() {
  const { settings, patch } = usePatch();
  const [draft, setDraft] = useState("");
  const memories = settings.memories ?? [];
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    patch({ memories: [{ id: crypto.randomUUID(), text, at: Date.now() }, ...memories] });
    setDraft("");
  };
  return (
    <section className="sect">
      <Head title="Memory" sub="Things Conduit remembers about you across every chat. Tell it “remember that…” or add them here." />
      <div className="card">
        <Setting label="Let Conduit remember things" help="When you mention something lasting, it can save it. Every memory is listed below.">
          <Switch checked={settings.autoMemory} onChange={(autoMemory) => patch({ autoMemory })} />
        </Setting>
        <Setting label="Add a memory">
          <input
            className="input"
            placeholder="I write TypeScript and prefer short answers"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn" disabled={!draft.trim()} onPointerDown={add}>
            Add
          </button>
        </Setting>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {memories.length === 0 && <Setting label="Nothing remembered yet." />}
        {memories.map((m) => (
          <Setting key={m.id} label={m.text} help={new Date(m.at).toLocaleDateString()}>
            <button
              className="btn btn--small"
              onPointerDown={() => patch({ memories: memories.filter((x) => x.id !== m.id) })}
            >
              Forget
            </button>
          </Setting>
        ))}
      </div>
    </section>
  );
}
