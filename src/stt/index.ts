import { invoke } from "@tauri-apps/api/core";
import type { Settings, SttProviderId } from "@/core/config";

export interface Transcript {
  text: string;
  /** ISO code the model detected, when it reports one. */
  language?: string;
  /** Wall-clock milliseconds, shown so slowness is attributable. */
  ms: number;
}

/**
 * Speech to text.
 *
 * Whisper-family endpoints all take multipart audio and return `{ text }`, so
 * one function covers every hosted provider. The upload goes through the
 * native layer for the same reason model calls do: the credential is attached
 * there and never enters the web bundle.
 *
 * Language is deliberately blank by default. The model auto-detects, which is
 * what makes "speaks your language" true without the user configuring
 * anything — and what lets somebody switch language mid-sentence.
 */
export async function transcribe(wavBase64: string, settings: Settings): Promise<Transcript> {
  const started = performance.now();
  const endpoint = endpointFor(settings);
  if (!endpoint) throw new Error(`Unknown transcription provider: ${settings.stt.provider}`);

  const response = await invoke<{ status: number; body: string }>("proxy_transcribe", {
    url: endpoint.url,
    account: endpoint.needsKey ? endpoint.account : "",
    model: endpoint.model,
    language: settings.stt.language || null,
    wavBase64,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${endpoint.label} could not transcribe that (${response.status}). ${hint(response, endpoint)}`,
    );
  }

  const json = JSON.parse(response.body) as { text?: string; language?: string };
  return {
    text: (json.text ?? "").trim(),
    language: json.language,
    ms: Math.round(performance.now() - started),
  };
}

/** Turns the common failures into something the user can act on. */
function hint(response: { status: number }, endpoint: { label: string; needsKey: boolean }): string {
  if (response.status === 401 || response.status === 403) {
    return `Check the ${endpoint.label} key in Settings → Models.`;
  }
  if (response.status === 429) return "Rate limited. Try again in a moment.";
  if (response.status === 0 || response.status >= 500) {
    return endpoint.needsKey
      ? "The service did not respond."
      : "Is your local Whisper server running?";
  }
  return "";
}

interface Endpoint {
  label: string;
  url: string;
  model: string;
  needsKey: boolean;
  account: string;
}

/**
 * Where the audio goes.
 *
 * The local one is resolved from settings rather than hard-coded, because the
 * port is chosen at install time — a fixed 8080 would collide with the first
 * dev server the user happens to be running, and the failure would look like
 * "transcription is broken" rather than "something else has that port".
 */
function endpointFor(settings: Settings): Endpoint | undefined {
  if (settings.stt.provider === "local") {
    return {
      label: "Local Whisper",
      url: `http://127.0.0.1:${settings.localStt.port || 8642}/v1/audio/transcriptions`,
      model: settings.localStt.model || "whisper-1",
      needsKey: false,
      account: "",
    };
  }
  return HOSTED[settings.stt.provider];
}

const HOSTED: Partial<Record<SttProviderId, Endpoint>> = {
  // Groq runs Whisper large-v3 far faster than real time, which is what makes
  // push-to-talk feel instant rather than merely quick.
  groq: {
    label: "Groq",
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    needsKey: true,
    account: "groq",
  },
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    needsKey: true,
    account: "openai",
  },
};

export const STT_CATALOG: ReadonlyArray<{
  id: SttProviderId;
  label: string;
  hint: string;
  account: string;
}> = [
  { id: "groq", label: "Groq Whisper", hint: "The fastest hosted option. A good default.", account: "groq" },
  { id: "openai", label: "OpenAI Whisper", hint: "Widely available, a little slower", account: "openai" },
  {
    id: "local",
    label: "On this machine",
    hint: "A Whisper model running locally. Nothing leaves the computer.",
    account: "",
  },
];
