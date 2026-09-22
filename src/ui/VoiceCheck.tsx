import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { keyKnown } from "@/core/secrets";
import { STT_CATALOG, transcribe } from "@/stt";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { Meter } from "./Meter";
import { SPRING, SPRING_SNAP } from "./motion";

type StepState = "waiting" | "running" | "passed" | "failed";

interface Step {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
}

const SECONDS = 3;

/**
 * "Voice doesn't work" is four different failures wearing one sentence.
 *
 * The hotkey may be owned by another application, the microphone may be the
 * wrong device, the transcription key may be missing, or the service may have
 * refused it. Each one is invisible until you are mid-task, and each one has a
 * completely different fix.
 *
 * This walks the whole path once and says which step failed and what to do
 * about it — the difference between a tool that is broken and a tool that is
 * telling you something.
 */
export function VoiceCheck() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [heard, setHeard] = useState("");
  const level = useApp((s) => s.level);

  const update = (id: string, patch: Partial<Step>) =>
    setSteps((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const check = async () => {
    setRunning(true);
    setHeard("");
    setSteps([
      { id: "host", label: "Conduit is running natively", state: "waiting" },
      { id: "key", label: "Transcription is configured", state: "waiting" },
      { id: "mic", label: "The microphone is picking you up", state: "waiting" },
      { id: "stt", label: "Speech comes back as text", state: "waiting" },
    ]);

    try {
      // 1. Native host.
      update("host", { state: "running" });
      if (!isTauri()) {
        update("host", { state: "failed", detail: "This is the browser preview, not the app." });
        return;
      }
      update("host", { state: "passed" });

      // 2. Credentials. Checked before recording so nobody speaks for three
      //    seconds only to be told the key was never there.
      update("key", { state: "running" });
      const settings = getSettings();
      const stt = STT_CATALOG.find((s) => s.id === settings.stt.provider);
      if (stt?.account && !keyKnown(stt.account)) {
        update("key", {
          state: "failed",
          detail: `No ${stt.label} key saved. Add one under Models. It turns your speech into text.`,
        });
        return;
      }
      update("key", { state: "passed", detail: stt?.label ?? settings.stt.provider });

      // 3. Capture.
      update("mic", { state: "running", detail: `Say something. Listening for ${SECONDS}s…` });
      let peak = 0;
      const watch = window.setInterval(() => {
        peak = Math.max(peak, useApp.getState().level);
      }, 60);

      try {
        await invoke("start_recording");
      } catch (e) {
        window.clearInterval(watch);
        update("mic", {
          state: "failed",
          detail: `Could not open the microphone. ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }

      await new Promise((r) => setTimeout(r, SECONDS * 1000));
      window.clearInterval(watch);
      const wav = await invoke<string>("stop_recording");

      if (peak < 0.02) {
        update("mic", {
          state: "failed",
          detail:
            "The input never moved. Windows is probably listening to a different device. " +
            "check which microphone is set as default, and that Conduit is allowed to use it.",
        });
        return;
      }
      update("mic", { state: "passed", detail: `Peak level ${Math.round(peak * 100)}%` });

      // 4. Transcription.
      update("stt", { state: "running" });
      const result = await transcribe(wav, settings);
      if (!result.text.trim()) {
        update("stt", {
          state: "failed",
          detail: "The service replied, but heard no words. Try speaking louder or closer.",
        });
        return;
      }
      update("stt", { state: "passed", detail: `${result.ms} ms` });
      setHeard(result.text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSteps((current) => {
        const pending = current.find((s) => s.state === "running") ?? current[current.length - 1];
        return current.map((s) => (s.id === pending.id ? { ...s, state: "failed", detail: message } : s));
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="voicecheck">
      <div className="voicecheck__head">
        <div>
          <div className="row__label">Check the whole path</div>
          <span className="row__help">
            Records {SECONDS} seconds and reports exactly which part is not working.
          </span>
        </div>
        <div className="row__control">
          <Meter width={110} height={22} active={running} />
          <motion.button
            className="btn btn--accent"
            disabled={running}
            onPointerDown={check}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_SNAP}
          >
            {running ? "Listening…" : "Run check"}
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {steps.length > 0 && (
          <motion.ol
            className="voicecheck__steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
          >
            {steps.map((step) => (
              <li className="vcstep" data-state={step.state} key={step.id}>
                <span className="vcstep__mark">
                  {step.state === "passed" ? (
                    <Icon.check />
                  ) : step.state === "failed" ? (
                    <Icon.close />
                  ) : step.state === "running" ? (
                    <motion.span
                      className="vcstep__spin"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, ease: "linear", duration: 0.9 }}
                    />
                  ) : (
                    <span className="vcstep__dot" />
                  )}
                </span>
                <span className="vcstep__body">
                  <span className="vcstep__label">{step.label}</span>
                  {step.detail && <span className="vcstep__detail">{step.detail}</span>}
                </span>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {heard && (
          <motion.div
            className="voicecheck__heard"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
          >
            <span className="vcstep__label">Heard</span>
            <p>“{heard}”</p>
          </motion.div>
        )}
      </AnimatePresence>

      {level > 0.02 && !running && (
        <span className="row__help">The microphone is live. The meter is moving.</span>
      )}
    </div>
  );
}
