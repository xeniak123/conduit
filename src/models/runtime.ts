import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getSettings, saveSettings, type CustomProvider } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { isDecisionModel } from "./decide";
import { fileUrl, hfAuth } from "./hub";
import type { Hardware, Quant } from "./quant";

/**
 * Running models on this computer.
 *
 * The runtime is llama.cpp's own server, fetched from its official releases on
 * first use and started as a child process on a loopback port. Once it answers,
 * it is registered as an ordinary OpenAI-compatible provider, which is why a
 * local model works in chat, in the agent, in dictation clean-up and through
 * the API without any of them knowing it is local.
 */

export type Backend = "cuda" | "vulkan" | "cpu" | "metal";

export interface LibraryEntry {
  /** `repo:quant`. */
  id: string;
  repo: string;
  quant: string;
  /** Short display name. */
  name: string;
  /** Absolute path of the file to load (the first part, for split models). */
  path: string;
  files: string[];
  size: number;
  at: number;
}

export interface Download {
  id: string;
  repo: string;
  quant: string;
  received: number;
  total: number;
  /** Which of several files is in flight. */
  part: number;
  parts: number;
  state: "running" | "failed" | "cancelled";
  error?: string;
}

export interface Loaded {
  id: string;
  name: string;
  port: number;
  context: number;
  gpuLayers: number;
  startedAt: number;
  /** A decision model: answers with option probabilities, never with text. */
  decision?: boolean;
}

export interface LoadOptions {
  context: number;
  /** 999 means "everything that fits". */
  gpuLayers: number;
  flashAttention: boolean;
}

interface RuntimeState {
  hardware: Hardware | null;
  library: LibraryEntry[];
  downloads: Record<string, Download>;
  runtimePath: string | null;
  backend: Backend | null;
  installing: { received: number; total: number; label: string } | null;
  loaded: Loaded | null;
  loading: string | null;
  log: string[];
  error: string | null;

  set: (patch: Partial<RuntimeState>) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  hardware: null,
  library: [],
  downloads: {},
  runtimePath: null,
  backend: null,
  installing: null,
  loaded: null,
  loading: null,
  log: [],
  error: null,
  set: (patch) => set(patch),
}));

const PORT = 8643;
const SERVER_ID = "llama-server";

async function dataDir(): Promise<string> {
  return invoke<string>("data_dir");
}

async function modelsDir(): Promise<string> {
  return `${await dataDir()}/models`;
}

// --- hardware -------------------------------------------------------------------

export async function detectHardware(): Promise<Hardware> {
  const existing = useRuntime.getState().hardware;
  if (existing) return existing;

  if (!isTauri()) {
    const guess: Hardware = { vram: 0, ram: 0, gpu: null, cores: navigator.hardwareConcurrency || 0, vendor: null };
    useRuntime.getState().set({ hardware: guess });
    return guess;
  }

  const [machine, gpu] = await Promise.all([
    invoke<{ cores: number; memory_mb: number; os: string; arch: string }>("machine_info"),
    invoke<{ name: string; vram_mb: number; vendor: string }>("gpu_info").catch(() => null),
  ]);

  const hardware: Hardware = {
    vram: gpu?.vram_mb ?? 0,
    ram: machine.memory_mb,
    gpu: gpu?.name || null,
    cores: machine.cores,
    vendor: (gpu?.vendor as Hardware["vendor"]) || null,
  };
  useRuntime.getState().set({ hardware });
  return hardware;
}

/** The backend that will be fastest on this machine. */
export function preferredBackend(hw: Hardware): Backend {
  if (hw.vendor === "apple") return "metal";
  if (hw.vendor === "nvidia") return "cuda";
  if (hw.vram > 0) return "vulkan";
  return "cpu";
}

// --- library -----------------------------------------------------------------------

