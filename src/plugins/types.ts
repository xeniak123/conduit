import type { Tool, ToolContext } from "@/tools/registry";

/**
 * The plugin contract.
 *
 * Everything app-specific lives out here — Cursor, Claude Code, Linear, Spotify
 * are plugins, not core. Core owns the microphone, the model routing and the
 * approval gate; plugins own knowledge of individual applications, which is the
 * part that changes constantly and must be replaceable without a release.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;

  /**
   * Executable names this plugin knows about, e.g. ["Cursor.exe", "Code.exe"].
   * Tools from a plugin that declares `matches` are only offered to the model
   * when one of those apps is in front — this is what keeps the tool list
   * small and the model accurate as the plugin count grows.
   */
  matches?: string[];

  /** Credentials the plugin needs; rendered as fields in Settings. */
  secrets?: Array<{ key: string; label: string; help?: string }>;
}

export interface PluginApi {
  /** Registered tools are namespaced with the plugin id automatically. */
  addTool(tool: Omit<Tool, "source">): void;
  /** Values the user entered for this plugin's declared `secrets`. */
  getSecret(key: string): string | undefined;
  /** Runs an existing tool — lets plugins compose rather than reimplement. */
  callTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  log(...args: unknown[]): void;
}

export interface Plugin {
  manifest: PluginManifest;
  /** Called once when the plugin is enabled. */
  activate(api: PluginApi): void | Promise<void>;
  /** Called when disabled or reloaded; release timers and listeners here. */
  deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
