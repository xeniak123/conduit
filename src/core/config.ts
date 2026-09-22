import { load, type Store } from "@tauri-apps/plugin-store";
import type { Prompt } from "./prompts";
import { isTauri } from "./host";

/**
 * Everything the user can change, in one versioned shape.
 *
 * Two things make this a product schema rather than a scratch object:
 *
 *   - **It is versioned and migrated.** Software that loses a user's
 *     configuration on update is not software people keep.
 *   - **It holds no secrets.** API keys live in the OS credential store; this
 *     file records only which providers are configured, so it is safe to sync,
 *     back up, commit to a dotfiles repo, or hand to support.
 */

export const SETTINGS_VERSION = 6;

/** The public registry, which lives in the main repository. */
export const REGISTRY = "https://raw.githubusercontent.com/xeniak123/conduit/main/registry/registry.json";

/**
 * Built-in providers, plus whatever the user adds.
 *
 * Deliberately a loose string rather than a closed union: anything speaking
 * the OpenAI chat shape can be plugged in, and requiring a code change to add
 * one would defeat the point of bring-your-own-everything.
 */
export type BuiltInProviderId = "anthropic" | "openai" | "openrouter" | "google" | "ollama";
export type ProviderId = BuiltInProviderId | (string & {});

/** An endpoint the user added: anything that speaks OpenAI chat completions. */
export interface CustomProvider {
  /** Stable id, also the credential name in the OS keychain. */
  id: string;
  label: string;
  baseUrl: string;
  /** Local runtimes usually need none. */
  needsKey: boolean;
  models: string[];
}
export type SttProviderId = "groq" | "openai" | "local";

/**
 * How much the agent may do without asking.
 *
 * A single global "ask me" switch is the wrong shape: the answer differs for a
 * solo developer on their own laptop and for someone running this on a work
 * machine. These are the three answers people actually have.
 */
import type { ScheduledTask } from "./schedule";

export interface Memory {
  id: string;
  text: string;
  at: number;
}

export type PermissionProfile = "guarded" | "standard" | "trusted";

export const PROFILES: Record<
  PermissionProfile,
  { label: string; detail: string; gated: string[] }
> = {
  guarded: {
    label: "Guarded",
    detail: "Confirm anything that writes, runs, or touches the screen.",
    gated: [
      "shell.run",
      "fs.write",
      "fs.delete",
      "code.edit",
      "code.test",
      "screen.click",
      "screen.type",
      "screen.key",
      "screen.drag",
    ],
  },
  standard: {
    label: "Standard",
    detail: "Confirm commands and deletions. Everything else runs.",
    gated: ["shell.run", "fs.delete", "code.test"],
  },
  trusted: {
    label: "Trusted",
    detail: "Nothing is gated. Only sensible on a machine that is entirely yours.",
    gated: [],
  },
};

export interface Project {
  id: string;
  name: string;
  /** Working directory commands and file tools resolve against. */
  root: string;
  /** Extra standing instructions for every chat in this project. */
  brief: string;
  colour: string;
}

/**
 * The thing that follows your cursor.
 *
 * `mode` is four answers rather than a switch because people genuinely differ
 * here: some want a status bead, some want company, some want both, and some
 * want to be left alone. Making the fourth answer as easy as the others is
 * what stops a pet from being an imposition.
 */
export interface CompanionSettings {
  mode: "droplet" | "pet" | "both" | "off";
  /** Ids from the companion registry — built-in or installed. */
  dropletId: string;
  petId: string;
  /** Milliseconds to wait after the window goes away before appearing. */
  delay: number;
  /** 0.75 to 1.6. */
  scale: number;
  showCaption: boolean;
  /** Appear during voice and agent work even while the window is open. */
  alwaysDuringWork: boolean;
  /** The pet leans into the pointer's travel. */
  lean: boolean;
  introSeen: boolean;
  /** The pet that lives on the desktop, by companion id. */
  desktopPetId: string;
  /** On screen all the time, or only while Conduit's window is away. */
  petWhen: "always" | "away";
  /** Wanders along the taskbar when nothing is happening. */
  petWander: boolean;
  /** 0.7 to 1.6. */
  petSize: number;
}

/**
 * An MCP server, as configured rather than as running.
 *
 * `env` values may be `secret:<account>`, which the native layer swaps for the
 * real credential on its way into the child process. A token therefore never
 * appears in this file, and never reaches the web layer.
 */
export interface McpServer {
  id: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  /** The registry entry this came from, when it was installed rather than typed. */
  source?: string;
}

export interface ApiToken {
  id: string;
  name: string;
  /** SHA-256 of the token. The token itself is shown once and never stored. */
  hash: string;
  /** First characters, so a token can be recognised in a list. */
  prefix: string;
  created: number;
  /** Epoch ms, or null for never. */
  expires: number | null;
}

/** Something installed from the store, recorded so it can be listed and removed. */
export interface InstalledItem {
  id: string;
  kind: "skill" | "mcp" | "companion" | "prompt-pack";
  name: string;
  version: string;
  /** Where its files went, relative to the Conduit data folder. */
  path: string;
  at: number;
}