export async function loadLibrary(): Promise<LibraryEntry[]> {
  if (!isTauri()) return [];
  try {
    const text = await invoke<string>("fs_read", { path: `${await modelsDir()}/library.json`, limit: 2_000_000 });
    const parsed = JSON.parse(text) as { entries?: LibraryEntry[]; runtime?: { path: string; backend: Backend } };
    const entries = parsed.entries ?? [];
    // Files deleted outside Conduit should disappear from the list, not fail to load.
    const present: LibraryEntry[] = [];
    for (const entry of entries) {
      if (await invoke<boolean>("fs_exists", { path: entry.path })) present.push(entry);
    }
    useRuntime.getState().set({
      library: present,
      runtimePath: parsed.runtime?.path ?? null,
      backend: parsed.runtime?.backend ?? null,
    });
    return present;
  } catch {
    return [];
  }
}

async function saveLibrary(): Promise<void> {
  const { library, runtimePath, backend } = useRuntime.getState();
  await invoke("fs_write", {
    path: `${await modelsDir()}/library.json`,
    contents: JSON.stringify(
      { entries: library, runtime: runtimePath && backend ? { path: runtimePath, backend } : null },
      null,
      2,
    ),
  });
}

// --- downloads -----------------------------------------------------------------------

export async function downloadQuant(repo: string, quant: Quant): Promise<LibraryEntry> {
  const id = `${repo}:${quant.name}`;
  const store = useRuntime.getState();
  if (store.downloads[id]?.state === "running") throw new Error("Already downloading.");

  const base = `${await modelsDir()}/${repo}`;
  const update = (patch: Partial<Download>) => {
    const current = useRuntime.getState().downloads[id];
    useRuntime.getState().set({
      downloads: { ...useRuntime.getState().downloads, [id]: { ...(current as Download), ...patch } },
    });
  };

  useRuntime.getState().set({
    downloads: {
      ...store.downloads,
      [id]: {
        id,
        repo,
        quant: quant.name,
        received: 0,
        total: quant.size,
        part: 1,
        parts: quant.files.length,
        state: "running",
      },
    },
  });

  let done = 0;
  const paths: string[] = [];
  const off = await listen<{ id: string; received: number }>("conduit://download", (e) => {
    if (e.payload.id.startsWith(`${id}#`)) update({ received: done + e.payload.received });
  });

  try {
    for (let i = 0; i < quant.files.length; i += 1) {
      const file = quant.files[i];
      update({ part: i + 1 });
      const dest = `${base}/${file.path}`;
      if (!(await invoke<boolean>("fs_exists", { path: dest }))) {
        await invoke<string>("download_file", {
          id: `${id}#${i}`,
          url: fileUrl(repo, file.path),
          dest,
          hfToken: hfAuth() !== null,
        });
      }
      done += file.size;
      paths.push(dest);
      update({ received: done });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    update({ state: message === "Cancelled." ? "cancelled" : "failed", error: message });
    throw e;
  } finally {
    off();
  }

  const entry: LibraryEntry = {
    id,
    repo,
    quant: quant.name,
    name: `${repo.split("/").pop()?.replace(/-GGUF$/i, "")} ${quant.name}`,
    path: paths[0],
    files: paths,
    size: quant.size,
    at: Date.now(),
  };

  const { [id]: _finished, ...rest } = useRuntime.getState().downloads;
  useRuntime.getState().set({
    downloads: rest,
    library: [entry, ...useRuntime.getState().library.filter((e) => e.id !== id)],
  });
  await saveLibrary();
  return entry;
}

export async function cancelDownload(id: string): Promise<void> {
  const download = useRuntime.getState().downloads[id];
  if (!download) return;
  await invoke("download_cancel", { id: `${id}#${download.part - 1}` });
}

export function dismissDownload(id: string): void {
  const { [id]: _gone, ...rest } = useRuntime.getState().downloads;
  useRuntime.getState().set({ downloads: rest });
}

export async function removeModel(entry: LibraryEntry): Promise<void> {
  if (useRuntime.getState().loaded?.id === entry.id) await eject();
  for (const file of entry.files) {
    await invoke("fs_remove", { path: file }).catch(() => undefined);
  }
  useRuntime.getState().set({ library: useRuntime.getState().library.filter((e) => e.id !== entry.id) });
  await saveLibrary();
}

// --- the runtime itself ---------------------------------------------------------------

interface Release {
  tag_name: string;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

/**
 * Which archive to fetch. Checked against the real release listing: builds are
 * tagged `bNNNNN`, published as pre-releases (so GitHub's "latest" endpoint
 * never returns them), zipped on Windows and tarred everywhere else. Each
 * backend lists its preferred archive first; CUDA 12 before 13, because far
 * more installed drivers support it.
 */
const ASSET: Record<string, Partial<Record<Backend, RegExp[]>>> = {
  windows: {
    cuda: [/-bin-win-cuda-12\.\d+-x64\.zip$/, /-bin-win-cuda-\d+\.\d+-x64\.zip$/],
    vulkan: [/-bin-win-vulkan-x64\.zip$/],
    cpu: [/-bin-win-cpu-x64\.zip$/, /-bin-win-avx2-x64\.zip$/],
  },
  macos: { metal: [/-bin-macos-arm64\.(tar\.gz|zip)$/], cpu: [/-bin-macos-x64\.(tar\.gz|zip)$/] },
  linux: {
    cuda: [/-bin-ubuntu-cuda-12\.\d+-x64\.tar\.gz$/, /-bin-ubuntu-cuda-\d+\.\d+-x64\.tar\.gz$/],
    vulkan: [/-bin-ubuntu-vulkan-x64\.(tar\.gz|zip)$/],
    cpu: [/-bin-ubuntu-x64\.(tar\.gz|zip)$/],
  },
};

export interface RuntimeChoice {
  backend: Backend;
  label: string;
  detail: string;
  size: number;
}

const RELEASE_CACHE = "conduit.llama-release.v1";

/**
 * The newest llama.cpp build that has server archives.
 *
 * GitHub allows sixty anonymous API calls an hour per address, which a shared
 * network can exhaust. The last good answer is kept, so a rate limit or a
 * flaky connection falls back to a build that is at most a little older
 * instead of stopping anyone from running a model.
 */
async function latestBuild(): Promise<Release> {
  let cached: Release | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(RELEASE_CACHE) ?? "null") as Release | null;
  } catch {
    cached = null;
  }
  try {
    const response = await invoke<{ status: number; body: string }>("proxy_send", {
      request: {
        url: "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20",
        method: "GET",
        headers: { "user-agent": "Conduit", accept: "application/vnd.github+json" },
        body: null,
        auth: null,
      },
    });
    if (response.status !== 200) {
      throw new Error(
        response.status === 403 || response.status === 429
          ? "GitHub is rate-limiting this network. Try again in a few minutes."
          : `GitHub answered ${response.status}.`,
      );
    }
    const releases = JSON.parse(response.body) as Release[];
    const build = releases.find(
      (r) => /^b\d+$/.test(r.tag_name) && r.assets.some((a) => /-bin-/.test(a.name)),
    );
    if (!build) throw new Error("GitHub listed no llama.cpp build with downloads.");
    try {
      localStorage.setItem(RELEASE_CACHE, JSON.stringify({ tag_name: build.tag_name, assets: build.assets }));
    } catch {
      /* the cache is a convenience */
    }
    return build;
  } catch (e) {
    if (cached?.assets?.length) return cached;
    throw e;
  }
}

