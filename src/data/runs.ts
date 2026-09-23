import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { isTauri } from "@/core/host";
import { PACKAGES, parseProgress, trainingScript, type TuneConfig } from "./tune";

/**
 * A training run, followed from inside Conduit.
 *
 * The script runs as a child process with its output streamed back line by
 * line: the Current run tab shows the log, and the script's progress lines
 * become a step counter and a loss curve. Stop really stops it. Runs are kept
 * in History with their curve, so yesterday's loss can be compared with
 * today's.
 *
 * The Hugging Face token reaches the script as `secret:huggingface`, which the
 * native layer swaps for the stored token on its way into the child's
 * environment. It is never read here.
 */

const PROC = "training";
const SETUP = "training-setup";
const HISTORY_KEY = "conduit.training.history.v1";
const MAX_LOG = 600;
const MAX_POINTS = 400;

export type RunStatus = "starting" | "running" | "done" | "failed" | "stopped";

export interface Point {
  step: number;
  loss: number;
}

export interface Run {
  id: string;
  name: string;
  model: string;
  dataset: string;
  method: TuneConfig["method"];
  output: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  step: number;
  maxSteps: number;
  loss: Point[];
  evalLoss: Point[];
  learningRate?: number;
  epoch?: number;
  error?: string;
  config: TuneConfig;
}

export interface Environment {
  python: string | null;
  missing: string[];
  cuda: boolean | null;
  gpu: string | null;
  checked: boolean;
}

interface TrainingState {
  current: Run | null;
  log: string[];
  history: Run[];
  env: Environment;
  installing: boolean;
  set: (patch: Partial<TrainingState>) => void;
}

function loadHistory(): Run[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Run[];
  } catch {
    return [];
  }
}

function saveHistory(runs: Run[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, 30)));
  } catch {
    /* history is a convenience; losing it loses nothing else */
  }
}

export const useTraining = create<TrainingState>((set) => ({
  current: null,
  log: [],
  history: loadHistory(),
  env: { python: null, missing: [], cuda: null, gpu: null, checked: false },
  installing: false,
  set: (patch) => set(patch),
}));

/** Keeps the curve light: past the limit, every other point is dropped. */
function thin(points: Point[]): Point[] {
  return points.length <= MAX_POINTS ? points : points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
}

function appendLog(line: string): void {
  const state = useTraining.getState();
  const log = state.log.length >= MAX_LOG ? [...state.log.slice(-MAX_LOG + 1), line] : [...state.log, line];
  state.set({ log });
}

function patchRun(patch: Partial<Run>): void {
  const state = useTraining.getState();
  if (!state.current) return;
  state.set({ current: { ...state.current, ...patch } });
}

function finish(status: RunStatus, error?: string): void {
  const state = useTraining.getState();
  const run = state.current;
  if (!run || run.status === "done" || run.status === "failed" || run.status === "stopped") return;
  const ended: Run = { ...run, status, error, endedAt: Date.now() };
  const history = [ended, ...state.history.filter((r) => r.id !== ended.id)];
  saveHistory(history);
  state.set({ current: ended, history });
}

let listening: Promise<() => void> | null = null;

/** One set of listeners for the whole session; lines are routed by process id. */
function ensureListening(): Promise<() => void> {
  listening ??= Promise.all([
    listen<{ id: string; line: string }>("conduit://proc-out", (e) => onLine(e.payload.id, e.payload.line)),
    listen<{ id: string; line: string }>("conduit://proc-err", (e) => onLine(e.payload.id, e.payload.line)),
    listen<{ id: string; code: number }>("conduit://proc-exit", (e) => onExit(e.payload.id, e.payload.code)),
  ]).then((offs) => () => offs.forEach((off) => off()));
  return listening;
}

function onLine(id: string, line: string): void {
  if (id !== PROC && id !== SETUP) return;
  const progress = id === PROC ? parseProgress(line) : null;
  if (!progress) {
    // Progress bars redraw with carriage returns; only the last frame matters.
    const text = line.split("\r").pop() ?? line;
    if (text.trim()) appendLog(text);
    return;
  }
  const run = useTraining.getState().current;
  if (!run) return;
  if (progress.done) {
    finish("done");
    return;
  }
  const step = progress.step ?? run.step;
  patchRun({
    status: "running",
    step,
    maxSteps: progress.maxSteps ?? run.maxSteps,
    learningRate: progress.learningRate ?? run.learningRate,
    epoch: progress.epoch ?? run.epoch,
    loss: progress.loss !== undefined ? thin([...run.loss, { step, loss: progress.loss }]) : run.loss,
    evalLoss: progress.evalLoss !== undefined ? [...run.evalLoss, { step, loss: progress.evalLoss }] : run.evalLoss,
  });
}

function onExit(id: string, code: number): void {
  if (id === SETUP) {
    useTraining.getState().set({ installing: false });
    appendLog(code === 0 ? "Packages installed." : `pip exited with code ${code}.`);
    void checkEnvironment();
    return;
  }
  if (id !== PROC) return;
  const run = useTraining.getState().current;
  if (!run) return;
  if (run.status === "stopped" || run.status === "done") return;
  if (code === 0) finish("done");
  else finish("failed", explainFailure(useTraining.getState().log));
}

