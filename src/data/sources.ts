import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/core/host";
import { asText, getJson } from "./datasets";

/**
 * Where training material and base models come from, besides a search box:
 * plain text for continued pretraining, models that can actually be trained,
 * and what is already sitting in this machine's download cache.
 */

/**
 * Plain text in pieces a model can learn from.
 *
 * Split on blank lines and packed up to roughly two thousand characters, so a
 * paragraph is never cut in half and a long document becomes many examples
 * rather than one that is truncated at the context length.
 */
export function chunkText(text: string, size = 2000): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > size) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > size) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < paragraph.length; i += size) chunks.push(paragraph.slice(i, i + size));
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Raw text for continued pretraining: one `{"text": ...}` per line. */
export function toTextJsonl(rows: Array<Record<string, unknown>>, column: string): string {
  return rows
    .map((row) => asText(row[column]).trim())
    .filter(Boolean)
    .map((text) => JSON.stringify({ text }))
    .join("\n");
}

export interface TrainableModel {
  id: string;
  downloads: number;
  likes: number;
}

/** Shown before anything is typed: small, well-known, instruction-tuned. */
export const TRAINABLE_DEFAULTS = [
  "unsloth/Qwen3-4B-Instruct",
  "unsloth/Qwen3-8B",
  "Qwen/Qwen2.5-Coder-7B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct",
  "unsloth/Llama-3.2-3B-Instruct",
  "unsloth/gemma-3-4b-it",
  "HuggingFaceTB/SmolLM3-3B",
];

/** Models that can be fine-tuned: transformers weights, not GGUF or other runtime-only formats. */
export async function searchTrainableModels(query: string): Promise<TrainableModel[]> {
  const params = new URLSearchParams({
    pipeline_tag: "text-generation",
    library: "transformers",
    sort: "downloads",
    direction: "-1",
    limit: "30",
  });
  if (query.trim()) params.set("search", query.trim());
  const raw = await getJson<Array<{ id: string; downloads?: number; likes?: number }>>(
    `https://huggingface.co/api/models?${params}`,
    true,
  );
  return raw
    .filter((m) => !/gguf|awq|gptq|exl2|mlx/i.test(m.id))
    .map((m) => ({ id: m.id, downloads: m.downloads ?? 0, likes: m.likes ?? 0 }));
}

export const DATASET_DEFAULTS = [
  "unsloth/alpaca-cleaned",
  "unsloth/OpenMathReasoning-mini",
  "mlabonne/FineTome-100k",
  "openai/gsm8k",
  "philschmid/guanaco-sharegpt-style",
  "HuggingFaceH4/ultrafeedback_binarized",
  "roneneldan/TinyStories",
];

/**
 * What is already on this machine: the Hugging Face download cache, where
 * `models--org--name` and `datasets--org--name` folders sit. Read by name only.
 */
export async function cachedRepos(kind: "models" | "datasets"): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const entries = await invoke<Array<{ name: string; directory: boolean }>>("fs_list", {
      path: ".cache/huggingface/hub",
    });
    const prefix = `${kind}--`;
    return entries
      .filter((e) => e.directory && e.name.startsWith(prefix))
      .map((e) => e.name.slice(prefix.length).replace("--", "/"))
      .sort();
  } catch {
    return [];
  }
}

/** Training files Conduit has already made, newest name last. */
export async function savedTrainingFiles(dataDir: string): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const entries = await invoke<Array<{ name: string; directory: boolean }>>("fs_list", { path: `${dataDir}/datasets` });
    return entries.filter((e) => !e.directory && e.name.endsWith(".jsonl")).map((e) => `${dataDir}/datasets/${e.name}`);
  } catch {
    return [];
  }
}

/** Looks like a path someone pasted, rather than a search. */
export function looksLikePath(text: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/|~[\\/]|\.{1,2}[\\/])/.test(text.trim());
}
