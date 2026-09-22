import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, saveSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";

/**
 * Speech recognition that never leaves the machine.
 *
 * Two things have to be true for this to be a real feature rather than a
 * setting that assumes you already did the work:
 *
 *   **It has to pick the model for you.** "Which Whisper size should I use" is
 *   a question about your own hardware that most people cannot answer, and
 *   getting it wrong means either poor accuracy or a machine that swaps. So
 *   Conduit asks the operating system how much memory there is and recommends
 *   from that, showing the reasoning rather than just the verdict.
 *
 *   **It has to install the runtime too.** A model file alone does nothing.
 *   whisper.cpp publishes built binaries; Conduit fetches the one for this
 *   platform, unpacks it, and starts it on a loopback port.
 *
 * Nothing is downloaded without the user pressing the button, and the exact
 * URL and size are shown before they do. This fetches and runs a program from
 * the internet, which is a thing somebody should agree to knowingly.
 */

export interface WhisperModel {
  id: string;
  label: string;
  /** Megabytes on disk. */
  size: number;
  /** Roughly how much memory it wants while running, in megabytes. */
  memory: number;
  url: string;
  /** Plain-language accuracy, since a WER figure means nothing to most people. */
  quality: string;
}

const HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "tiny",
    label: "Tiny",
    size: 75,
    memory: 390,
    url: `${HF}/ggml-tiny.bin`,
    quality: "Rough. Fine for short commands in a quiet room.",
  },
  {
    id: "base",
    label: "Base",
    size: 142,
    memory: 500,
    url: `${HF}/ggml-base.bin`,
    quality: "Usable for dictation. Stumbles on names and accents.",
  },
  {
    id: "small",
    label: "Small",
    size: 466,
    memory: 1000,
    url: `${HF}/ggml-small.bin`,
    quality: "Good. The point where local stops feeling like a compromise.",
  },
  {
    id: "medium",
    label: "Medium",
    size: 1500,
    memory: 2600,
    url: `${HF}/ggml-medium.bin`,
    quality: "Very good, and noticeably slower without a GPU.",
  },
  {
    id: "large-v3-turbo",
    label: "Large v3 Turbo",
    size: 1620,
    memory: 3000,
    url: `${HF}/ggml-large-v3-turbo.bin`,
    quality: "Best available, and fast for its size. Wants real hardware.",
  },
];

export interface Machine {
  os: string;
  arch: string;
  cores: number;
  memory_mb: number;
}

export async function machine(): Promise<Machine> {
  if (!isTauri()) return { os: "browser", arch: "", cores: 0, memory_mb: 0 };
  return invoke<Machine>("machine_info");
}

export interface Recommendation {
  model: WhisperModel;
  /** Why this one — shown, because a bare verdict invites second-guessing. */
  because: string;
}

/**
 * Picks a model for this machine.
 *
 * Conservative on purpose. A model that is a little less accurate is a small
 * disappointment; one that pushes the machine into swapping while you are
 * dictating is the kind of thing that makes people uninstall an application.
 */
export function recommend(info: Machine): Recommendation {
  const gb = info.memory_mb / 1024;

  if (!info.memory_mb) {
    return {
      model: WHISPER_MODELS[1],
      because: "Conduit could not read how much memory this machine has, so this is the safe choice.",
    };
  }
  if (gb >= 24 && info.cores >= 8) {
    return {
      model: WHISPER_MODELS[4],
      because: `${Math.round(gb)} GB of memory and ${info.cores} cores. There is room for the best one.`,
    };
  }
  if (gb >= 16 && info.cores >= 6) {
    return {
      model: WHISPER_MODELS[3],
      because: `${Math.round(gb)} GB of memory. Medium is accurate and still comfortable here.`,
    };
  }
  if (gb >= 8) {
    return {
      model: WHISPER_MODELS[2],
      because: `${Math.round(gb)} GB of memory. Small is the best accuracy this can run without straining.`,
    };
  }
  return {
    model: WHISPER_MODELS[1],
    because: `${Math.round(gb)} GB of memory. Base keeps dictation responsive on a machine this size.`,
  };
}

/**
 * The whisper.cpp server build for this platform.
 *
 * whisper.cpp publishes its binaries on build tags (bNNNN), and the release
 * GitHub calls "latest" is a source-only version tag, so a /latest/download
 * link answers 404. This asks for the recent releases and takes the newest one
 * that actually carries the archive.
 */
