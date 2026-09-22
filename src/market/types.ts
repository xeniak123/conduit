/**
 * What can be installed.
 *
 * The deliberate omission is executable code. A Conduit extension declares
 * capabilities — a server to talk to, a skill to read, a pet to draw, prompts
 * to offer — and never ships JavaScript that runs inside the app. Running a
 * stranger's code in the same process as the credential bridge and the screen
 * driver would make every other safeguard in this codebase decorative.
 *
 * That is not a reduced version of a plugin system. An MCP server *is* code,
 * and it can do anything a program can — but it runs as its own process, is
 * launched by a command the user reads and approves, and reaches Conduit only
 * through tool calls that pass the same permission gate as everything else.
 * The boundary is a process, which is a boundary the operating system enforces
 * rather than one the application promises.
 */

export type ItemKind = "mcp" | "skill" | "companion" | "prompt-pack";

export interface EnvField {
  name: string;
  /** The credential to read at launch. Stored by name; the value never
   *  reaches the web layer. */
  secret?: string;
  /** A fixed value, for non-secret configuration. */
  value?: string;
  label: string;
  help?: string;
}

export interface McpDefinition {
  command: string;
  args: string[];
  env?: EnvField[];
  /** Shown before installing, because the user is approving a process. */
  note?: string;
}

export interface RegistryItem {
  id: string;
  kind: ItemKind;
  name: string;
  summary: string;
  author?: string;
  version?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  /** True for entries compiled into the app rather than fetched. */
  builtin?: boolean;
  /** Store icon: a glyph name and a colour, both from the app's own set. */
  icon?: string;
  tint?: string;
  /** Longer description for the detail sheet. */
  about?: string;
  featured?: boolean;

  mcp?: McpDefinition;

  /**
   * Files to fetch, as `destination name` → `path in the registry repository`.
   * Destinations are plain names, never paths, so nothing can be written
   * outside the item's own folder.
   */
  files?: Record<string, string>;

  /** Inline content, for items small enough not to need a fetch. */
  content?: Record<string, string>;
}

export interface Registry {
  version: number;
  updated?: string;
  items: RegistryItem[];
}
