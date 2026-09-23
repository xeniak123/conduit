/**
 * Fine-tuning, planned here and run by Python.
 *
 * Nothing in this file trains anything. Training needs PyTorch and a CUDA
 * toolchain, which is not something a desktop app should smuggle in behind a
 * button — so Conduit does the part it is good at: working out whether the
 * machine can do the job, picking parameters that will not blow up, writing a
 * script the user can read, and running it with its progress on screen. The
 * script is plain `transformers` + `peft` + `trl`, so it keeps working when
 * this app is not in the room.
 */

export type Method = "qlora" | "lora" | "full" | "cpt";

export interface TuneConfig {
  /** Optional name for the run, used for its folder and in History. */
  name: string;
  /** Base model: a Hugging Face repository or a folder on this machine. */
  model: string;
  /** Path to the training file (JSONL) on this machine. */
  dataset: string;
  /** Optional evaluation file, scored while training runs. */
  evalDataset: string;
  /** Where the adapter (or the trained model) is written. */
  output: string;
  method: Method;
  /** Train for a number of steps (quick, predictable) or whole epochs. */
  useEpochs: boolean;
  maxSteps: number;
  epochs: number;
  learningRate: number;
  batchSize: number;
  gradientAccumulation: number;
  sequenceLength: number;
  /** LoRA rank. Ignored by a full fine-tune. */
  rank: number;
  /** Conventionally twice the rank. */
  alpha: number;
  dropout: number;
  warmupSteps: number;
  weightDecay: number;
  seed: number;
  /**
   * A Hugging Face dataset, read by the script itself with `load_dataset`
   * when training starts, instead of a local file. Empty for a local file.
   */
  hubDataset: string;
  hubSubset: string;
  hubSplit: string;
  /** "" for no evaluation. */
  hubEvalSplit: string;
  /** Which columns hold what: the question (or a whole conversation), the answer, an instruction, extra context. For raw text, `mapPrompt` is the text. */
  mapPrompt: string;
  mapResponse: string;
  mapSystem: string;
  mapContext: string;
}

export interface MethodInfo {
  id: Method;
  label: string;
  /** One line, shown beside the choice. */
  detail: string;
  /** What the card on the right says about precision. */
  bits: string;
  colour: "green" | "blue" | "amber" | "violet";
}

export const METHODS: MethodInfo[] = [
  {
    id: "qlora",
    label: "QLoRA",
    detail: "4-bit quantization. Lowest VRAM, fastest to start.",
    bits: "4-bit",
    colour: "green",
  },
  {
    id: "lora",
    label: "LoRA",
    detail: "16-bit base with a small adapter. Faster steps, needs more VRAM.",
    bits: "16-bit",
    colour: "blue",
  },
  {
    id: "full",
    label: "Full fine-tune",
    detail: "Every weight is trained. Best results, by far the most memory.",
    bits: "16-bit",
    colour: "amber",
  },
  {
    id: "cpt",
    label: "Continued pretraining",
    detail: "Plain text in, new knowledge out: documents, code, books. No chat format.",
    bits: "16-bit",
    colour: "violet",
  },
];

export const DEFAULTS: TuneConfig = {
  name: "",
  model: "unsloth/Qwen3-4B-Instruct",
  dataset: "",
  evalDataset: "",
  output: "",
  method: "qlora",
  useEpochs: false,
  maxSteps: 60,
  epochs: 1,
  learningRate: 2e-4,
  batchSize: 2,
  gradientAccumulation: 4,
  sequenceLength: 2048,
  rank: 16,
  alpha: 32,
  dropout: 0,
  warmupSteps: 5,
  weightDecay: 0.01,
  seed: 3407,
  hubDataset: "",
  hubSubset: "",
  hubSplit: "train",
  hubEvalSplit: "",
  mapPrompt: "",
  mapResponse: "",
  mapSystem: "",
  mapContext: "",
};

export const CONTEXT_LENGTHS = [1024, 2048, 4096, 8192, 16384, 32768];

/** Bytes per parameter that each method has to hold, weights plus optimiser. */
const COST: Record<Method, number> = {
  // 4-bit weights, plus the adapter and its optimiser state.
  qlora: 0.75,
  // 16-bit weights, adapter and optimiser on top.
  lora: 2.4,
  cpt: 2.4,
  // 16-bit weights, 16-bit gradients, and Adam's two 32-bit moments.
  full: 16,
};

export interface Estimate {
  /** Gigabytes of VRAM the run is expected to need. */
  needed: number;
  fits: boolean;
  note: string;
}

/**
 * Will this run, on this machine?
 *
 * A rough number said plainly beats an exact number nobody sees: the failure
 * this prevents is a long download followed by an out-of-memory crash thirty
 * seconds into training.
 */