export function archivesFor(release: Release, os: string, backend: Backend) {
  const patterns = ASSET[os]?.[backend];
  if (!patterns) return null;
  let main: Release["assets"][number] | undefined;
  for (const pattern of patterns) {
    // Only the server archives themselves: the CUDA runtime is published as
    // "cudart-llama-bin-win-cuda-12.4-x64.zip", which matches the same
    // pattern and sorts first, and taking it meant llama-server never arrived.
    main = release.assets.find((a) => a.name.startsWith("llama-") && pattern.test(a.name));
    if (main) break;
  }
  if (!main) return null;
  const list = [main];
  if (backend === "cuda") {
    const version = /cuda-(\d+\.\d+)/.exec(main.name)?.[1];
    // Same system and same archive type as the server: Linux runtimes are
    // published alongside and must never be unpacked into a Windows install.
    const platform = main.name.includes("-win-") ? "-win-" : "-ubuntu-";
    const ext = main.name.endsWith(".zip") ? ".zip" : ".tar.gz";
    const cudart = release.assets.find(
      (a) =>
        a.name.startsWith("cudart-") &&
        a.name.includes(platform) &&
        version !== undefined &&
        a.name.endsWith(`cuda-${version}-x64${ext}`),
    );
    if (cudart) list.push(cudart);
  }
  return list;
}