export interface Settings {
  version: number;

  /** Accelerators in Tauri's format, e.g. "Ctrl+Alt+Space". */
  hotkeys: { dictate: string; command: string };

  wakeWord: { enabled: boolean; phrase: string };

  stt: {
    provider: SttProviderId;
    /** Empty means auto-detect: Conduit follows whatever language you speak. */
    language: string;
  };

  command: { provider: ProviderId; model: string };

  /**
   * Cleaning up dictated text. Latency is the whole product here, so it is
   * configured separately from the agent — a smaller model is a reasonable
   * trade and the user should get to make it.
   */
  dictation: {
    provider: ProviderId;
    model: string;
    polish: boolean;
    delivery: "paste" | "type";
  };

  /** Base URL overrides for self-hosted or proxied endpoints. No secrets. */
  endpoints: Partial<Record<string, string>>;

  /** Providers the user added themselves. */
  customProviders: CustomProvider[];

  /** Models chosen for providers with a native client (Anthropic, Google). */
  providerModels: Record<string, string[]>;

  /** Your personal model ratings from the Arena. */
  arena: { ratings: Record<string, { elo: number; games: number; wins: number }> };

  /** Automatic model choice per message. */
  router: {
    enabled: boolean;
    /** Answers easy messages; a local or cheap model. */
    fast: { provider: string; model: string } | null;
    /** Everything else; the strongest model you have. */
    strong: { provider: string; model: string } | null;
  };

  /** What Conduit calls you. Empty until you say. */
  userName: string;

  /** Tasks that run on a schedule. */
  schedules: ScheduledTask[];

  /** Things the user asked Conduit to remember, added to every chat. */
  memories: Memory[];
  /** Whether Conduit may save memories on its own when you mention something lasting. */
  autoMemory: boolean;

  /** The web tools, switched from the message box. */
  webSearch: boolean;

  computerUse: {
    enabled: boolean;
    confirmEveryAction: boolean;
    showCursor: boolean;
  };

  permissions: {
    profile: PermissionProfile;
    /** Per-tool overrides layered on top of the profile. */
    alwaysAsk: string[];
    neverAsk: string[];
  };

  projects: Project[];
  activeProjectId: string | null;

  /** Record every tool call to disk for later review and export. */
  auditLog: boolean;

  /** Warn once a day's spend passes this, in USD. Zero disables it. */
  spendAlert: number;

  /** The user's own saved prompts, shown above the built-in library. */
  prompts: Prompt[];

  onboarded: boolean;

  appearance: {
    theme: "dark" | "light" | "system";
    density: "comfortable" | "compact";
    /** Glass everywhere, glass only on floating surfaces, or none at all. */
    material: "full" | "light" | "flat";
    /** Honours the OS setting by default; `off` overrides it downwards only. */
    motion: "system" | "full" | "off";
  };

  companion: CompanionSettings;

  /**
   * Sharpens Conduit for work in a codebase: a different brief, the dev tools
   * on, bigger file reads, and a preference for showing a diff before writing.
   */
  code: {
    enabled: boolean;
    /** Optional dedicated model for repository work; command model is the fallback. */
    provider?: ProviderId;
    model?: string;
    /** Ask before writing to a file that is tracked by git and has changes. */
    guardDirtyFiles: boolean;
    /** Run the project's test command after an edit and report the result. */
    testCommand: string;
  };

  mcp: { servers: McpServer[] };

  /** Conduit's own OpenAI-compatible endpoint for other programs. */
  api: {
    enabled: boolean;
    port: number;
    /** Reachable from other devices on the network, not just this one. */
    lan: boolean;
    /** Programs on this computer can call it without a token. */
    keylessLocal: boolean;
    tokens: ApiToken[];
  };

  /** Where extensions come from, and what is already here. */
  market: {
    /** `owner/repo` on GitHub, or a full URL to a registry JSON file. */
    registry: string;
    installed: InstalledItem[];
    /** Skills the agent is allowed to load, by id. */
    enabledSkills: string[];
  };

