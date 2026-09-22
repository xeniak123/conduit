import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";
import { getProvider } from "@/llm";
import { transcribe } from "@/stt";
import { registerFsTools } from "@/tools/builtin/fs";
import { registerDevTools } from "@/tools/builtin/dev";
import { registerSystemTools } from "@/tools/builtin/system";
import { registerWebTools } from "@/tools/builtin/web";
import { registerMemoryTools } from "@/tools/builtin/memory";
import { registerSkillTools } from "@/skills";
import { registerCodeTools } from "@/tools/builtin/code";
import { sendMessage } from "./chat";
import { getSettings } from "./config";
import { useApp } from "./store";

interface CaptureEvent {
  mode: "dictate" | "command";
  focus: { process: string; title: string };
}

let capturing = false;

/**
 * Wires the hotkeys to the whole loop. Called once at startup.
 *
 * The shape is push-to-talk: the key going down starts the microphone, the key
 * coming up ends it. No endpointing heuristics, no waiting for silence — the
 * user decides exactly when they are done, which is why this feels faster than
 * assistants that guess.
 */
export async function startPipeline(): Promise<() => void> {
  registerFsTools();
  registerSystemTools();
  registerDevTools();
  registerWebTools();
  registerMemoryTools();
  registerCodeTools();
  registerSkillTools();

  const stopStart = await listen<CaptureEvent>("conduit://capture-start", async () => {
    if (capturing) return;
    capturing = true;

    useApp.getState().clearSteps();
    useApp.getState().setPhase("listening", "Listening…");

    try {
      await invoke("start_recording");
    } catch (e) {
      capturing = false;
      fail(e);
    }
  });

  const stopEnd = await listen<CaptureEvent>("conduit://capture-stop", async (event) => {
    if (!capturing) return;
    capturing = false;

    try {
      const wav = await invoke<string>("stop_recording");
      await handleUtterance(wav, event.payload.mode);
    } catch (e) {
      fail(e);
    }
  });

  return () => {
    stopStart();
    stopEnd();
  };
}

async function handleUtterance(wavBase64: string, mode: "dictate" | "command"): Promise<void> {
  const app = useApp.getState();
  const settings = getSettings();

  app.setPhase("thinking", "Transcribing…");
  const heard = await transcribe(wavBase64, settings);

  if (!heard.text) {
    app.setPhase("error", "Heard nothing — check the microphone in Settings → Voice.");
    settle(2600);
    return;
  }

  app.setCaption(heard.text);

  if (mode === "dictate") {
    await deliverDictation(heard.text);
    return;
  }

  app.setPhase("working", heard.text);

  // A spoken command is a message like any other: same agent, same tools, and
  // it lands in the transcript so there is one history rather than two.
  await sendMessage(heard.text, { spoken: true });

  const state = useApp.getState();
  const convo = state.conversations.find((c) => c.id === state.activeId);
  const reply = convo?.messages[convo.messages.length - 1];

  state.setPhase("done", reply?.text || "Done.");
  settle(4200);
}

/**
 * Dictation path. Deliberately separate from the agent: no tools, no loop, one
 * model call — anything more would add latency the user feels on every word.
 */
async function deliverDictation(raw: string): Promise<void> {
  const app = useApp.getState();
  const settings = getSettings();
  let text = raw;

  if (settings.dictation.polish) {
    app.setPhase("thinking", "Polishing…");
    try {
      const provider = getProvider(settings.dictation.provider, settings);
      const result = await provider.complete({
        model: settings.dictation.model,
        system: POLISH_PROMPT,
        messages: [{ role: "user", text: raw }],
        maxTokens: 1024,
        effort: "low",
        // No tools here, so skipping reasoning is safe and saves a second.
        fastPath: true,
      });
      if (result.text.trim()) text = result.text.trim();
    } catch {
      // Polishing is a nicety. If the model is unreachable, the user still
      // gets their words — losing the dictation entirely would be worse.
      app.setCaption("Polish unavailable — inserting raw transcript.");
    }
  }

  app.setPhase("working", text);

  if (settings.dictation.delivery === "type") {
    await invoke("type_text", { text });
  } else {
    const previous = await readClipboard().catch(() => null);
    await writeClipboard(text);
    await invoke("paste_clipboard", { text });
    if (previous !== null) {
      window.setTimeout(() => void writeClipboard(previous), 150);
    }
  }

  app.setPhase("done", text);
  settle(1400);
}

const POLISH_PROMPT = [
  "You clean up dictated speech into written text.",
  "",
  "Rules:",
  "- Reply with the cleaned text only. Never answer, comment, or add quotes.",
  "- Keep the speaker's language. Never translate.",
  "- Remove filler ('um', 'like', 'you know') and repaired false starts:",
  "  'I have two things, well actually three' becomes 'I have three things'.",
  "- Fix punctuation, capitalisation and obvious transcription slips.",
  "- Keep the speaker's voice, register and word choice. Do not make casual",
  "  writing formal, and do not summarise — every idea must survive.",
  "- Spoken commands like 'new line' or 'period' become the actual character.",
  "- If the input is already clean, return it unchanged.",
].join("\n");

function fail(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  useApp.getState().setPhase("error", message);
  settle(5000);
}

/**
 * Returns to rest after a result has had time to be read.
 *
 * The companion takes itself away when there is nothing to say, so this is
 * what ends a run rather than a call to hide a window. A pending timer is
 * always replaced, or a fast second utterance would be cut short by the first
 * one's countdown.
 */
let settleTimer: number | null = null;

function settle(after: number): void {
  if (settleTimer !== null) window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    const app = useApp.getState();
    if (app.phase === "listening" || app.abort) return;
    app.setPhase("idle", "");
    app.clearSteps();
  }, after);
}