/** What can be installed here, with real download sizes, for the chooser. */
export async function runtimeChoices(): Promise<RuntimeChoice[]> {
  const [release, machine] = await Promise.all([
    latestBuild(),
    invoke<{ os: string }>("machine_info"),
  ]);
  const describe: Record<Backend, [string, string]> = {
    cuda: ["NVIDIA CUDA", "Fastest on NVIDIA cards. Includes the CUDA runtime."],
    vulkan: ["Vulkan", "Works on any modern GPU: NVIDIA, AMD and Intel."],
    metal: ["Metal", "Apple Silicon GPU."],
    cpu: ["CPU only", "No GPU needed. Slow for anything above a few billion parameters."],
  };
  const out: RuntimeChoice[] = [];
  for (const backend of ["cuda", "vulkan", "metal", "cpu"] as Backend[]) {
    const archives = archivesFor(release, machine.os, backend);
    if (!archives) continue;
    out.push({
      backend,
      label: describe[backend][0],
      detail: describe[backend][1],
      size: archives.reduce((sum, a) => sum + a.size, 0),
    });
  }
  return out;
}

/**
 * Fetches llama.cpp's server for this platform and backend.
 *
 * Always the newest official build, straight from GitHub, so a model
 * architecture that shipped last week loads without waiting for a Conduit
 * update.
 */
export async function installRuntime(backend: Backend): Promise<string> {
  const machine = await invoke<{ os: string; arch: string }>("machine_info");
  const release = await latestBuild();
  const archives = archivesFor(release, machine.os, backend);
  if (!archives) throw new Error(`No ${backend} build is published for ${machine.os}.`);

  const dir = `${await dataDir()}/runtime/llama-${release.tag_name}-${backend}`;
  const total = archives.reduce((sum, a) => sum + a.size, 0);
  let done = 0;

  const off = await listen<{ id: string; received: number }>("conduit://download", (e) => {
    if (e.payload.id.startsWith("llama-runtime#")) {
      useRuntime.getState().set({
        installing: { received: done + e.payload.received, total, label: `llama.cpp ${release.tag_name}` },
      });
    }
  });

  try {
    useRuntime.getState().set({ installing: { received: 0, total, label: `llama.cpp ${release.tag_name}` } });
    for (let i = 0; i < archives.length; i += 1) {
      const archive = await invoke<string>("download_file", {
        id: `llama-runtime#${i}`,
        url: archives[i].browser_download_url,
        dest: `${dir}/${archives[i].name}`,
      });
      await invoke("unzip_file", { archive, dest: dir });
      await invoke("fs_remove", { path: archive }).catch(() => undefined);
      done += archives[i].size;
    }
  } finally {
    off();
    useRuntime.getState().set({ installing: null });
  }

  const binary = machine.os === "windows" ? "llama-server.exe" : "llama-server";
  const path = await invoke<string>("find_file", { root: dir, name: binary }).catch(async () => {
    // A half-installed folder would fail the same way on every retry, so it
    // goes, and the next attempt starts from nothing.
    await invoke("fs_remove", { path: dir }).catch(() => undefined);
    throw new Error("llama.cpp downloaded, but the server program was not in it. Press Install to try again.");
  });
  if (machine.os !== "windows") {
    await invoke("run_command", { command: `chmod +x "${path}"`, cwd: null }).catch(() => undefined);
  }

  useRuntime.getState().set({ runtimePath: path, backend });
  await saveLibrary();
  return path;
}

let exitWatch: Promise<() => void> | null = null;