export function estimate(parameters: number, config: TuneConfig, vramGb: number | null): Estimate {
  const weights = (parameters * COST[config.method]) / 1e9;
  // Activations scale with how much text is in flight at once; gradient
  // checkpointing keeps them roughly linear in the sequence length.
  const activations = (config.sequenceLength / 2048) * config.batchSize * 0.75;
  const needed = Math.round((weights + activations) * 10) / 10;

  if (vramGb === null) {
    return { needed, fits: true, note: `About ${needed} GB of VRAM. Conduit could not read this machine's GPU.` };
  }
  const fits = needed <= vramGb * 0.92;
  return {
    needed,
    fits,
    note: fits
      ? `About ${needed} GB of VRAM, and this GPU has ${vramGb} GB. That fits.`
      : `About ${needed} GB of VRAM, and this GPU has ${vramGb} GB. Try QLoRA, a shorter context, a smaller batch or a smaller model.`,
  };
}

/** Parameter count from a model name, when the name says it — "Qwen3-4B" → 4e9. */
export function parametersFromName(id: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[bB]\b/.exec(id.replace(/[-_]/g, " "));
  return match ? Number(match[1]) * 1e9 : null;
}

/** "Qwen/Qwen2.5-Coder-7B-Instruct" → "QWEN", for the label above the name. */
export function family(model: string): string {
  const name = model.split(/[\\/]/).pop() ?? model;
  const match = /^[A-Za-z]+/.exec(name);
  return (match?.[0] ?? name).toUpperCase();
}

export const PACKAGES = ["torch", "transformers", "peft", "trl", "datasets", "accelerate", "bitsandbytes"];

/** Examples each optimiser step sees. */
export function effectiveBatch(config: TuneConfig): number {
  return config.batchSize * config.gradientAccumulation;
}

/** The line the generated script prints for Conduit to follow along. */
export const PROGRESS_TAG = "CONDUIT ";

/**
 * The training script.
 *
 * Written out in full rather than hidden behind a Conduit-specific runner, so
 * that what runs on the machine is something the user can read, keep, edit and
 * run again next month without this app. The one Conduit-specific part is a
 * callback that prints progress as JSON lines, which is how the Current run
 * tab draws its chart; run from a terminal it is just a line in the log.
 */
export function trainingScript(config: TuneConfig): string {
  const quantised = config.method === "qlora";
  const adapter = config.method !== "full";
  const raw = config.method === "cpt";
  const length = config.useEpochs ? `num_train_epochs=${config.epochs},` : `max_steps=${config.maxSteps},`;
  const hasEval = Boolean(config.hubDataset.trim() ? config.hubEvalSplit.trim() : config.evalDataset.trim());

  return `# Written by Conduit. Plain transformers + peft + trl — yours to keep and edit.
# Install once:  pip install ${PACKAGES.join(" ")}
import json, os, torch
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback${quantised ? ", BitsAndBytesConfig" : ""}
from trl import SFTTrainer, SFTConfig${adapter ? "\nfrom peft import LoraConfig" : ""}

MODEL = ${JSON.stringify(config.model)}
OUT = ${JSON.stringify(config.output)}
TOKEN = os.environ.get("HF_TOKEN") or None
${config.hubDataset.trim() ? hubLoader(config) : fileLoader(config)}
print(f"{len(data)} training examples" + (f", {len(evaluation)} for evaluation" if evaluation else ""), flush=True)

class Progress(TrainerCallback):
    """Prints one JSON line per log so Conduit can draw the run. Harmless elsewhere."""
    def on_log(self, args, state, control, logs=None, **kwargs):
        event = {"step": state.global_step, "max_steps": state.max_steps}
        event.update({k: v for k, v in (logs or {}).items() if isinstance(v, (int, float))})
        print("${PROGRESS_TAG}" + json.dumps(event), flush=True)

tokenizer = AutoTokenizer.from_pretrained(MODEL, token=TOKEN)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
${
  quantised
    ? `
quant = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)
model = AutoModelForCausalLM.from_pretrained(MODEL, quantization_config=quant, device_map="auto", token=TOKEN)`
    : `
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16, device_map="auto", token=TOKEN)`
}
model.config.use_cache = False
${
  adapter
    ? `
peft_config = LoraConfig(
    r=${config.rank},
    lora_alpha=${config.alpha},
    lora_dropout=${config.dropout},
    bias="none",
    task_type="CAUSAL_LM",
    target_modules="all-linear",${raw ? `\n    modules_to_save=["embed_tokens", "lm_head"],` : ""}
)`
    : `
peft_config = None  # full fine-tune: every weight is trained`
}

