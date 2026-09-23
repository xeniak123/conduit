import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  conversionSteps,
  estimate,
  family,
  fromYaml,
  parametersFromName,
  parseProgress,
  problems,
  toYaml,
  trainingScript,
} from "./tune";

describe("reading a size out of a model name", () => {
  it("reads the usual spellings", () => {
    expect(parametersFromName("unsloth/Qwen3-4B-Instruct")).toBe(4e9);
    expect(parametersFromName("meta-llama/Llama-3.1-8B")).toBe(8e9);
    expect(parametersFromName("google/gemma-2-2b-it")).toBe(2e9);
  });

  it("says so when the name does not carry one", () => {
    expect(parametersFromName("openai/whisper-large")).toBeNull();
  });
});

describe("will it fit", () => {
  const gpu = 12;

  it("fits a 7B QLoRA run on a 12 GB card", () => {
    const fit = estimate(7e9, { ...DEFAULTS, method: "qlora" }, gpu);
    expect(fit.fits).toBe(true);
  });

  it("refuses a 7B full fine-tune on the same card, and says what to do", () => {
    const fit = estimate(7e9, { ...DEFAULTS, method: "full" }, gpu);
    expect(fit.fits).toBe(false);
    expect(fit.note).toContain("QLoRA");
  });

  it("charges more for a longer sequence", () => {
    const short = estimate(7e9, { ...DEFAULTS, sequenceLength: 1024 }, gpu).needed;
    const long = estimate(7e9, { ...DEFAULTS, sequenceLength: 8192 }, gpu).needed;
    expect(long).toBeGreaterThan(short);
  });

  it("does not claim a fit it cannot know about", () => {
    expect(estimate(7e9, DEFAULTS, null).note).toContain("could not read");
  });
});

describe("the generated script", () => {
  const config = { ...DEFAULTS, dataset: "C:/data/train.jsonl", output: "C:/out/run" };

  it("quantises for QLoRA and not for LoRA", () => {
    expect(trainingScript({ ...config, method: "qlora" })).toContain("load_in_4bit=True");
    expect(trainingScript({ ...config, method: "lora" })).not.toContain("load_in_4bit");
  });

  it("trains an adapter for LoRA and no adapter for a full run", () => {
    expect(trainingScript({ ...config, method: "lora" })).toContain("LoraConfig");
    expect(trainingScript({ ...config, method: "full" })).toContain("peft_config = None");
  });

  it("carries the paths through as literals, so a Windows path survives", () => {
    expect(trainingScript(config)).toContain('DATA = "C:/data/train.jsonl"');
  });

  it("carries the hyperparameters that were chosen", () => {
    const script = trainingScript({ ...config, useEpochs: true, epochs: 5, rank: 64, alpha: 128 });
    expect(script).toContain("num_train_epochs=5");
    expect(script).toContain("r=64");
    expect(script).toContain("lora_alpha=128");
  });
});

describe("what comes after training", () => {
  it("merges the adapter before converting it", () => {
    const steps = conversionSteps({ ...DEFAULTS, method: "lora", output: "C:/out/run" });
    expect(steps[0]).toContain("merge_and_unload");
    expect(steps.at(-1)).toContain("Q4_K_M");
  });

  it("skips the merge for a full fine-tune", () => {
    const steps = conversionSteps({ ...DEFAULTS, method: "full", output: "C:/out/run" });
    expect(steps.some((s) => s.includes("merge_and_unload"))).toBe(false);
  });
});

describe("catching a plan that will waste an afternoon", () => {
  it("names what is missing", () => {
    expect(problems(DEFAULTS)).toContain("Pick a dataset.");
  });

  it("stops a full fine-tune at an adapter's learning rate", () => {
    const found = problems({ ...DEFAULTS, dataset: "d", output: "o", method: "full", learningRate: 2e-4 });
    expect(found.join(" ")).toContain("1e-5");
  });

  it("is quiet about a sound plan", () => {
    expect(problems({ ...DEFAULTS, dataset: "d.jsonl", output: "out" })).toEqual([]);
  });
});

