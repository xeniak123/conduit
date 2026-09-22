import type { ToolSpec } from "@/llm/types";

export interface ToolContext {
  /** Which app was in front when the user started speaking. */
  focus: { process: string; title: string };
  /** Ties every audited action back to the request that caused it. */
  conversationId: string;
  /** Raises the approval sheet; resolves false if the user declines. */
  confirm: (summary: string, detail?: string) => Promise<boolean>;
  /** Progress text for the HUD while a slow tool runs. */
  report: (line: string) => void;
}

export interface Tool extends ToolSpec {
  /** Namespaced `group.action`, e.g. `fs.mkdir` — what approval rules match on. */
  name: string;
  /** Plugin id, or "builtin". Shown in the UI so users know what added a tool. */
  source: string;
  /**
   * True for anything that writes, deletes, spends money, or starts a process.
   * The pipeline asks before running these unless the user has exempted them.
   */
  dangerous?: boolean;
  /**
   * The tool changes what is on screen, so the agent should be shown a fresh
   * screenshot afterwards. Without this the model acts on a stale picture and
   * clicks where a button *used* to be.
   */
  visual?: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const tools = new Map<string, Tool>();

export function register(...list: Tool[]): void {
  for (const tool of list) {
    if (tools.has(tool.name)) {
      console.warn(`[conduit] tool "${tool.name}" re-registered by ${tool.source}`);
    }
    tools.set(tool.name, tool);
  }
}

export function unregisterSource(source: string): void {
  for (const [name, tool] of tools) {
    if (tool.source === source) tools.delete(name);
  }
}

export function listTools(): Tool[] {
  return [...tools.values()];
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

/** The model only ever sees the schema half — never the `run` function. */
export function toolSpecs(): ToolSpec[] {
  return listTools().map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

/** Small helper so every tool file does not repeat the JSON Schema boilerplate. */
export function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    // Required by strict tool use, and it stops models inventing extra fields.
    additionalProperties: false,
  };
}

export const str = (description: string) => ({ type: "string", description });
export const bool = (description: string) => ({ type: "boolean", description });