trainer = SFTTrainer(
    model=model,
    train_dataset=data,
    eval_dataset=evaluation,
    processing_class=tokenizer,
    peft_config=peft_config,
    callbacks=[Progress()],
    args=SFTConfig(
        output_dir=OUT,
        ${length}
        learning_rate=${config.learningRate},
        per_device_train_batch_size=${config.batchSize},
        gradient_accumulation_steps=${config.gradientAccumulation},
        max_length=${config.sequenceLength},
        warmup_steps=${config.warmupSteps},
        weight_decay=${config.weightDecay},
        seed=${config.seed},
        gradient_checkpointing=True,
        logging_steps=1,
        save_strategy="steps",
        save_steps=${Math.max(10, config.useEpochs ? 100 : Math.ceil(config.maxSteps / 3))},${
          hasEval ? `\n        eval_strategy="steps",\n        eval_steps=${config.useEpochs ? 50 : Math.max(5, Math.ceil(config.maxSteps / 6))},` : ""
        }${raw ? `\n        dataset_text_field="text",\n        packing=True,` : ""}
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        report_to=[],
    ),
)

trainer.train()
trainer.save_model(OUT)
tokenizer.save_pretrained(OUT)
print("${PROGRESS_TAG}" + json.dumps({"done": True, "output": OUT}), flush=True)
`;
}

/** A local JSONL file Conduit prepared, already in the final shape. */
function fileLoader(config: TuneConfig): string {
  return `DATA = ${JSON.stringify(config.dataset)}
EVAL = ${JSON.stringify(config.evalDataset)}

def load(path):
    return Dataset.from_list([json.loads(line) for line in open(path, encoding="utf-8") if line.strip()])

data = load(DATA)
evaluation = load(EVAL) if EVAL else None`;
}

/**
 * A Hugging Face dataset, fetched by the script and put into shape there.
 *
 * The mapping is the one chosen on the Dataset card, written out as plain
 * Python so it can be read and corrected: a conversation column is taken as
 * it is (ShareGPT's "from"/"value" included), otherwise the question, any
 * extra context and the answer become one exchange.
 */
function hubLoader(config: TuneConfig): string {
  const raw = config.method === "cpt";
  const shape = raw
    ? `def shape(row):
    return {"text": str(row.get(PROMPT) or "")}

def usable(row):
    return bool(row["text"].strip())`
    : `ROLES = {"assistant": "assistant", "gpt": "assistant", "model": "assistant", "bot": "assistant", "system": "system"}

def shape(row):
    prompt = row.get(PROMPT)
    if isinstance(prompt, list):
        turns = []
        for turn in prompt:
            role = ROLES.get(str(turn.get("role", turn.get("from", "user"))).lower(), "user")
            content = turn.get("content", turn.get("value", turn.get("text", "")))
            if content:
                turns.append({"role": role, "content": str(content)})
        return {"messages": turns}
    turns = []
    if SYSTEM and row.get(SYSTEM):
        turns.append({"role": "system", "content": str(row[SYSTEM])})
    question = str(prompt or "")
    if CONTEXT and row.get(CONTEXT):
        question += "\\n\\n" + str(row[CONTEXT])
    turns.append({"role": "user", "content": question})
    turns.append({"role": "assistant", "content": str(row.get(RESPONSE) or "")})
    return {"messages": turns}

def usable(row):
    turns = row["messages"]
    return any(t["role"] == "assistant" and t["content"].strip() for t in turns) and any(t["role"] == "user" for t in turns)`;

  return `from datasets import load_dataset

HUB = ${JSON.stringify(config.hubDataset)}
SUBSET = ${JSON.stringify(config.hubSubset)} or None
SPLIT = ${JSON.stringify(config.hubSplit || "train")}
EVAL_SPLIT = ${JSON.stringify(config.hubEvalSplit)}
PROMPT = ${JSON.stringify(config.mapPrompt)}
RESPONSE = ${JSON.stringify(config.mapResponse)}
SYSTEM = ${JSON.stringify(config.mapSystem)}
CONTEXT = ${JSON.stringify(config.mapContext)}

${shape}

def load(split):
    rows = load_dataset(HUB, SUBSET, split=split, token=TOKEN)
    return rows.map(shape, remove_columns=rows.column_names).filter(usable)

