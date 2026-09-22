import { describe, expect, it } from "vitest";
import { fitOf, groupQuants, quantOf, recommendQuant, type Hardware } from "./quant";

const GB = 1024 ** 3;

describe("quantOf", () => {
  it("reads the names people actually use", () => {
    expect(quantOf("Qwen3-8B-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(quantOf("model-UD-Q4_K_XL.gguf")).toBe("UD-Q4_K_XL");
    expect(quantOf("gemma-3-12b-it-IQ3_XXS.gguf")).toBe("IQ3_XXS");
    expect(quantOf("Llama-3.2-1B-Instruct-BF16.gguf")).toBe("BF16");
    expect(quantOf("Q8_0/model-Q8_0-00001-of-00002.gguf")).toBe("Q8_0");
  });

  it("returns null for files that are not a quantisation", () => {
    expect(quantOf("README.md")).toBeNull();
    expect(quantOf("config.json")).toBeNull();
  });
});

describe("groupQuants", () => {
  it("joins split files and leaves projectors out", () => {
    const quants = groupQuants([
      { path: "Q4_K_M/m-Q4_K_M-00002-of-00002.gguf", size: 4 * GB },
      { path: "Q4_K_M/m-Q4_K_M-00001-of-00002.gguf", size: 5 * GB },
      { path: "m-Q8_0.gguf", size: 12 * GB },
      { path: "mmproj-F16.gguf", size: 0.8 * GB },
      { path: "README.md", size: 100 },
    ]);

    expect(quants.map((q) => q.name)).toEqual(["Q4_K_M", "Q8_0"]);
    expect(quants[0].size).toBe(9 * GB);
    expect(quants[0].files[0].path).toContain("00001-of-00002");
  });
});

describe("fitOf", () => {
  const gaming: Hardware = { vram: 12 * 1024, ram: 16 * 1024, gpu: "RTX 3060", cores: 12, vendor: "nvidia" };
  const laptop: Hardware = { vram: 0, ram: 16 * 1024, gpu: null, cores: 8, vendor: null };

  it("puts a small model on the GPU", () => {
    expect(fitOf(5 * GB, gaming).fit).toBe("gpu");
  });

  it("offloads a model that is bigger than the card but fits with system memory", () => {
    expect(fitOf(17 * GB, gaming).fit).toBe("partial");
  });

  it("refuses something that fits nowhere", () => {
    expect(fitOf(80 * GB, gaming).fit).toBe("no");
  });

  it("uses system memory when there is no GPU", () => {
    expect(fitOf(4 * GB, laptop).fit).toBe("cpu");
    expect(fitOf(20 * GB, laptop).fit).toBe("no");
  });

  it("recommends the largest choice that stays on the GPU", () => {
    const quants = groupQuants([
      { path: "m-Q2_K.gguf", size: 3 * GB },
      { path: "m-Q4_K_M.gguf", size: 5 * GB },
      { path: "m-Q8_0.gguf", size: 9 * GB },
      { path: "m-BF16.gguf", size: 16 * GB },
    ]);
    expect(recommendQuant(quants, gaming)?.name).toBe("Q8_0");
  });
});

import { stripFrontMatter } from "./hub";

describe("model cards", () => {
  it("drops front matter, HTML and images but keeps the words", () => {
    const card = [
      "---",
      "license: apache-2.0",
      "---",
      '<div align="center"><a href="x"><img src="logo.png"></a></div>',
      "",
      "# Qwen",
      "",
      "<p>Runs <em>fast</em>.</p>",
      "![bench](bench.png)",
    ].join("\n");
    expect(stripFrontMatter(card)).toBe("# Qwen\n\nRuns fast.");
  });
});
