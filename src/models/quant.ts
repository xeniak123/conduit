/**
 * Reading GGUF file lists and deciding what fits.
 *
 * A repository on Hugging Face usually holds a dozen files of the same model at
 * different quantisations, some split into parts, plus projector files for
 * vision. People want one row per choice, named the way the community names
 * them, with an honest answer to "will this run here".
 */

export interface RepoFile {
  path: string;
  size: number;
}

export interface Quant {
  /** `Q4_K_M`, `UD-Q4_K_XL`, `BF16` and so on. */
  name: string;
  /** Every file needed, first part first. */
  files: RepoFile[];
  size: number;
  /** Rough bits per weight, for sorting and for the quality hint. */
  bits: number;
}

const QUANT = /(?:^|[-_.\/])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?=[-_.\/]|$)/i;
const PART = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** Pulls the quantisation name out of a file path, or null if there is none. */
export function quantOf(path: string): string | null {
  const file = path.split("/").pop() ?? path;
  const match = QUANT.exec(file) ?? QUANT.exec(path);
  return match ? match[1].toUpperCase() : null;
}

/** Approximate bits per weight. Good enough to order a list; not a spec. */
export function bitsOf(quant: string): number {
  const q = quant.toUpperCase().replace(/^UD-/, "");
  if (q === "F32") return 32;
  if (q === "F16" || q === "BF16") return 16;
  if (q.startsWith("MXFP4")) return 4.25;
  const digit = /I?Q(\d)/.exec(q);
  if (!digit) return 8;
  const base = Number(digit[1]);
  // K-quants and I-quants carry a little extra for scales.
  if (q.includes("_K_L") || q.includes("_K_XL")) return base + 0.9;
  if (q.includes("_K_M")) return base + 0.7;
  if (q.includes("_K_S")) return base + 0.5;
  if (q.startsWith("IQ")) return base + 0.3;
  return base + 0.5;
}

/**
 * Groups a repository's files into choices.
 *
 * Projector files (`mmproj`) are left out: they are not a way to run the model,
 * they are an add-on to one, and listing them as a quantisation would be a
 * download that loads nothing.
 */
export function groupQuants(files: RepoFile[]): Quant[] {
  const byName = new Map<string, RepoFile[]>();

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".gguf")) continue;
    if (/mmproj/i.test(file.path)) continue;
    const name = quantOf(file.path);
    if (!name) continue;
    const list = byName.get(name) ?? [];
    list.push(file);
    byName.set(name, list);
  }

  const quants: Quant[] = [];
  for (const [name, list] of byName) {
    // Split files load from their first part; the rest must sit beside it.
    list.sort((a, b) => partIndex(a.path) - partIndex(b.path) || a.path.localeCompare(b.path));
    const parts = list.filter((f) => PART.test(f.path));
    const chosen = parts.length ? parts : [list[0]];
    quants.push({
      name,
      files: chosen,
      size: chosen.reduce((sum, f) => sum + f.size, 0),
      bits: bitsOf(name),
    });
  }

  return quants.sort((a, b) => a.size - b.size);
}

function partIndex(path: string): number {
  const match = PART.exec(path);
  return match ? Number(match[1]) : 0;
}

/** Vision projector for the repository, if it ships one. */
export function projectorOf(files: RepoFile[]): RepoFile | null {
  const candidates = files.filter((f) => /mmproj.*\.gguf$/i.test(f.path));
  if (!candidates.length) return null;
  // F16 is the usual choice: small, and lossless enough for a projector.
  return candidates.find((f) => /f16/i.test(f.path)) ?? candidates[0];
}

export interface Hardware {
  /** Megabytes. Zero means unknown, never "none". */
  vram: number;
  ram: number;
  gpu: string | null;
  cores: number;
  vendor: "nvidia" | "amd" | "intel" | "apple" | "other" | null;
}

export type Fit = "gpu" | "partial" | "cpu" | "no";

export interface FitVerdict {
  fit: Fit;
  label: string;
  /** Megabytes the model is expected to need at the given context. */
  needed: number;
}

/**
 * Will it run, and where.
 *
 * Weights plus roughly ten percent for runtime buffers, plus the KV cache,
 * which grows with context. The KV figure is a deliberately cautious rule of
 * thumb: telling somebody a model fits and having it crawl is worse than
 * telling them it is tight and having it run fine.
 */
export function fitOf(sizeBytes: number, hw: Hardware, context = 8192): FitVerdict {
  const weights = sizeBytes / (1024 * 1024);
  const kv = (context / 1024) * Math.max(64, weights / 90);
  const needed = Math.round(weights * 1.1 + kv);

  if (hw.vram && needed <= hw.vram * 0.92) {
    return { fit: "gpu", label: "Fits in GPU", needed };
  }
  if (hw.vram && needed <= hw.vram + hw.ram * 0.6) {
    return { fit: "partial", label: "Partly on GPU", needed };
  }
  if (!hw.vram && hw.ram && needed <= hw.ram * 0.7) {
    return { fit: "cpu", label: "Runs on CPU", needed };
  }
  if (!hw.ram && !hw.vram) {
    return { fit: "partial", label: "Unknown hardware", needed };
  }
  return { fit: "no", label: "Too large", needed };
}

/** The largest quantisation that still fits entirely on the GPU, else in memory. */
export function recommendQuant(quants: Quant[], hw: Hardware): Quant | null {
  if (!quants.length) return null;
  const ranked = [...quants].sort((a, b) => b.size - a.size);
  return (
    ranked.find((q) => fitOf(q.size, hw).fit === "gpu" && q.bits <= 8.9) ??
    ranked.find((q) => fitOf(q.size, hw).fit === "partial" && q.bits <= 6) ??
    ranked.find((q) => fitOf(q.size, hw).fit === "cpu") ??
    quants[0]
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