/** The last useful line of a traceback, said the way a person would. */
export function explainFailure(log: string[]): string {
  const tail = log.slice(-60).join("\n");
  if (/CUDA out of memory|OutOfMemoryError/i.test(tail)) {
    return "The GPU ran out of memory. Try QLoRA, a smaller batch size, a shorter context length or a smaller model.";
  }
  if (/No module named '([^']+)'/.test(tail)) {
    const name = /No module named '([^']+)'/.exec(tail)![1];
    return `Python is missing the ${name} package. Use "Install packages" and start again.`;
  }
  if (/401|gated repo|Access to model .* is restricted/i.test(tail)) {
    return "That model or dataset is gated. Accept its licence on huggingface.co and connect a Hugging Face token in Model hub.";
  }
  if (/not installed, or not on PATH/i.test(tail)) {
    return "Python was not found. Install Python 3.10 or newer from python.org and tick \"Add to PATH\".";
  }
  const last = [...log].reverse().find((l) => /Error|Exception/.test(l));
  return last?.trim() || "Training stopped with an error. The log above has the details.";
}

/** Where Conduit keeps training runs and the scripts it writes for them. */
export async function trainingDir(): Promise<string> {
  const base = isTauri() ? await invoke<string>("data_dir") : "C:/Users/you/AppData/Roaming/conduit";
  return `${base}/training`;
}

export async function startRun(config: TuneConfig): Promise<void> {
  if (!isTauri()) throw new Error("Training runs in the desktop app.");
  const state = useTraining.getState();
  if (state.current && (state.current.status === "running" || state.current.status === "starting")) {
    throw new Error("A training run is already going. Stop it first.");
  }
  await ensureListening();

  const script = `${config.output}/train.py`;
  await invoke("fs_write", { path: script, contents: trainingScript(config) });

  const run: Run = {
    id: crypto.randomUUID(),
    name: config.name.trim() || config.model.split("/").pop() || "Run",
    model: config.model,
    dataset: config.hubDataset || config.dataset,
    method: config.method,
    output: config.output,
    startedAt: Date.now(),
    status: "starting",
    step: 0,
    maxSteps: config.useEpochs ? 0 : config.maxSteps,
    loss: [],
    evalLoss: [],
    config,
  };
  state.set({ current: run, log: [`$ python -u "${script}"`] });

  try {
    await invoke("proc_spawn", {
      id: PROC,
      program: "python",
      args: ["-u", script],
      cwd: config.output,
      env: { HF_TOKEN: "secret:huggingface", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendLog(message);
    finish("failed", explainFailure([message]));
    throw e;
  }
}

export async function stopRun(): Promise<void> {
  const run = useTraining.getState().current;
  if (!run || (run.status !== "running" && run.status !== "starting")) return;
  patchRun({ status: "stopped", endedAt: Date.now() });
  const state = useTraining.getState();
  const history = [state.current!, ...state.history.filter((r) => r.id !== run.id)];
  saveHistory(history);
  state.set({ history });
  appendLog("Stopped. Checkpoints saved so far are kept in the output folder.");
  await invoke("proc_kill", { id: PROC }).catch(() => undefined);
}

export function forgetRun(id: string): void {
  const state = useTraining.getState();
  const history = state.history.filter((r) => r.id !== id);
  saveHistory(history);
  state.set({ history });
}

const CHECK = `import importlib.util, json, sys
out = {"python": sys.version.split()[0], "missing": [m for m in ${JSON.stringify(PACKAGES)} if importlib.util.find_spec(m) is None], "cuda": None, "gpu": None}
try:
    import torch
    out["cuda"] = bool(torch.cuda.is_available())
    out["gpu"] = torch.cuda.get_device_name(0) if out["cuda"] else None
except Exception:
    pass
print(json.dumps(out))
`;

/** Is there a Python that can train, and what is it missing? */
export async function checkEnvironment(): Promise<Environment> {
  const set = useTraining.getState().set;
  if (!isTauri()) {
    const env = { python: null, missing: [...PACKAGES], cuda: null, gpu: null, checked: true };
    set({ env });
    return env;
  }
  const path = `${await trainingDir()}/check_environment.py`;
  let env: Environment = { python: null, missing: [...PACKAGES], cuda: null, gpu: null, checked: true };
  try {
    await invoke("fs_write", { path, contents: CHECK });
    const result = await invoke<{ stdout: string; stderr: string; code: number }>("run_command", {
      command: `python "${path}"`,
      cwd: null,
    });
    const line = result.stdout.trim().split("\n").pop() ?? "";
    const parsed = JSON.parse(line) as Omit<Environment, "checked">;
    env = { ...parsed, checked: true };
  } catch {
    /* no Python on PATH: the defaults above say so */
  }
  set({ env });
  return env;
}

/**
 * Installs what is missing, into the Python on PATH, with the output in the
 * run log. PyTorch comes from its CUDA index when there is an NVIDIA card, so
 * training does not silently fall back to the CPU.
 */
export async function installPackages(nvidia: boolean): Promise<void> {
  if (!isTauri()) return;
  await ensureListening();
  const env = useTraining.getState().env;
  const missing = env.missing.length ? env.missing : [...PACKAGES];
  const torch = missing.includes("torch");
  const rest = missing.filter((m) => m !== "torch");
  useTraining.getState().set({ installing: true, log: [] });

  const steps: string[][] = [];
  if (torch) {
    steps.push(
      nvidia
        ? ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cu124"]
        : ["-m", "pip", "install", "torch"],
    );
  }
  if (rest.length) steps.push(["-m", "pip", "install", "--upgrade", ...rest]);

  // pip runs are chained through one small script so they share a single
  // process id and a single exit event.
  const script = `${await trainingDir()}/install_packages.py`;
  const body = [
    "import subprocess, sys",
    ...steps.map((args) => `subprocess.check_call([sys.executable, ${args.map((a) => JSON.stringify(a)).join(", ")}])`),
  ].join("\n");
  await invoke("fs_write", { path: script, contents: body });
  appendLog(`$ python ${steps.map((s) => s.join(" ")).join(" && python ")}`);
  await invoke("proc_spawn", { id: SETUP, program: "python", args: ["-u", script], cwd: null, env: { PYTHONUNBUFFERED: "1" } });
}