const WHISPER_ASSET: Record<string, { asset: string; binary: string }> = {
  "windows-x86_64": { asset: "whisper-bin-x64.zip", binary: "whisper-server.exe" },
  "windows-aarch64": { asset: "whisper-bin-win-cpu-arm64.zip", binary: "whisper-server.exe" },
  "linux-x86_64": { asset: "whisper-bin-ubuntu-x64.tar.gz", binary: "whisper-server" },
  "linux-aarch64": { asset: "whisper-bin-ubuntu-arm64.tar.gz", binary: "whisper-server" },
};

export function runtimeFor(info: Machine): { asset: string; binary: string } | null {
  return WHISPER_ASSET[`${info.os}-${info.arch}`] ?? null;
}

export async function resolveRuntimeUrl(asset: string): Promise<string> {
  const res = await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when asked for whisper.cpp releases.`);
  const releases = (await res.json()) as Array<{
    draft: boolean;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>;
  for (const r of releases) {
    if (r.draft) continue;
    const hit = r.assets.find((x) => x.name === asset);
    if (hit) return hit.browser_download_url;
  }
  throw new Error(`No recent whisper.cpp release carries ${asset}.`);
}

export function manualInstructions(info: Machine): string {
  if (info.os === "macos") {
    return "Run brew install whisper-cpp, then point Conduit at the whisper-server binary below.";
  }
  if (info.os === "linux") {
    return "Build whisper.cpp from source (`cmake -B build && cmake --build build -j`), then point Conduit at `build/bin/whisper-server`.";
  }
  return "Download a whisper.cpp release for your platform and point Conduit at its server binary.";
}

// --- download ----------------------------------------------------------------

export interface Progress {
  id: string;
  received: number;
  total: number;
  done: boolean;
  error: string | null;
}

/** Streams a file to disk, calling back as it goes. */
export async function download(
  id: string,
  url: string,
  dest: string,
  onProgress: (p: Progress) => void,
): Promise<string> {
  const off = await listen<Progress>("conduit://download", (e) => {
    if (e.payload.id === id) onProgress(e.payload);
  });
  try {
    return await invoke<string>("download_file", { id, url, dest });
  } finally {
    off();
  }
}

export async function localDir(): Promise<string> {
  const base = await invoke<string>("data_dir");
  return `${base}/speech`;
}

// --- the server ---------------------------------------------------------------

const SERVER_ID = "local-whisper";

export function localSttUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1/audio/transcriptions`;
}

/**
 * Starts the local server, if one is configured and not already up.
 *
 * Failure is recorded and not thrown: the rest of Conduit works without it,
 * and the diagnostic in Settings → Voice is where somebody goes to find out
 * why. Throwing here would take out startup for a feature most people do not
 * use.
 */
export async function startLocalStt(): Promise<boolean> {
  if (!isTauri()) return false;
  const { localStt, stt } = getSettings();
  if (stt.provider !== "local" || !localStt.serverPath || !localStt.modelPath) return false;
  if (await invoke<boolean>("proc_running", { id: SERVER_ID }).catch(() => false)) return true;

  try {
    await invoke("proc_spawn", {
      id: SERVER_ID,
      program: localStt.serverPath,
      args: ["-m", localStt.modelPath, "--port", String(localStt.port), "--host", "127.0.0.1"],
      cwd: null,
      env: {},
    });
    return true;
  } catch (e) {
    console.error("[conduit] could not start the local speech server", e);
    return false;
  }
}

export async function stopLocalStt(): Promise<void> {
  if (!isTauri()) return;
  await invoke("proc_kill", { id: SERVER_ID }).catch(() => undefined);
}

export async function localSttRunning(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("proc_running", { id: SERVER_ID }).catch(() => false);
}

/**
 * Waits for the server to answer.
 *
 * whisper.cpp loads the model before it binds, and a large model on a cold
 * cache can take half a minute. Reporting "failed" the instant the port is not
 * yet open would be wrong in the most common case.
 */
export async function waitForLocalStt(port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await invoke<{ status: number }>("proxy_send", {
      request: {
        url: `http://127.0.0.1:${port}/`,
        method: "GET",
        headers: {},
        body: null,
        auth: null,
      },
    })
      .then((r) => r.status > 0)
      .catch(() => false);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return false;
}

/** Records a finished install and switches transcription over to it. */
export async function useLocal(model: string, modelPath: string, serverPath: string): Promise<void> {
  const settings = getSettings();
  const next = {
    ...settings,
    stt: { ...settings.stt, provider: "local" as const },
    localStt: { ...settings.localStt, model, modelPath, serverPath, autoStart: true },
  };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}