describe("steps, raw text and evaluation", () => {
  const config = { ...DEFAULTS, dataset: "d.jsonl", output: "out" };

  it("trains for steps by default and for epochs when asked", () => {
    expect(trainingScript(config)).toContain(`max_steps=${DEFAULTS.maxSteps}`);
    expect(trainingScript({ ...config, useEpochs: true, epochs: 2 })).toContain("num_train_epochs=2");
  });

  it("trains continued pretraining on raw text, embeddings included", () => {
    const script = trainingScript({ ...config, method: "cpt" });
    expect(script).toContain('dataset_text_field="text"');
    expect(script).toContain("embed_tokens");
    expect(script).not.toContain("load_in_4bit");
  });

  it("scores an evaluation file only when there is one", () => {
    expect(trainingScript(config)).not.toContain("eval_strategy");
    expect(trainingScript({ ...config, evalDataset: "e.jsonl" })).toContain('eval_strategy="steps"');
  });

  it("names the family above the model", () => {
    expect(family("Qwen/Qwen2.5-Coder-7B-Instruct")).toBe("QWEN");
    expect(family("meta-llama/Llama-3.2-3B")).toBe("LLAMA");
  });
});

describe("following a run", () => {
  it("reads the script's progress lines and ignores the rest", () => {
    expect(parseProgress('CONDUIT {"step": 12, "max_steps": 60, "loss": 1.25, "learning_rate": 0.0002, "epoch": 0.4}')).toEqual({
      step: 12,
      maxSteps: 60,
      loss: 1.25,
      evalLoss: undefined,
      learningRate: 0.0002,
      epoch: 0.4,
      done: undefined,
    });
    expect(parseProgress('CONDUIT {"done": true, "output": "x"}')?.done).toBe(true);
    expect(parseProgress(" 20%|##        | 12/60 [00:10<00:40]")).toBeNull();
    expect(parseProgress("CONDUIT not json")).toBeNull();
  });
});

describe("configurations as YAML", () => {
  it("round-trips every setting", () => {
    const config = { ...DEFAULTS, name: 'my "run"', model: "C:\\models\\qwen", method: "cpt" as const, useEpochs: true, epochs: 3, learningRate: 5e-5 };
    expect(fromYaml(toYaml(config))).toEqual(config);
  });

  it("ignores unknown keys and bad values instead of breaking", () => {
    const loaded = fromYaml("method: magic\nmax_steps: lots\nunknown: 1\nrank: 32");
    expect(loaded.method).toBe(DEFAULTS.method);
    expect(loaded.maxSteps).toBe(DEFAULTS.maxSteps);
    expect(loaded.rank).toBe(32);
  });
});

describe("a Hugging Face dataset read by the script", () => {
  const hub = {
    ...DEFAULTS,
    output: "out",
    hubDataset: "tatsu-lab/alpaca",
    hubSplit: "train",
    mapPrompt: "instruction",
    mapResponse: "output",
    mapContext: "input",
  };

  it("loads it with load_dataset and the chosen columns", () => {
    const script = trainingScript(hub);
    expect(script).toContain('HUB = "tatsu-lab/alpaca"');
    expect(script).toContain("load_dataset(HUB, SUBSET, split=split, token=TOKEN)");
    expect(script).toContain('CONTEXT = "input"');
    expect(script).not.toContain("DATA = ");
    expect(problems(hub)).toEqual([]);
  });

  it("asks for the columns it cannot guess", () => {
    expect(problems({ ...hub, mapPrompt: "" })).toContain("Say which column holds the question.");
    expect(problems({ ...hub, mapResponse: "" })).toContain("Say which column holds the answer.");
    expect(problems({ ...hub, mapPrompt: "messages", mapResponse: "" })).toEqual([]);
  });

  it("evaluates on a second split when one is chosen", () => {
    expect(trainingScript({ ...hub, hubEvalSplit: "test" })).toContain('eval_strategy="steps"');
  });

  it("keeps the source in a saved configuration", () => {
    expect(fromYaml(toYaml(hub))).toEqual(hub);
  });
});
