/**
 * Fine-tuning, planned here and run by Python.
 *
 * Nothing in this file trains anything. Training needs PyTorch and a CUDA
 * toolchain, which is not something a desktop app should smuggle in behind a
 * button — so Conduit does the part it is good at: working out whether the
 * machine can do the job, picking parameters that will not blow up, writing a
 * script the user can read, and running it in the open with its output on
 * screen. The script is plain `transformers` + `peft` + `trl`, so it keeps
 * working when this app is not in the room.
 */

export type Method = "lora" | "qlora" | "full";

export interface TuneConfig {
  /** Base model repository on Hugging Face. */
  model: string;
  /** Path to a chat JSONL file on this machine. */
  dataset: string;
  /** Where the adapter (or the trained model) is written. */
  output: string;
  method: Method;
  epochs: number;
  learningRate: number;
  batchSize: number;
  gradientAccumulation: number;
  sequenceLength: number;
  /** LoRA rank. Ignored by a full fine-tune. */
  rank: number;
  /** Conventionally twice the rank. */
  alpha: number;
}

export const METHODS: Array<{ id: Method; label: string; detail: string }> = [
  {
    id: "qlora",
    label: "QLoRA",
    detail: "The base model in 4-bit, a small adapter trained on top. Fits the most on the least.",
  },
  {
    id: "lora",
    label: "LoRA",
    detail: "The base model in 16-bit, a small adapter on top. Faster than QLoRA, needs more memory.",
  },
  {
    id: "full",
    label: "Full fine-tune",
    detail: "Every weight is trained. Best results, and far more memory than the other two.",
  },
];

export const DEFAULTS: TuneConfig = {
  model: "unsloth/Qwen3-4B-Instruct",
  dataset: "",
  output: "",
  method: "qlora",
  epochs: 3,
  learningRate: 2e-4,
  batchSize: 1,
  gradientAccumulation: 8,
  sequenceLength: 2048,
  rank: 16,
  alpha: 32,
};

/** Bytes per parameter that each method has to hold, weights plus optimiser. */
const COST: Record<Method, number> = {
  // 4-bit weights, plus the adapter and its optimiser state.
  qlora: 0.75,
  // 16-bit weights, adapter and optimiser on top.
  lora: 2.4,
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
 * this prevents is a four-hour download followed by an out-of-memory crash
 * thirty seconds into training.
 */
export function estimate(parameters: number, config: TuneConfig, vramGb: number | null): Estimate {
  const weights = (parameters * COST[config.method]) / 1e9;
  // Activations scale with how much text is in flight at once.
  const activations = (config.sequenceLength / 2048) * config.batchSize * 1.5;
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
      : `About ${needed} GB of VRAM, and this GPU has ${vramGb} GB. Try QLoRA, a shorter sequence length, or a smaller base model.`,
  };
}

/** Parameter count from a model name, when the name says it — "Qwen3-4B" → 4e9. */
export function parametersFromName(id: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[bB]\b/.exec(id.replace(/[-_]/g, " "));
  return match ? Number(match[1]) * 1e9 : null;
}

export const PACKAGES = ["torch", "transformers", "peft", "trl", "datasets", "accelerate", "bitsandbytes"];

/**
 * The training script.
 *
 * Written out in full rather than hidden behind a Conduit-specific runner, so
 * that what runs on the machine is something the user can read, keep, edit and
 * run again next month without this app.
 */
export function trainingScript(config: TuneConfig): string {
  const quantised = config.method === "qlora";
  const adapter = config.method !== "full";

  return `# Written by Conduit. Plain transformers + peft + trl — yours to keep and edit.
# Install once:  pip install ${PACKAGES.join(" ")}
import json, torch
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer${quantised ? ", BitsAndBytesConfig" : ""}
from trl import SFTTrainer, SFTConfig${adapter ? "\nfrom peft import LoraConfig" : ""}

MODEL = ${JSON.stringify(config.model)}
DATA = ${JSON.stringify(config.dataset)}
OUT = ${JSON.stringify(config.output)}

rows = [json.loads(line) for line in open(DATA, encoding="utf-8") if line.strip()]
print(f"{len(rows)} examples")
data = Dataset.from_list(rows)

tokenizer = AutoTokenizer.from_pretrained(MODEL)
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
model = AutoModelForCausalLM.from_pretrained(MODEL, quantization_config=quant, device_map="auto")`
    : `
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16, device_map="auto")`
}
model.config.use_cache = False
${
  adapter
    ? `
peft_config = LoraConfig(
    r=${config.rank},
    lora_alpha=${config.alpha},
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules="all-linear",
)`
    : `
peft_config = None  # full fine-tune: every weight is trained`
}

trainer = SFTTrainer(
    model=model,
    train_dataset=data,
    processing_class=tokenizer,
    peft_config=peft_config,
    args=SFTConfig(
        output_dir=OUT,
        num_train_epochs=${config.epochs},
        learning_rate=${config.learningRate},
        per_device_train_batch_size=${config.batchSize},
        gradient_accumulation_steps=${config.gradientAccumulation},
        max_length=${config.sequenceLength},
        gradient_checkpointing=True,
        logging_steps=5,
        save_strategy="epoch",
        bf16=True,
        report_to=[],
    ),
)

trainer.train()
trainer.save_model(OUT)
tokenizer.save_pretrained(OUT)
print("Saved to", OUT)
`;
}

/**
 * Turning the result into something Conduit can actually load.
 *
 * An adapter folder is not a model you can run: it has to be merged into the
 * base weights and converted to GGUF first. These are the two commands that do
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
  if (!config.dataset.trim()) found.push("Pick a dataset file.");
  if (!config.output.trim()) found.push("Say where the result should go.");
  if (config.epochs < 1) found.push("One epoch is the minimum.");
  if (config.learningRate <= 0) found.push("The learning rate has to be above zero.");
  if (config.method === "full" && config.learningRate > 1e-4) {
    found.push("A full fine-tune at this learning rate will damage the model. Try 1e-5.");
  }
  if (config.method !== "full" && config.learningRate < 1e-5) {
    found.push("That learning rate is very low for an adapter. 1e-4 to 3e-4 is the usual range.");
  }
  return found;
}