  /** A local speech model, once one has been installed. */
  localStt: {
    /** whisper.cpp model id, e.g. `base`, `small`, `large-v3-turbo`. */
    model: string;
    modelPath: string;
    serverPath: string;
    port: number;
    /** Start it with Conduit rather than on first use. */
    autoStart: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  hotkeys: { dictate: "Ctrl+Alt+D", command: "Ctrl+Alt+Space" },
  wakeWord: { enabled: false, phrase: "hey conduit" },
  stt: { provider: "groq", language: "" },
  command: { provider: "anthropic", model: "claude-opus-5" },
  dictation: {
    provider: "anthropic",
    model: "claude-opus-5",
    polish: true,
    delivery: "paste",
  },
  endpoints: {},
  customProviders: [],
  providerModels: {},
  webSearch: true,
  userName: "",
  arena: { ratings: {} },
  router: { enabled: false, fast: null, strong: null },
  schedules: [],
  memories: [],
  autoMemory: true,
  computerUse: { enabled: false, confirmEveryAction: false, showCursor: true },
  permissions: { profile: "standard", alwaysAsk: [], neverAsk: [] },
  projects: [],
  activeProjectId: null,
  auditLog: true,
  spendAlert: 0,
  prompts: [],
  onboarded: false,
  appearance: { theme: "light", density: "comfortable", material: "full", motion: "system" },
  companion: {
    mode: "both",
    dropletId: "conduit-drop",
    petId: "pebble",
    // Long enough that putting the window away does not summon anything, short
    // enough that somebody who minimised in order to watch it does not give up.
    delay: 2800,
    scale: 1,
    showCaption: true,
    alwaysDuringWork: false,
    lean: true,
    introSeen: false,
    desktopPetId: "mochi",
    petWhen: "always",
    petWander: true,
    petSize: 1,
  },
  code: { enabled: false, provider: "anthropic", model: "claude-opus-5", guardDirtyFiles: true, testCommand: "" },
  mcp: { servers: [] },
  api: { enabled: false, port: 8888, lan: false, keylessLocal: true, tokens: [] },
  market: { registry: REGISTRY, installed: [], enabledSkills: [] },
  localStt: { model: "", modelPath: "", serverPath: "", port: 8642, autoStart: false },
};

/** Which tools need confirmation, given the profile plus any overrides. */
export function isGated(settings: Settings, tool: string): boolean {
  if (settings.permissions.neverAsk.includes(tool)) return false;
  if (settings.permissions.alwaysAsk.includes(tool)) return true;
  if (settings.computerUse.confirmEveryAction && tool.startsWith("screen.")) return true;
  return PROFILES[settings.permissions.profile].gated.includes(tool);
}

let store: Store | null = null;
let cache: Settings = DEFAULT_SETTINGS;

export async function initSettings(): Promise<Settings> {
  if (!isTauri()) return cache;
  store = await load("settings.json", { autoSave: false });
  const saved = await store.get<Record<string, unknown>>("settings");
  cache = migrate(saved ?? {});
  if ((saved?.version as number | undefined) !== SETTINGS_VERSION) await saveSettings(cache);
  return cache;
}

export function getSettings(): Settings {
  return cache;
}

export async function saveSettings(next: Settings): Promise<void> {
  cache = { ...next, version: SETTINGS_VERSION };
  if (!store) return;
  await store.set("settings", cache);
  await store.save();
}

/**
 * Brings any older file up to the current shape.
 *
 * Version 1 kept API keys inline. Those are not carried forward — a key that
 * once sat in a plaintext file should be re-entered and rotated, not silently
 * migrated into the keychain as though it had always been safe.
 */
function migrate(saved: Record<string, unknown>): Settings {
  const merged = deepMerge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, saved);
  const settings = merged as unknown as Settings;

  const from = (saved.version as number | undefined) ?? 1;
  if (from < 2) {
    delete (settings as unknown as Record<string, unknown>).credentials;
    delete (settings as unknown as Record<string, unknown>).requireApproval;
    delete (settings as unknown as Record<string, unknown>).enabledPlugins;
    settings.permissions = DEFAULT_SETTINGS.permissions;
    settings.onboarded = false;
  }
  if (from < 3) {
    // Version 2 had no companion, so nobody chose these — but it did have an
    // overlay that appeared the instant a window went away, and the delay is
    // the fix for that. Introducing it on upgrade rather than only for new
    // installs is the point of the migration.
    settings.companion = { ...DEFAULT_SETTINGS.companion };
    settings.appearance = { ...DEFAULT_SETTINGS.appearance, ...settings.appearance };
  }
  settings.companion = { ...DEFAULT_SETTINGS.companion, ...settings.companion };
  if (from < 4) {
    settings.code = { ...DEFAULT_SETTINGS.code, ...settings.code };
  }

  if (from < 4) {
    // Version 3 showed the companion over the open window whenever the agent
    // was busy. People found that it covered the very reply they were
    // reading, so it is off unless somebody turns it back on.
    settings.companion.alwaysDuringWork = false;
  }

  if (from < 6 && settings.market.registry === "conduit-app/registry") {
    // The registry moved into the main repository before the first release.
    settings.market.registry = REGISTRY;
  }
  if (from < 5) {
    // The interface was redesigned around a light theme. Everybody moves to
    // it once; choosing dark again in Settings sticks from then on.
    settings.appearance.theme = "light";
    // "Pet" used to mean a creature inside the cursor bead. It now means one
    // that lives on the desktop, which is what people expected it to mean.
    if (settings.companion.mode === "pet") settings.companion.mode = "both";
  }

  // Arrays are replaced wholesale by the merge, so a defaulted-away list from
  // an older file would be undefined rather than empty. Repairing it here
  // beats a null check at every use site.
  settings.mcp.servers ??= [];
  settings.api ??= { ...DEFAULT_SETTINGS.api };
  settings.api.tokens ??= [];
  settings.market.installed ??= [];
  settings.market.enabledSkills ??= [];
  settings.customProviders ??= [];
  settings.providerModels ??= {};

  settings.version = SETTINGS_VERSION;
  return settings;
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object"
        ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}
