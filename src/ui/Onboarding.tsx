import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PROFILES, saveSettings, type PermissionProfile, type ProviderId } from "@/core/config";
import { refreshKeyStatus } from "@/core/secrets";
import { useApp } from "@/core/store";
import { getProvider, PROVIDER_CATALOG } from "@/llm";
import { STT_CATALOG } from "@/stt";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { Meter } from "./Meter";
import { KeyField, Row, Toggle } from "./Settings";
import { SPRING, SPRING_SNAP, materialize } from "./motion";

type StepId = "welcome" | "model" | "voice" | "hotkeys" | "permissions" | "ready";

const ORDER: StepId[] = ["welcome", "model", "voice", "hotkeys", "permissions", "ready"];

/**
 * First run.
 *
 * The gap between installing a tool like this and getting one useful result
 * out of it is where almost everybody gives up: keys in one place, a
 * microphone that turns out to be the wrong device, a hotkey silently owned by
 * another app. Each of those failures is invisible until you hit it mid-task.
 *
 * So this does not merely collect settings — it *proves* each one works before
 * moving on. A key is verified with a real request, the microphone with a live
 * meter, the hotkey by asking the user to actually press it.
 */
export function Onboarding() {
  const open = useApp((s) => s.onboarding);
  const setOpen = useApp((s) => s.setOnboarding);
  const [step, setStep] = useState<StepId>("welcome");

  const index = ORDER.indexOf(step);
  const next = () => setStep(ORDER[Math.min(index + 1, ORDER.length - 1)]);
  const back = () => setStep(ORDER[Math.max(index - 1, 0)]);

  const finish = async () => {
    const settings = useApp.getState().settings;
    await saveSettings({ ...settings, onboarded: true });
    useApp.getState().setSettings({ ...settings, onboarded: true });
    setOpen(false);
    setStep("welcome");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ zIndex: 80 }}
        >
          <motion.div className="wizard" {...materialize} transition={SPRING}>
            <div className="wizard__rail">
              {ORDER.map((id, i) => (
                <span
                  key={id}
                  className={`wizard__tick${i <= index ? " wizard__tick--done" : ""}`}
                />
              ))}
            </div>

            <div className="wizard__body">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={SPRING_SNAP}
                >
                  {step === "welcome" && <Welcome />}
                  {step === "model" && <ModelStep />}
                  {step === "voice" && <VoiceStep />}
                  {step === "hotkeys" && <HotkeyStep />}
                  {step === "permissions" && <PermissionStep />}
                  {step === "ready" && <ReadyStep />}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="wizard__foot">
              {index > 0 ? (
                <button className="btn" onPointerDown={back}>
                  Back
                </button>
              ) : (
                <button className="btn" onPointerDown={() => void finish()}>
                  Skip setup
                </button>
              )}
              <span className="spacer" />
              <span className="wizard__count">
                {index + 1} of {ORDER.length}
              </span>
              {step === "ready" ? (
                <button className="btn btn--accent" onPointerDown={() => void finish()}>
                  Start using Conduit
                </button>
              ) : (
                <button className="btn btn--accent" onPointerDown={next}>
                  Continue
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Welcome() {
  return (
    <>
      <span className="wizard__mark">
        <Logo size={30} />
      </span>
      <h2 className="wizard__title">Welcome to Conduit</h2>
      <p className="wizard__sub">
        An assistant that lives in your tray and can actually do things: read and write files, run
        commands, type into any app, and, if you allow it, see and operate your screen.
      </p>
      <div className="wizard__points">
        <Point icon="mic" title="Talk instead of typing">
          Hold a key, speak, release. Your words land as clean text wherever you were typing.
        </Point>
        <Point icon="cpu" title="Any model, your keys">
          Anthropic, OpenAI, OpenRouter, Google, or a local model. Nothing is billed through us.
        </Point>
        <Point icon="shield" title="You stay in control">
          Every action can require approval, and everything it does is logged.
        </Point>
      </div>
      <p className="wizard__note">This takes about a minute. You can change anything later.</p>
    </>
  );
}

function Point({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Icon;
  title: string;
  children: React.ReactNode;
}) {
  const Glyph = Icon[icon];
  return (
    <div className="point">
      <span className="point__icon">
        <Glyph />
      </span>
      <div>
        <div className="point__title">{title}</div>
        <div className="point__body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Connecting a model, and proving it works.
 *
 * A saved key that turns out to be wrong fails later, inside a task, as an
 * opaque 401. Sending one cheap request here converts that into a plain
 * sentence at the moment the user can still fix it.
 */
function ModelStep() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const [state, setState] = useState<"idle" | "testing" | "ok" | "failed">("idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    void refreshKeyStatus(PROVIDER_CATALOG.map((p) => p.id));
  }, []);

  const provider = PROVIDER_CATALOG.find((p) => p.id === settings.command.provider);

  const test = async () => {
    setState("testing");
    setDetail("");
    try {
      const client = getProvider(settings.command.provider, settings);
      const result = await client.complete({
        model: settings.command.model,
        system: "Reply with the single word: ready",
        messages: [{ role: "user", text: "ping" }],
        maxTokens: 16,
        fastPath: true,
      });
      setState("ok");
      setDetail(result.text.trim().slice(0, 60) || "Responded.");
    } catch (e) {
      setState("failed");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h2 className="wizard__title">Connect a model</h2>
      <p className="wizard__sub">
        Conduit needs one provider to think with. Anthropic is the best default for the agent;
        you can add others later.
      </p>

      <div className="panel">
        <Row label="Provider">
          <select
            value={settings.command.provider}
            onChange={(e) => {
              const id = e.target.value as ProviderId;
              const entry = PROVIDER_CATALOG.find((p) => p.id === id);
              setSettings({
                ...settings,
                command: { provider: id, model: entry?.models[0] ?? settings.command.model },
              });
              setState("idle");
            }}
          >
            {PROVIDER_CATALOG.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            style={{ minWidth: 150 }}
            value={settings.command.model}
            onChange={(e) =>
              setSettings({ ...settings, command: { ...settings.command, model: e.target.value } })
            }
          />
        </Row>

        {provider?.needsKey && (
          <KeyField account={provider.id} label={`${provider.label} key`} keyUrl={provider.keyUrl} />
        )}

        <Row label="Check it works" help="Sends one very small request.">
          <button className="btn" disabled={state === "testing"} onPointerDown={test}>
            {state === "testing" ? "Testing…" : "Test connection"}
          </button>
        </Row>
      </div>

      {state === "ok" && (
        <div className="result result--ok">
          <Icon.check />
          Connected. The model replied “{detail}”.
        </div>
      )}
      {state === "failed" && (
        <div className="result result--bad">
          <div>
            <b>That did not work.</b> {detail}
          </div>
        </div>
      )}
    </>
  );
}

function VoiceStep() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const level = useApp((s) => s.level);
  const [heard, setHeard] = useState(false);

  // The meter is the whole point of this step: a device that never moves is
  // the single most common silent failure in voice tools.
  useEffect(() => {
    if (level > 0.08) setHeard(true);
  }, [level]);

  const stt = STT_CATALOG.find((s) => s.id === settings.stt.provider);

  return (
    <>
      <h2 className="wizard__title">Set up your voice</h2>
      <p className="wizard__sub">
        Speech is transcribed by a separate, much faster model. Groq is free to start with and
        quick enough that push-to-talk feels instant.
      </p>

      <div className="panel">
        <Row label="Transcription">
          <select
            value={settings.stt.provider}
            onChange={(e) =>
              setSettings({
                ...settings,
                stt: { ...settings.stt, provider: e.target.value as never },
              })
            }
          >
            {STT_CATALOG.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Row>

        {stt?.account && (
          <KeyField
            account={stt.account}
            label={`${stt.label} key`}
            keyUrl={stt.account === "groq" ? "https://console.groq.com/keys" : undefined}
          />
        )}

        <Row
          label="Say something"
          help={heard ? "Microphone is working." : "The bars should move while you talk."}
        >
          <Meter width={170} height={24} active />
          {heard && (
            <span className="pill pill--ok">
              <Icon.check />
              Heard you
            </span>
          )}
        </Row>

        <Row label="Language" help="Leave empty and Conduit follows whatever you speak.">
          <input
            type="text"
            placeholder="Detect automatically"
            value={settings.stt.language}
            onChange={(e) =>
              setSettings({ ...settings, stt: { ...settings.stt, language: e.target.value } })
            }
          />
        </Row>
      </div>
    </>
  );
}

/** Hotkeys are verified by having the user press them, not by trusting a bind. */
function HotkeyStep() {
  const settings = useApp((s) => s.settings);
  const phase = useApp((s) => s.phase);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (phase === "listening" || phase === "thinking") setPressed(true);
  }, [phase]);

  return (
    <>
      <h2 className="wizard__title">Try the hotkey</h2>
      <p className="wizard__sub">
        Conduit works from anywhere, not just this window. Hold the key, speak, release. The
        recording lasts exactly as long as you hold it.
      </p>

      <div className="tryit">
        <div className="tryit__keys">
          {settings.hotkeys.command.split("+").map((k) => (
            <span className="kbd kbd--big" key={k}>
              {k}
            </span>
          ))}
        </div>
        <p className="tryit__hint">
          {pressed ? "That is it. You are set." : "Hold it now and say anything."}
        </p>
        {pressed && (
          <span className="pill pill--ok">
            <Icon.check />
            Hotkey works
          </span>
        )}
      </div>

      <div className="panel">
        <Row label="Command" help="Speak an instruction and Conduit acts on it.">
          <span className="mono">{settings.hotkeys.command}</span>
        </Row>
        <Row label="Dictate" help="Speak and the text lands in the field you were in.">
          <span className="mono">{settings.hotkeys.dictate}</span>
        </Row>
      </div>
      <p className="wizard__note">
        If nothing happens, another application already owns that combination. Change it in
        Settings → Voice.
      </p>
    </>
  );
}

function PermissionStep() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const profile = settings.permissions.profile;

  return (
    <>
      <h2 className="wizard__title">Decide what needs your approval</h2>
      <p className="wizard__sub">
        Conduit can run commands and change files. Pick how much it should do without stopping to
        ask. You can change this at any time, and every action is logged either way.
      </p>

      <div className="profiles profiles--stack">
        {(Object.keys(PROFILES) as PermissionProfile[]).map((id) => (
          <button
            key={id}
            className={`profile${profile === id ? " profile--on" : ""}`}
            onPointerDown={() =>
              setSettings({
                ...settings,
                permissions: { ...settings.permissions, profile: id },
              })
            }
          >
            <span className="profile__name">{PROFILES[id].label}</span>
            <span className="profile__detail">{PROFILES[id].detail}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <Row
          label="Keep an audit log"
          help="Every tool call recorded locally, exportable as CSV. Recommended."
        >
          <Toggle
            label="Audit log"
            checked={settings.auditLog}
            onChange={(auditLog) => setSettings({ ...settings, auditLog })}
          />
        </Row>
      </div>
    </>
  );
}

function ReadyStep() {
  const setOpen = useApp((s) => s.setOnboarding);

  const tryIt = async (text: string) => {
    setOpen(false);
    const { sendMessage } = await import("@/core/chat");
    await saveSettings({ ...useApp.getState().settings, onboarded: true });
    void sendMessage(text);
  };

  return (
    <>
      <span className="wizard__mark">
        <Logo size={30} />
      </span>
      <h2 className="wizard__title">You are set up</h2>
      <p className="wizard__sub">
        Try one of these, or just start typing. Everything below is safe: nothing deletes or
        overwrites anything.
      </p>

      <div className="starters">
        {[
          { label: "What is on this machine?", body: "What operating system and hardware am I on?" },
          { label: "Look around a folder", body: "List what is in my Documents folder" },
          { label: "Check a port", body: "Is anything listening on port 3000?" },
        ].map((s) => (
          <button key={s.label} className="starter" onPointerDown={() => void tryIt(s.body)}>
            <Icon.sparkle />
            {s.label}
          </button>
        ))}
      </div>

      <div className="wizard__tips">
        <div>
          <span className="kbd">Ctrl K</span> commands and chats
        </div>
        <div>
          <span className="kbd">Ctrl N</span> new chat
        </div>
        <div>
          <span className="kbd">Esc</span> stop the agent
        </div>
      </div>
    </>
  );
}

/** Opens the wizard on first launch, once settings say it has not been seen. */
export function useFirstRun(): void {
  const onboarded = useApp((s) => s.settings.onboarded);
  const setOnboarding = useApp((s) => s.setOnboarding);

  useEffect(() => {
    if (!onboarded) {
      const t = window.setTimeout(() => setOnboarding(true), 320);
      return () => window.clearTimeout(t);
    }
  }, [onboarded, setOnboarding]);
}

