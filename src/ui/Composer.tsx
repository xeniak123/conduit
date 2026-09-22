import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { captureScreen } from "@/computer";
import { sendMessage, stopRun } from "@/core/chat";
import { PROFILES, saveSettings, type PermissionProfile, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import {
  BUILTIN_PROMPTS,
  fillVariables,
  matchPrompts,
  variablesIn,
  type Prompt,
} from "@/core/prompts";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { Meter } from "./Meter";
import { PromptFields, SlashMenu } from "./SlashMenu";
import { SPRING, SPRING_SNAP } from "./motion";

export interface Attachment {
  id: string;
  name: string;
  kind: "text" | "image";
  /** Text content, or base64 for an image. */
  content: string;
  size: number;
}

const MAX_TEXT = 200_000;

export function Composer() {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<Prompt | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const phase = useApp((s) => s.phase);
  const busy = useApp((s) => s.abort !== null);

  const listening = phase === "listening";

  // `/` only opens the menu at the very start of an empty line — otherwise it
  // would hijack every path the user types.
  const slashQuery = dismissed
    ? null
    : /^\/[a-z0-9-]*$/i.test(value)
      ? value.slice(1)
      : null;

  const slashResults = useMemo(
    () =>
      slashQuery === null
        ? []
        : matchPrompts([...(settings.prompts ?? []), ...BUILTIN_PROMPTS], slashQuery).slice(0, 7),
    [slashQuery, settings.prompts],
  );

  /**
   * The menu owns the keyboard only while it has something to offer.
   *
   * Without this, typing `/tmp` and pressing Enter did nothing at all: the
   * menu swallowed the key while showing no results to choose from, and the
   * message was never sent.
   */
  const menuOpen = slashQuery !== null && slashResults.length > 0;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (text = value, extra = attachments) => {
    const body = compose(text, extra);
    if (!body.trim() || busy) return;
    setValue("");
    setAttachments([]);
    void sendMessage(body, {
      images: extra.filter((a) => a.kind === "image").map((a) => a.content),
    });
  };

  const usePrompt = (prompt: Prompt) => {
    if (variablesIn(prompt.body).length > 0) {
      setPendingPrompt(prompt);
      return;
    }
    setValue("");
    submit(prompt.body, attachments);
  };

  const addFiles = async (files: FileList | File[]) => {
    const next: Attachment[] = [];

    for (const file of Array.from(files).slice(0, 8)) {
      const isImage = file.type.startsWith("image/");
      if (!isImage && !(await looksLikeText(file))) {
        setNotice(`${file.name} is not text or an image, so the model could not read it.`);
        continue;
      }
      try {
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          kind: isImage ? "image" : "text",
          size: file.size,
          content: isImage ? await asBase64(file) : (await file.text()).slice(0, MAX_TEXT),
        });
      } catch {
        // A binary that is not an image has nothing useful to send; skipping
        // it quietly beats attaching a page of mojibake.
      }
    }

    setAttachments((current) => [...current, ...next].slice(0, 8));
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // The screenshot entry in the + menu arrives as an event, so the menu does
  // not need to know how attachments are kept.
  useEffect(() => {
    const onShot = (e: Event) => {
      const base64 = (e as CustomEvent<string>).detail;
      setAttachments((c) =>
        [
          ...c,
          {
            id: crypto.randomUUID(),
            name: "Screenshot.png",
            kind: "image" as const,
            content: base64,
            size: Math.round((base64.length * 3) / 4),
          },
        ].slice(0, 8),
      );
    };
    window.addEventListener("conduit:screenshot", onShot);
    return () => window.removeEventListener("conduit:screenshot", onShot);
  }, []);

  return (
    <div className="composer-wrap">
      <SlashMenu
        query={slashQuery}
        results={slashResults}
        onPick={usePrompt}
        // Escape closes the menu and leaves what was typed. Wiping the field
        // would punish someone who opened it by accident.
        onClose={() => setDismissed(true)}
      />

      <PromptFields
        prompt={pendingPrompt}
        onCancel={() => setPendingPrompt(null)}
        onSubmit={(values) => {
          const body = fillVariables(pendingPrompt!.body, values);
          setPendingPrompt(null);
          setValue("");
          submit(body, attachments);
        }}
      />

      <motion.div
        className={`composer${focused ? " composer--focused" : ""}${dragging ? " composer--drop" : ""}`}
        layout
        transition={SPRING}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div
              className="attachments"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
            >
              {attachments.map((a) => (
                <span className="attachment" key={a.id}>
                  {a.kind === "image" ? <Icon.image /> : <Icon.file />}
                  <span className="attachment__name">{a.name}</span>
                  <span className="attachment__size">{formatSize(a.size)}</span>
                  <button
                    className="attachment__x"
                    aria-label={`Remove ${a.name}`}
                    onPointerDown={() => setAttachments((c) => c.filter((x) => x.id !== a.id))}
                  >
                    <Icon.close />
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {notice && (
            <motion.div
              className="composer__notice"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
            >
              {notice}
            </motion.div>
          )}
        </AnimatePresence>

        <textarea
          ref={inputRef}
          className="composer__input"
          rows={1}
          placeholder={
            listening
              ? "Listening…"
              : dragging
                ? "Drop files to attach"
                : "Ask anything"
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            // The slash menu owns these keys only while it is actually open.
            if (menuOpen && ["Enter", "Tab", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="composer__row">
          <PlusMenu
            onFiles={(files) => void addFiles(files)}
            onSlash={() => {
              setValue("/");
              setDismissed(false);
              inputRef.current?.focus();
            }}
          />
          <ApprovalMenu settings={settings} onChange={(next) => persist(setSettings, next)} />
          <ToolToggle
            on={settings.webSearch !== false}
            icon={<Icon.globe />}
            label="Search"
            title="Let Conduit search and read the web"
            onChange={(webSearch) => persist(setSettings, { ...settings, webSearch })}
          />
          <ToolToggle
            on={settings.code.enabled}
            icon={<CodeGlyph />}
            label="Code"
            title="Work in a codebase: read first, edit narrowly, run the tests"
            onChange={(enabled) => persist(setSettings, { ...settings, code: { ...settings.code, enabled } })}
          />
          <ScreenToggle settings={settings} onChange={(next) => persist(setSettings, next)} />

          {settings.activeProjectId && (
            <span className="ctool ctool--quiet">
              <Icon.folder />
              {settings.projects.find((p) => p.id === settings.activeProjectId)?.name}
            </span>
          )}

          <span className="spacer" />

          {listening ? (
            <span className="mic mic--live" aria-label="Listening">
              <Meter width={22} height={16} active />
            </span>
          ) : (
            <button className="mic" title="Hold the hotkey to speak" aria-label="Voice input">
              <Icon.mic />
            </button>
          )}

          <motion.button
            className="send"
            disabled={!busy && !compose(value, attachments).trim()}
            onPointerDown={() => (busy ? stopRun() : submit())}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_SNAP}
            aria-label={busy ? "Stop" : "Send"}
          >
            {busy ? <Icon.stop /> : <Icon.send />}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Text attachments are folded into the message itself rather than sent as a
 * separate channel: every provider understands a fenced block, and the model
 * sees the filename next to the content, which is most of what it needs.
 */
function compose(text: string, attachments: Attachment[]): string {
  const files = attachments.filter((a) => a.kind === "text");
  if (!files.length) return text;

  const blocks = files.map((a) => `--- ${a.name} ---\n${a.content}`).join("\n\n");
  return `${text}\n\n${blocks}`.trim();
}

function asBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function persist(set: (s: Settings) => void, next: Settings) {
  set(next);
  void saveSettings(next);
}

/** Sniffs the first few KB: a NUL byte means binary, whatever the extension says. */
async function looksLikeText(file: File): Promise<boolean> {
  if (file.type.startsWith("text/") || /json|xml|javascript|yaml|toml|csv|sql/.test(file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  return !head.includes(0);
}

/** Closes when the pointer goes down anywhere outside. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const pop = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.97 },
  transition: SPRING_SNAP,
};

function PlusMenu({ onFiles, onSlash }: { onFiles: (f: FileList) => void; onSlash: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [shooting, setShooting] = useState(false);

  const shoot = async () => {
    setOpen(false);
    if (!isTauri()) return;
    setShooting(true);
    try {
      const cap = await captureScreen();
      window.dispatchEvent(new CustomEvent("conduit:screenshot", { detail: cap.png_base64 }));
    } finally {
      setShooting(false);
    }
  };

  const pick = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };

  return (
    <div className="ctool__anchor" ref={ref}>
      <button
        className="ctool ctool--icon"
        aria-label="Add files and more"
        aria-expanded={open}
        onPointerDown={() => setOpen(!open)}
      >
        {shooting ? <span className="spin" /> : <Icon.plus />}
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <AnimatePresence>
        {open && (
          <motion.div className="cmenu" {...pop}>
            <button className="cmenu__item" onClick={() => pick(fileRef.current)}>
              <Icon.file />
              <span>
                <b>Upload files</b>
                <small>Code, text, notes, data. You can drop them on the box too.</small>
              </span>
            </button>
            <button className="cmenu__item" onClick={() => pick(imageRef.current)}>
              <Icon.image />
              <span>
                <b>Add photos</b>
                <small>For models that can see images.</small>
              </span>
            </button>
            <button className="cmenu__item" disabled={!isTauri()} onPointerDown={() => void shoot()}>
              <Icon.display />
              <span>
                <b>Screenshot</b>
                <small>Attach what is on your screen right now.</small>
              </span>
            </button>
            <button
              className="cmenu__item"
              onPointerDown={() => {
                setOpen(false);
                onSlash();
              }}
            >
              <Icon.book />
              <span>
                <b>Saved prompts</b>
                <small>Or type / at the start of a message.</small>
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const APPROVAL: Record<PermissionProfile, string> = {
  guarded: "Ask me first",
  standard: "Ask for risky",
  trusted: "Approve for me",
};

function ApprovalMenu({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const { open, setOpen, ref } = usePopover();
  const profile = settings.permissions.profile;
  return (
    <div className="ctool__anchor" ref={ref}>
      <button
        className="ctool"
        data-level={profile}
        aria-expanded={open}
        title="How much Conduit may do without asking"
        onPointerDown={() => setOpen(!open)}
      >
        <Icon.shield />
        {APPROVAL[profile]}
        <span className="ctool__caret">
          <Icon.chevron />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="cmenu" {...pop}>
            {(Object.keys(PROFILES) as PermissionProfile[]).map((id) => (
              <button
                key={id}
                className="cmenu__item"
                aria-current={id === profile}
                onPointerDown={() => {
                  setOpen(false);
                  onChange({ ...settings, permissions: { ...settings.permissions, profile: id } });
                }}
              >
                <span className="cmenu__dot" data-level={id} />
                <span>
                  <b>{APPROVAL[id]}</b>
                  <small>{PROFILES[id].detail}</small>
                </span>
                {id === profile && <Icon.check />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolToggle({
  on,
  icon,
  label,
  title,
  onChange,
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <motion.button
      className="ctool"
      aria-pressed={on}
      title={title}
      onPointerDown={() => onChange(!on)}
      whileTap={{ scale: 0.95 }}
      transition={SPRING_SNAP}
    >
      {icon}
      {label}
    </motion.button>
  );
}

/**
 * Screen control is the one switch that asks before it turns on. It hands the
 * model the real pointer and keyboard, so the first flip gets one sentence of
 * explanation and a choice about confirming each action, right here, without
 * sending anyone to Settings.
 */
function ScreenToggle({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const { open, setOpen, ref } = usePopover();
  const cu = settings.computerUse;
  const set = (next: Partial<Settings["computerUse"]>) =>
    onChange({ ...settings, computerUse: { ...cu, ...next } });

  return (
    <div className="ctool__anchor" ref={ref}>
      <motion.button
        className="ctool"
        aria-pressed={cu.enabled}
        title="Let Conduit see and control the screen"
        whileTap={{ scale: 0.95 }}
        transition={SPRING_SNAP}
        onPointerDown={() => (cu.enabled ? set({ enabled: false }) : setOpen(!open))}
      >
        <Icon.display />
        Screen
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div className="cmenu cmenu--card" {...pop}>
            <b className="cmenu__title">Let Conduit use your screen?</b>
            <p className="cmenu__text">
              It takes screenshots, moves the real pointer and types. A marker shows where it acts,
              and Esc stops it. It never enters passwords or card details.
            </p>
            <label className="cmenu__check">
              <input
                type="checkbox"
                checked={cu.confirmEveryAction}
                onChange={(e) => set({ confirmEveryAction: e.target.checked })}
              />
              Ask before every click and keystroke
            </label>
            <div className="cmenu__actions">
              <button className="btn btn--small" onPointerDown={() => setOpen(false)}>
                Not now
              </button>
              <button
                className="btn btn--small btn--ink"
                onPointerDown={() => {
                  setOpen(false);
                  set({ enabled: true });
                }}
              >
                Turn on
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CodeGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
    </svg>
  );
}
