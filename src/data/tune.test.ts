import { describe, expect, it } from "vitest";
import { DEFAULTS, conversionSteps, estimate, parametersFromName, problems, trainingScript } from "./tune";

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
    const script = trainingScript({ ...config, epochs: 5, rank: 64, alpha: 128 });
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
    expect(problems(DEFAULTS)).toContain("Pick a dataset file.");
  });

  it("stops a full fine-tune at an adapter's learning rate", () => {
    const found = problems({ ...DEFAULTS, dataset: "d", output: "o", method: "full", learningRate: 2e-4 });
    expect(found.join(" ")).toContain("1e-5");
  });

  it("is quiet about a sound plan", () => {
    expect(problems({ ...DEFAULTS, dataset: "d.jsonl", output: "out" })).toEqual([]);
  });
});