/** Loads a downloaded model and makes it the "This computer" provider. */
export async function load(entry: LibraryEntry, options: LoadOptions): Promise<void> {
  const state = useRuntime.getState();
  let runtime = state.runtimePath;
  if (!runtime) {
    const hw = await detectHardware();
    runtime = await installRuntime(preferredBackend(hw));
  }

  await eject();
  useRuntime.getState().set({ loading: entry.id, error: null, log: [] });

  exitWatch ??= Promise.all([
    listen<{ id: string; line: string }>("conduit://proc-err", (e) => {
      if (e.payload.id !== SERVER_ID) return;
      const log = [...useRuntime.getState().log, e.payload.line].slice(-80);
      useRuntime.getState().set({ log });
    }),
    listen<{ id: string; code: number }>("conduit://proc-exit", (e) => {
      if (e.payload.id !== SERVER_ID) return;
      const was = useRuntime.getState();
      useRuntime.getState().set({
        loaded: null,
        loading: null,
        error:
          was.loading || was.loaded
            ? `The model server stopped (exit ${e.payload.code}). ${lastUseful(was.log)}`
            : null,
      });
    }),
  ]).then((offs) => () => offs.forEach((off) => off()));

  const args = [
    "-m",
    entry.path,
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT),
    "-c",
    String(options.context),
    "-ngl",
    String(options.gpuLayers),
    // Chat templates with tool calling; without this the agent cannot use tools.
    "--jinja",
    "--alias",
    entry.name,
  ];
  if (options.flashAttention) args.push("-fa", "on");

  await invoke("proc_spawn", { id: SERVER_ID, program: runtime, args, cwd: null, env: {} });

  const ready = await waitForHealth(180_000);
  if (!ready) {
    const log = useRuntime.getState().log;
    await invoke("proc_kill", { id: SERVER_ID }).catch(() => undefined);
    useRuntime.getState().set({
      loading: null,
      error: `The model did not start in time. ${lastUseful(log)}`,
    });
    return;
  }

  useRuntime.getState().set({
    loading: null,
    loaded: {
      id: entry.id,
      name: entry.name,
      port: PORT,
      context: options.context,
      gpuLayers: options.gpuLayers,
      startedAt: Date.now(),
      decision: isDecisionModel(`${entry.repo} ${entry.name}`),
    },
  });
  // A decision model would answer a chat with gibberish, so it is offered in
  // the Decisions console and the API rather than in the model switcher.
  if (useRuntime.getState().loaded?.decision) return;
  await registerProvider(entry.name);
}

async function waitForHealth(timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!useRuntime.getState().loading) return false;
    const status = await invoke<{ status: number }>("proxy_send", {
      request: { url: `http://127.0.0.1:${PORT}/health`, method: "GET", headers: {}, body: null, auth: null },
    })
      .then((r) => r.status)
      .catch(() => 0);
    if (status === 200) return true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

/** The last line of the server log that says something, for error messages. */
function lastUseful(log: string[]): string {
  const line = [...log].reverse().find((l) => /error|failed|out of memory|unable/i.test(l));
  return line ? line.replace(/^.*?(error|failed)/i, "$1").slice(0, 220) : "";
}

export async function eject(): Promise<void> {
  if (!isTauri()) return;
  const was = useRuntime.getState().loaded;
  useRuntime.getState().set({ loaded: null, loading: null });
  await invoke("proc_kill", { id: SERVER_ID }).catch(() => undefined);
  if (was) await unregisterProvider();
}

export const LOCAL_PROVIDER = "local";

async function registerProvider(model: string): Promise<void> {
  const settings = getSettings();
  const provider: CustomProvider = {
    id: LOCAL_PROVIDER,
    label: "This computer",
    baseUrl: `http://127.0.0.1:${PORT}/v1`,
    needsKey: false,
    models: [model],
  };
  const next = {
    ...settings,
    customProviders: [...settings.customProviders.filter((p) => p.id !== LOCAL_PROVIDER), provider],
  };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}

async function unregisterProvider(): Promise<void> {
  const settings = getSettings();
  const next = {
    ...settings,
    customProviders: settings.customProviders.filter((p) => p.id !== LOCAL_PROVIDER),
    command:
      settings.command.provider === LOCAL_PROVIDER
        ? { provider: "anthropic", model: "claude-opus-5" }
        : settings.command,
  };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}

/** Points chat at the loaded model. */
export async function useInChat(): Promise<void> {
  const loaded = useRuntime.getState().loaded;
  if (!loaded) return;
  const settings = getSettings();
  const next = { ...settings, command: { provider: LOCAL_PROVIDER, model: loaded.name } };
  useApp.getState().setSettings(next);
  await saveSettings(next);
}
