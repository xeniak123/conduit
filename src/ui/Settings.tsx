import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";

import { exportCsv, readAudit } from "@/core/audit";
import {
  PROFILES,
  saveSettings,
  type ProviderId,
  type Settings as Conf,
} from "@/core/config";
import { clearKey, keyKnown, refreshKeyStatus, saveKey } from "@/core/secrets";
import { BUILTIN_PROMPTS, variablesIn, type Prompt } from "@/core/prompts";
import { useApp } from "@/core/store";
import { formatCost, formatTokens, summarise } from "@/core/usage";
import { PROVIDER_CATALOG } from "@/llm";
import { STT_CATALOG } from "@/stt";
import { listTools } from "@/tools/registry";
import { Icon } from "./icons";
import { LocalSpeech } from "./LocalSpeech";
import { About, Appearance, DataSection, MemorySection, Shortcuts } from "./SettingsMore";
import { VoiceCheck } from "./VoiceCheck";
import { SPRING, SPRING_SNAP, materialize } from "./motion";

type Section =
  | "general"
  | "appearance"
  | "voice"
  | "models"
  | "permissions"
  | "prompts"
  | "shortcuts"
  | "usage"
  | "data"
  | "memory"
  | "about";

/** Keywords make the search find a setting by what it does, not only by its section's name. */
const SECTIONS: Array<{ id: Section; label: string; icon: keyof typeof Icon; keywords: string }> = [
  { id: "general", label: "General", icon: "settings", keywords: "audit log tray setup onboarding start" },
  { id: "appearance", label: "Appearance", icon: "sparkle", keywords: "theme dark light density motion animation" },
  { id: "voice", label: "Voice", icon: "mic", keywords: "microphone dictation hotkey whisper speech transcription local language" },
  { id: "models", label: "Models", icon: "cpu", keywords: "provider key api anthropic openai openrouter model dictation" },
  { id: "permissions", label: "Tools and safety", icon: "shield", keywords: "approve confirm ask tools safety code tests screen computer use cursor audit" },
  { id: "prompts", label: "Prompts", icon: "book", keywords: "templates slash saved" },
  { id: "shortcuts", label: "Shortcuts", icon: "bolt", keywords: "keyboard keys hotkeys" },
  { id: "usage", label: "Usage", icon: "chart", keywords: "cost spend tokens budget" },
  { id: "memory", label: "Memory", icon: "brain", keywords: "remember memories personal facts about me" },
  { id: "data", label: "Data", icon: "folder", keywords: "export import history delete chats backup chatgpt claude" },
  { id: "about", label: "About", icon: "globe", keywords: "version licence updates" },
];