data = load(SPLIT)
evaluation = load(EVAL_SPLIT) if EVAL_SPLIT else None`;
}

/**
 * Turning the result into something Conduit can actually load.
 *
 * An adapter folder is not a model you can run: it has to be merged into the
 * base weights and converted to GGUF first. These are the commands that do
 * it, shown rather than run, because they need llama.cpp's own repository.
 */
export function conversionSteps(config: TuneConfig): string[] {
  if (config.method === "full") {
    return [
      `python llama.cpp/convert_hf_to_gguf.py "${config.output}" --outfile "${config.output}/model-f16.gguf" --outtype f16`,
      `llama-quantize "${config.output}/model-f16.gguf" "${config.output}/model-q4_k_m.gguf" Q4_K_M`,
    ];
  }
  return [
    `python -c "from peft import AutoPeftModelForCausalLM as M; m=M.from_pretrained(r'${config.output}'); m.merge_and_unload().save_pretrained(r'${config.output}/merged')"`,
    `python llama.cpp/convert_hf_to_gguf.py "${config.output}/merged" --outfile "${config.output}/model-f16.gguf" --outtype f16`,
    `llama-quantize "${config.output}/model-f16.gguf" "${config.output}/model-q4_k_m.gguf" Q4_K_M`,
  ];
}

/** What is wrong with this plan, in the order a person would hit it. */
export function problems(config: TuneConfig): string[] {
  const found: string[] = [];
  if (!config.model.trim()) found.push("Pick a base model.");
  if (!config.dataset.trim() && !config.hubDataset.trim()) found.push("Pick a dataset.");
  if (config.hubDataset.trim() && !config.mapPrompt.trim()) {
    found.push(config.method === "cpt" ? "Say which column holds the text." : "Say which column holds the question.");
  }
  if (config.hubDataset.trim() && config.method !== "cpt" && !config.mapResponse.trim() && !/messages|conversation/i.test(config.mapPrompt)) {
    found.push("Say which column holds the answer.");
  }
  if (!config.output.trim()) found.push("Say where the result should go.");
  if (config.useEpochs ? config.epochs <= 0 : config.maxSteps < 1) found.push("Train for at least one step.");
  if (config.learningRate <= 0) found.push("The learning rate has to be above zero.");
  if (config.method === "full" && config.learningRate > 1e-4) {
    found.push("A full fine-tune at this learning rate will damage the model. Try 1e-5.");
  }
  if (config.method !== "full" && config.learningRate < 1e-5) {
    found.push("That learning rate is very low for an adapter. 1e-4 to 3e-4 is the usual range.");
  }
  return found;
}

// --- following a run ------------------------------------------------------------

export interface ProgressEvent {
  step?: number;
  maxSteps?: number;
  loss?: number;
  evalLoss?: number;
  learningRate?: number;
  epoch?: number;
  done?: boolean;
}

/** Reads a progress line printed by the script's callback; anything else is just log. */
export function parseProgress(line: string): ProgressEvent | null {
  const at = line.indexOf(PROGRESS_TAG);
  if (at < 0) return null;
  try {
    const raw = JSON.parse(line.slice(at + PROGRESS_TAG.length)) as Record<string, unknown>;
    const num = (key: string) => (typeof raw[key] === "number" ? (raw[key] as number) : undefined);
    return {
      step: num("step"),
      maxSteps: num("max_steps"),
      loss: num("loss"),
      evalLoss: num("eval_loss"),
      learningRate: num("learning_rate"),
      epoch: num("epoch"),
      done: raw.done === true || undefined,
    };
  } catch {
    return null;
  }
}

// --- saving and loading a configuration ----------------------------------------

const YAML_KEYS: Array<keyof TuneConfig> = [
  "name",
  "model",
  "dataset",
  "evalDataset",
  "output",
  "method",
  "useEpochs",
  "maxSteps",
  "epochs",
  "learningRate",
  "batchSize",
  "gradientAccumulation",
  "sequenceLength",
  "rank",
  "alpha",
  "dropout",
  "warmupSteps",
  "weightDecay",
  "seed",
  "hubDataset",
  "hubSubset",
  "hubSplit",
  "hubEvalSplit",
  "mapPrompt",
  "mapResponse",
  "mapSystem",
  "mapContext",
];

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A flat YAML document; strings are JSON-quoted, which YAML reads as-is. */
export function toYaml(config: TuneConfig): string {
  return [
    "# Conduit training configuration",
    ...YAML_KEYS.map((key) => {
      const value = config[key];
      return `${snake(key)}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
    }),
  ].join("\n");
}

export function fromYaml(text: string, base: TuneConfig = DEFAULTS): TuneConfig {
  const next: TuneConfig = { ...base };
  const byName = new Map(YAML_KEYS.map((key) => [snake(key), key] as const));
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = byName.get(match[1]);
    if (!key) continue;
    const raw = match[2].replace(/\s+#.*$/, "");
    const current = base[key];
    let value: unknown;
    if (typeof current === "number") value = Number(raw);
    else if (typeof current === "boolean") value = raw === "true";
    else {
      try {
        value = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'(.*)'$/, "$1");
      } catch {
        value = raw;
      }
    }
    if (typeof current === "number" && !Number.isFinite(value as number)) continue;
    if (key === "method" && !METHODS.some((m) => m.id === value)) continue;
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}
