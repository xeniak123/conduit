import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/core/host";
import { keyKnown } from "@/core/secrets";
import type { RepoFile } from "./quant";

/**
 * Hugging Face, read-only.
 *
 * Everything goes through the native proxy like every other request, so the
 * web view never needs network access of its own. With a Hugging Face token
 * saved, it rides along (attached natively, never read by this code), which
 * opens gated and private repositories.
 */

const API = "https://huggingface.co/api";

/** The saved Hugging Face token, if there is one. The native layer fills it in. */
export function hfAuth() {
  return keyKnown("huggingface")
    ? { account: "huggingface", header: "authorization", template: "Bearer {key}" }
    : null;
}

export interface HubModel {
  id: string;
  author: string;
  name: string;
  likes: number;
  downloads: number;
  updated: string | null;
  tags: string[];
  pipeline: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  if (!isTauri()) {
    // Outside the app (the browser preview) there is no native proxy, but
    // Hugging Face answers cross-origin requests, so the page still works.
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status}.`);
    return (await res.json()) as T;
  }
  const response = await invoke<{ status: number; body: string }>("proxy_send", {
    request: { url, method: "GET", headers: { accept: "application/json" }, body: null, auth: hfAuth() },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      hfAuth()
        ? "That model is gated. Accept its licence on huggingface.co with the same account."
        : "That model is gated. Connect Hugging Face in Model hub, then accept its licence on huggingface.co.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Hugging Face answered ${response.status}.`);
  }
  return JSON.parse(response.body) as T;
}

interface RawModel {
  id: string;
  likes?: number;
  downloads?: number;
  lastModified?: string;
  createdAt?: string;
  tags?: string[];
  pipeline_tag?: string;
}

function toModel(raw: RawModel): HubModel {
  const [author, ...rest] = raw.id.split("/");
  return {
    id: raw.id,
    author,
    name: rest.join("/") || raw.id,
    likes: raw.likes ?? 0,
    downloads: raw.downloads ?? 0,
    updated: raw.lastModified ?? raw.createdAt ?? null,
    tags: raw.tags ?? [],
    pipeline: raw.pipeline_tag ?? null,
  };
}

export type Sort = "trending" | "downloads" | "likes" | "updated";

const SORT_KEY: Record<Sort, string> = {
  trending: "trendingScore",
  downloads: "downloads",
  likes: "likes",
  updated: "lastModified",
};

/** GGUF repositories only: those are the ones that run here without a conversion step. */
export async function searchModels(
  query: string,
  sort: Sort = "trending",
  author?: string,
  tag?: string,
): Promise<HubModel[]> {
  const params = new URLSearchParams({
    // A tagged shelf drops the GGUF requirement: several decision models ship
    // as safetensors only, and hiding them would hide the whole family.
    filter: tag ? tag : "gguf",
    sort: SORT_KEY[sort],
    direction: "-1",
    limit: "40",
  });
  if (query.trim()) params.set("search", query.trim());
  if (author) params.set("author", author);
  const list = await getJson<RawModel[]>(`${API}/models?${params}`);
  return list.map(toModel);
}

interface RawTreeEntry {
  type: "file" | "directory";
  path: string;
  size?: number;
  lfs?: { size?: number };
}

/** Every file in the repository, with real sizes (LFS sizes, not pointer sizes). */
export async function listFiles(id: string): Promise<RepoFile[]> {
  const tree = await getJson<RawTreeEntry[]>(`${API}/models/${id}/tree/main?recursive=true`);
  return tree
    .filter((entry) => entry.type === "file")
    .map((entry) => ({ path: entry.path, size: entry.lfs?.size ?? entry.size ?? 0 }));
}

export async function readme(id: string): Promise<string> {
  if (!isTauri()) {
    const res = await fetch(`https://huggingface.co/${id}/raw/main/README.md`).catch(() => null);
    return res?.ok ? stripFrontMatter(await res.text()) : "";
  }
  const response = await invoke<{ status: number; body: string }>("proxy_send", {
    request: {
      url: `https://huggingface.co/${id}/raw/main/README.md`,
      method: "GET",
      headers: {},
      body: null,
      auth: hfAuth(),
    },
  });
  if (response.status !== 200) return "";
  return stripFrontMatter(response.body);
}

/**
 * A model card, reduced to what reads well here.
 *
 * Cards open with YAML front matter, and many embed HTML for badges and logos.
 * Neither renders in a Markdown view, and the images could not load anyway
 * (the app does not fetch remote images), so tags and images are dropped and
 * the text inside them kept.
 */
export function stripFrontMatter(text: string): string {
  return text
    .replace(/^---[\s\S]*?\n---\s*\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fileUrl(id: string, path: string): string {
  return `https://huggingface.co/${id}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Collections worth opening on first launch, before anybody has typed anything. */
export const SHELVES: Array<{ id: string; label: string; author?: string; query?: string; tag?: string }> = [
  { id: "trending", label: "Trending" },
  // The System One family: models that choose rather than write.
  { id: "decision", label: "Decision models", tag: "decision-model" },
  { id: "unsloth", label: "Unsloth", author: "unsloth" },
  { id: "qwen", label: "Qwen", query: "qwen" },
  { id: "gemma", label: "Gemma", query: "gemma" },
  { id: "llama", label: "Llama", query: "llama" },
  { id: "coder", label: "Coding", query: "coder" },
  { id: "small", label: "Small & fast", query: "1b" },
];

export interface HfUser {
  name: string;
  fullname?: string;
  avatarUrl?: string;
}

/** Who the saved token belongs to, or null when there is none or it is refused. */
export async function whoami(): Promise<HfUser | null> {
  if (!isTauri() || !hfAuth()) return null;
  const response = await invoke<{ status: number; body: string }>("proxy_send", {
    request: { url: `${API}/whoami-v2`, method: "GET", headers: {}, body: null, auth: hfAuth() },
  });
  if (response.status !== 200) return null;
  const raw = JSON.parse(response.body) as HfUser;
  return { name: raw.name, fullname: raw.fullname, avatarUrl: raw.avatarUrl };
}