export function Settings() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>("general");
  const [query, setQuery] = useState("");
  const wanted = useApp((s) => s.settingsSection);

  // Pages deep-link into a section ("set up voice", "add a key").
  useEffect(() => {
    if (open && wanted && SECTIONS.some((x) => x.id === wanted)) setSection(wanted as Section);
  }, [open, wanted]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? SECTIONS.filter((x) => x.label.toLowerCase().includes(q) || x.keywords.includes(q))
    : SECTIONS;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.div
            className="modal"
            {...materialize}
            transition={SPRING}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <nav className="modal__nav">
              <label className="searchbox searchbox--nav">
                <Icon.search />
                <input
                  placeholder="Search settings"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    const needle = e.target.value.trim().toLowerCase();
                    const first = SECTIONS.find(
                      (x) => x.label.toLowerCase().includes(needle) || x.keywords.includes(needle),
                    );
                    if (needle && first) setSection(first.id);
                  }}
                />
              </label>
              <div className="settings-label">Settings</div>
              {visible.length === 0 && <div className="settings-label">Nothing matches.</div>}
              {visible.map((s) => {
                const Glyph = Icon[s.icon];
                const active = section === s.id;
                return (
                  <button
                    key={s.id}
                    className="modal__navitem"
                    aria-current={active}
                    onPointerDown={() => setSection(s.id)}
                  >
                    {active && (
                      <motion.span
                        layoutId="settings-pill"
                        className="convo__pill"
                        transition={SPRING}
                      />
                    )}
                    <span className="modal__navrow">
                      <Glyph />
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="modal__body">
              <button className="iconbtn modal__close" onPointerDown={() => setOpen(false)}>
                <Icon.close />
              </button>

              <AnimatePresence mode="wait">
                <motion.div
                  key={section}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={SPRING_SNAP}
                >
                  {section === "general" && <General />}
                  {section === "voice" && <Voice />}
                  {section === "models" && <Models />}
                  {section === "permissions" && <Permissions />}
                  {section === "prompts" && <Prompts />}
                  {section === "usage" && <Usage />}
                  {section === "appearance" && <Appearance />}
                  {section === "shortcuts" && <Shortcuts />}
                  {section === "data" && <DataSection />}
                  {section === "memory" && <MemorySection />}
                  {section === "about" && <About />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- shared ------------------------------------------------------------------

function usePatch() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  return {
    settings,
    patch(next: Partial<Conf>) {
      const merged = { ...settings, ...next } as Conf;
      setSettings(merged);
      void saveSettings(merged);
    },
  };
}

export function Row({
  label,
  help,
  children,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="row">
      <div className="row__text">
        <div className="row__label">{label}</div>
        {help && <span className="row__help">{help}</span>}
      </div>
      {children && <div className="row__control">{children}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      style={{ justifyContent: checked ? "flex-end" : "flex-start" }}
      onPointerDown={() => onChange(!checked)}
    >
      <motion.span className="toggle__knob" layout transition={SPRING} />
    </button>
  );
}

function Head({ title, sub, beta }: { title: string; sub: string; beta?: boolean }) {
  return (
    <>
      <h2 className="sect__title">
        {title} {beta && <span className="badge">Beta</span>}
      </h2>
      <p className="sect__sub">{sub}</p>
    </>
  );
}

// --- sections ----------------------------------------------------------------

function General() {
  const { settings, patch } = usePatch();
  const setOnboarding = useApp((s) => s.setOnboarding);
  const setOpen = useApp((s) => s.setSettingsOpen);

  return (
    <section className="sect">
      <Head title="General" sub="How Conduit behaves in the background." />
      <div className="panel">
        <Row
          label="Keep a record of every action"
          help="Writes each tool call to an audit log you can review and export."
        >
          <Toggle
            label="Audit log"
            checked={settings.auditLog}
            onChange={(auditLog) => patch({ auditLog })}
          />
        </Row>
        <Row
          label="Closing the window"
          help="Conduit stays in the tray so the hotkeys keep working. Quit from the tray icon to stop it."
        />
        <Row label="Setup" help="Walk through keys, microphone and hotkeys again.">
          <button
            className="btn"
            onPointerDown={() => {
              setOpen(false);
              setOnboarding(true);
            }}
          >
            Run setup
          </button>
        </Row>
      </div>

    </section>
  );
}

function Voice() {
  const { settings, patch } = usePatch();
  const [error, setError] = useState<string | null>(null);

  const applyHotkeys = async (dictate: string, command: string) => {
    patch({ hotkeys: { dictate, command } });
    try {
      await invoke("set_hotkeys", { dictate, command });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="sect">
      <Head title="Voice" sub="Hold a key, speak, release. Nothing is captured before you press." />

      <div className="panel">
        <Row label="Command" help="Speak an instruction and Conduit acts on it.">
          <input
            type="text"
            value={settings.hotkeys.command}
            onChange={(e) => void applyHotkeys(settings.hotkeys.dictate, e.target.value)}
          />
        </Row>
        <Row label="Dictate" help="Speak and the text lands in whatever field you were in.">
          <input
            type="text"
            value={settings.hotkeys.dictate}
            onChange={(e) => void applyHotkeys(e.target.value, settings.hotkeys.command)}
          />
        </Row>
      </div>

      <div className="panel" style={{ marginTop: 10 }}>
        <VoiceCheck />
      </div>

      {error && (
        <div className="notice" style={{ marginTop: 14 }}>
          <div>
            <b>That shortcut is already taken.</b> Another application owns it, so Conduit could
            not bind it.
          </div>
        </div>
      )}

      <h3 className="sect__sub-title">Transcription</h3>
      <div className="panel">
        <Row label="Provider">
          <select
            value={settings.stt.provider}
            onChange={(e) => patch({ stt: { ...settings.stt, provider: e.target.value as never } })}
          >
            {STT_CATALOG.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Language" help="Leave empty and Conduit follows whatever you speak.">
          <input
            type="text"
            placeholder="Detect automatically"
            value={settings.stt.language}
            onChange={(e) => patch({ stt: { ...settings.stt, language: e.target.value } })}
          />
        </Row>
        <Row
          label="Clean up dictation"
          help="Removes filler and repairs false starts before inserting."
        >
          <Toggle
            label="Clean up dictation"
            checked={settings.dictation.polish}
            onChange={(polish) => patch({ dictation: { ...settings.dictation, polish } })}
          />
        </Row>
        <Row label="Insert by" help="Pasting is instant. Typing works where paste is blocked.">
          <select
            value={settings.dictation.delivery}
            onChange={(e) =>
              patch({
                dictation: {
                  ...settings.dictation,
                  delivery: e.target.value as "paste" | "type",
                },
              })
            }
          >
            <option value="paste">Paste</option>
            <option value="type">Type out</option>
          </select>
        </Row>
      </div>

      <h3 className="sect__sub-title">Run speech on this machine</h3>
      <p className="sect__sub">
        Pick a Whisper model that fits this computer. Conduit downloads it only after you approve,
        then keeps recordings and transcription on your machine.
      </p>
      <LocalSpeech />
    </section>
  );
}

/**
 * A key field that can be written but never read.
 *
 * Once saved, the key lives in the OS credential store and there is no code
 * path that brings it back — so the field shows a state, not a masked value.
 * A row of dots is a small lie: it implies the app is holding the secret.
 */
export function KeyField({ account, label, keyUrl }: { account: string; label: string; keyUrl?: string }) {
  const [present, setPresent] = useState(keyKnown(account));
  const [editing, setEditing] = useState(!keyKnown(account));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPresent(keyKnown(account));
    setEditing(!keyKnown(account));
  }, [account]);

  const save = async () => {
    setBusy(true);
    try {
      await saveKey(account, value.trim());
      setPresent(value.trim().length > 0);
      setEditing(false);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  if (present && !editing) {
    return (
      <Row label={label} help="Stored in your system credential manager.">
        <span className="pill pill--ok">
          <Icon.check />
          Saved
        </span>
        <button className="btn" onPointerDown={() => setEditing(true)}>
          Replace
        </button>
        <button
          className="btn btn--danger"
          onPointerDown={async () => {
            await clearKey(account);
            setPresent(false);
            setEditing(true);
          }}
        >
          Remove
        </button>
      </Row>
    );
  }

  return (
    <Row
      label={label}
      help={
        keyUrl ? (
          <>
            Paste a key,{" "}
            <button className="linkish" onPointerDown={() => void invoke("open_target", { target: keyUrl })}>
              get one here
            </button>
            .
          </>
        ) : (
          "Paste a key."
        )
      }
    >
      <input
        type="password"
        placeholder="Not set"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <button className="btn btn--accent" disabled={busy || !value.trim()} onPointerDown={save}>
        Save
      </button>
    </Row>
  );
}

function Models() {
  const { settings, patch } = usePatch();
  const [, force] = useState(0);

  useEffect(() => {
    void refreshKeyStatus([...PROVIDER_CATALOG.map((p) => p.id), "groq"]).then(() => force((n) => n + 1));
  }, []);

  return (
    <section className="sect">
      <Head
        title="Models"
        sub="Which model tidies up dictation. Everything else about models lives in the Model hub."
      />

      <div className="panel">
        <Row
          label="Providers and keys"
          help="Every provider, key and local model is set up in one place, the Model hub. Pick the model for a chat from its name at the top."
        >
          <button className="btn btn--ink" onPointerDown={() => useApp.getState().openHub("cloud")}>
            Open Model hub
          </button>
        </Row>
        <Row
          label="Dictation cleanup"
          help="Runs on every dictated phrase. A small, fast model here is the biggest latency win."
        >
          <select
            value={settings.dictation.provider}
            onChange={(e) =>
              patch({
                dictation: { ...settings.dictation, provider: e.target.value as ProviderId },
              })
            }
          >
            {[...PROVIDER_CATALOG.map((p) => ({ id: p.id, label: p.label })), ...settings.customProviders].map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            style={{ minWidth: 148 }}
            value={settings.dictation.model}
            onChange={(e) => patch({ dictation: { ...settings.dictation, model: e.target.value } })}
          />
        </Row>
      </div>
    </section>
  );
}

/**
 * The switches themselves (Code, Screen, how much to approve) live in the
 * message box, where they are used. What remains here is the detail behind
 * them that people set once.
 */
function ToolOptions() {
  const { settings, patch } = usePatch();
  const code = settings.code;
  const cu = settings.computerUse;
  return (
    <>
      <h3 className="sect__sub-title">Code</h3>
      <div className="panel">
        <Row label="Test command" help="Conduit runs it after an edit in Code mode and reports the result.">
          <input
            type="text"
            placeholder="npm test"
            value={code.testCommand}
            onChange={(e) => patch({ code: { ...code, testCommand: e.target.value } })}
          />
        </Row>
        <Row label="Protect changed files" help="Asks before editing a tracked file that already has uncommitted changes.">
          <Toggle label="Protect changed files" checked={code.guardDirtyFiles} onChange={(guardDirtyFiles) => patch({ code: { ...code, guardDirtyFiles } })} />
        </Row>
      </div>

      <h3 className="sect__sub-title">Screen</h3>
      <div className="panel">
        <Row label="Ask before every action" help="Each click and keystroke waits for you. Slow, but a good way to start.">
          <Toggle label="Confirm every action" checked={cu.confirmEveryAction} onChange={(confirmEveryAction) => patch({ computerUse: { ...cu, confirmEveryAction } })} />
        </Row>
        <Row label="Show where it acts" help="A marker follows the pointer while Conduit is driving.">
          <Toggle label="Show pointer marker" checked={cu.showCursor} onChange={(showCursor) => patch({ computerUse: { ...cu, showCursor } })} />
        </Row>
      </div>
    </>
  );
}

function Permissions() {
  const { settings, patch } = usePatch();
  const tools = listTools();
  const profile = settings.permissions.profile;

  const override = (tool: string, mode: "ask" | "allow" | "default") => {
    const alwaysAsk = settings.permissions.alwaysAsk.filter((t) => t !== tool);
    const neverAsk = settings.permissions.neverAsk.filter((t) => t !== tool);
    if (mode === "ask") alwaysAsk.push(tool);
    if (mode === "allow") neverAsk.push(tool);
    patch({ permissions: { ...settings.permissions, alwaysAsk, neverAsk } });
  };

  const modeFor = (tool: string): "ask" | "allow" | "default" => {
    if (settings.permissions.alwaysAsk.includes(tool)) return "ask";
    if (settings.permissions.neverAsk.includes(tool)) return "allow";
    return "default";
  };

  return (
    <section className="sect">
      <Head
        title="Tools and safety"
        sub="Choose how much Conduit may do on its own from the shield in the message box. Here you can set exceptions for single tools."
      />

      <ToolOptions />

      <h3 className="sect__sub-title">Per-tool overrides</h3>
      <div className="panel">
        {tools.map((tool) => {
          const mode = modeFor(tool.name);
          const gatedByProfile = PROFILES[profile].gated.includes(tool.name);
          return (
            <Row
              key={tool.name}
              label={
                <span className="row__tool">
                  <code>{tool.name}</code>
                  {tool.dangerous && <span className="badge">Writes</span>}
                </span>
              }
              help={`${tool.description.split(".")[0]}.`}
            >
              <select
                value={mode}
                onChange={(e) => override(tool.name, e.target.value as never)}
                style={{ minWidth: 150 }}
              >
                <option value="default">
                  Profile ({gatedByProfile ? "asks" : "runs"})
                </option>
                <option value="ask">Always ask</option>
                <option value="allow">Never ask</option>
              </select>
            </Row>
          );
        })}
      </div>

      <h3 className="sect__sub-title">Audit log</h3>
      <AuditPanel />
    </section>
  );
}

function AuditPanel() {
  const entries = readAudit(40);

  const download = () => {
    const blob = new Blob([exportCsv()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conduit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (entries.length === 0) {
    return <div className="empty">Nothing recorded yet.</div>;
  }

  return (
    <>
      <div className="panel panel--log">
        {entries.map((e, i) => (
          <div className="logrow" key={i}>
            <span className={`logrow__dot logrow__dot--${e.outcome}`} />
            <code className="logrow__tool">{e.tool}</code>
            <span className="logrow__detail">{e.detail}</span>
            <span className="logrow__time">
              {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
      <div className="row row--flush">
        <span className="row__help">Exports as CSV, for a spreadsheet rather than an editor.</span>
        <button className="btn" onPointerDown={download}>
          Export log
        </button>
      </div>
    </>
  );
}

function Usage() {
  const { settings, patch } = usePatch();
  const summary = summarise();
  const peak = Math.max(...summary.daily.map((d) => d.cost), 0.0001);

  return (
    <section className="sect">
      <Head
        title="Usage"
        sub="What you have actually spent. Priced as each call happens, on this computer. Nothing is reported anywhere."
      />

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Today</span>
          <span className="stat__value">{formatCost(summary.today.cost)}</span>
          <span className="stat__note">
            {summary.today.calls} calls · {formatTokens(summary.today.tokens)} tokens
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">This month</span>
          <span className="stat__value">{formatCost(summary.month.cost)}</span>
          <span className="stat__note">{summary.month.calls} calls</span>
        </div>
      </div>

      <div className="spark" aria-label="Daily spend, last 14 days">
        {summary.daily.map((d) => (
          <span
            key={d.day}
            className="spark__bar"
            style={{ height: `${Math.max((d.cost / peak) * 100, 2)}%` }}
            title={`${d.day}: ${formatCost(d.cost)}`}
          />
        ))}
      </div>

      {summary.byModel.length > 0 && (
        <>
          <h3 className="sect__sub-title">By model</h3>
          <div className="panel">
            {summary.byModel.slice(0, 6).map((m) => (
              <Row key={m.model} label={<code>{m.model}</code>} help={`${m.calls} calls`}>
                <span className="mono">{formatCost(m.cost)}</span>
              </Row>
            ))}
          </div>
        </>
      )}

      <h3 className="sect__sub-title">Budget</h3>
      <div className="panel">
        <Row
          label="Warn me past"
          help="A daily ceiling. Most useful when the agent is working autonomously on screen, where a stuck loop costs a model call per step."
        >
          <input
            type="text"
            style={{ minWidth: 110 }}
            value={settings.spendAlert || ""}
            placeholder="off"
            onChange={(e) => patch({ spendAlert: Number(e.target.value) || 0 })}
          />
          <span className="row__help" style={{ margin: 0 }}>
            USD / day
          </span>
        </Row>
      </div>

      {summary.today.unpriced > 0 && (
        <p className="sect__sub" style={{ marginTop: 12 }}>
          {summary.today.unpriced} call{summary.today.unpriced === 1 ? "" : "s"} today used a model
          with no published price, so they are excluded from the totals.
        </p>
      )}
    </section>
  );
}


/**
 * The prompt library.
 *
 * Built-ins are shown but not editable — copying one into your own list is a
 * single click, and that is better than letting somebody quietly break a
 * shipped prompt and then wonder why it stopped working.
 */
function Prompts() {
  const { settings, patch } = usePatch();
  const mine = settings.prompts ?? [];
  const [draft, setDraft] = useState<Prompt | null>(null);

  const save = (prompt: Prompt) => {
    const exists = mine.some((p) => p.id === prompt.id);
    patch({
      prompts: exists ? mine.map((p) => (p.id === prompt.id ? prompt : p)) : [...mine, prompt],
    });
    setDraft(null);
  };

  const blank = (): Prompt => ({
    id: crypto.randomUUID(),
    trigger: "",
    title: "",
    hint: "",
    body: "",
  });

  return (
    <section className="sect">
      <Head
        title="Prompts"
        sub="Type / in the composer to reach any of these. Use {{double braces}} for anything you want to be asked for each time."
      />

      {draft ? (
        <div className="panel">
          <Row label="Trigger" help="What you type after the slash.">
            <input
              type="text"
              value={draft.trigger}
              placeholder="review"
              onChange={(e) =>
                setDraft({ ...draft, trigger: e.target.value.replace(/[^a-z0-9-]/gi, "") })
              }
            />
          </Row>
          <Row label="Title">
            <input
              type="text"
              value={draft.title}
              placeholder="Review my changes"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Row>
          <Row label="Hint" help="Shown on the right of the menu.">
            <input
              type="text"
              value={draft.hint}
              placeholder="Checks uncommitted work"
              onChange={(e) => setDraft({ ...draft, hint: e.target.value })}
            />
          </Row>
          <div className="row row--stack">
            <div className="row__text">
              <div className="row__label">Prompt</div>
              <span className="row__help">
                {variablesIn(draft.body).length > 0
                  ? `Asks for: ${variablesIn(draft.body).join(", ")}`
                  : "Add {{a placeholder}} to be asked for a value."}
              </span>
            </div>
            <textarea
              className="brief"
              rows={5}
              value={draft.body}
              placeholder="Read {{file}} and explain what it does."
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className="row__control">
              <button className="btn" onPointerDown={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="btn btn--accent"
                disabled={!draft.trigger.trim() || !draft.title.trim() || !draft.body.trim()}
                onPointerDown={() => save(draft)}
              >
                Save prompt
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button className="btn btn--accent" onPointerDown={() => setDraft(blank())}>
          New prompt
        </button>
      )}

      {mine.length > 0 && (
        <>
          <h3 className="sect__sub-title">Yours</h3>
          <div className="panel">
            {mine.map((p) => (
              <Row key={p.id} label={<code>/{p.trigger}</code>} help={p.title}>
                <button className="btn" onPointerDown={() => setDraft(p)}>
                  Edit
                </button>
                <button
                  className="btn btn--danger"
                  onPointerDown={() => patch({ prompts: mine.filter((x) => x.id !== p.id) })}
                >
                  Remove
                </button>
              </Row>
            ))}
          </div>
        </>
      )}

      <h3 className="sect__sub-title">Built in</h3>
      <div className="panel">
        {BUILTIN_PROMPTS.map((p) => (
          <Row key={p.id} label={<code>/{p.trigger}</code>} help={`${p.title}. ${p.hint}`}>
            <button
              className="btn"
              onPointerDown={() =>
                setDraft({ ...p, id: crypto.randomUUID(), builtin: false, trigger: `my-${p.trigger}` })
              }
            >
              Duplicate
            </button>
          </Row>
        ))}
      </div>
    </section>
  );
}
