import { getSettings, type McpServer } from "@/core/config";
import { register, unregisterSource, type Tool } from "@/tools/registry";
import { McpClient } from "./client";

export { McpClient } from "./client";

/**
 * Connecting MCP servers and handing their tools to the agent.
 *
 * An MCP tool is a tool like any other once it is here: it is namespaced,
 * listed beside the built-ins, and goes through the same approval gate. That
 * is the point — the permission model is not something a server can opt out of
 * by arriving from outside.
 *
 * Everything from a server is marked dangerous by default. Conduit cannot know
 * what `create_issue` does, and the honest answer to "should this be confirmed"
 * when you do not know is yes. Servers the user trusts can be exempted per
 * tool in Permissions, which is a decision they make once and see recorded.
 */

export interface ServerStatus {
  id: string;
  label: string;
  state: "stopped" | "starting" | "ready" | "failed";
  tools: number;
  error?: string;
  /** Recent stderr, for when the error alone is not enough. */
  log: string[];
}

const clients = new Map<string, McpClient>();
const status = new Map<string, ServerStatus>();
const listeners = new Set<(all: ServerStatus[]) => void>();

export function subscribe(fn: (all: ServerStatus[]) => void): () => void {
  listeners.add(fn);
  fn(statuses());
  return () => listeners.delete(fn);
}

export function statuses(): ServerStatus[] {
  return [...status.values()];
}

function announce(): void {
  const all = statuses();
  for (const fn of listeners) fn(all);
}

function set(id: string, patch: Partial<ServerStatus>): void {
  const current = status.get(id) ?? { id, label: id, state: "stopped" as const, tools: 0, log: [] };
  status.set(id, { ...current, ...patch });
  announce();
}

/** `mcp.<server>.<tool>` — unambiguous, and it reads as its own source. */
const toolName = (server: string, tool: string): string =>
  `mcp.${server.replace(/[^a-z0-9-]/gi, "")}.${tool.replace(/[^a-z0-9_-]/gi, "")}`;

export async function startServer(server: McpServer): Promise<void> {
  await stopServer(server.id);

  const client = new McpClient(server.id);
  clients.set(server.id, client);
  set(server.id, { label: server.label, state: "starting", tools: 0, error: undefined, log: [] });

  try {
    await client.start(server.command, server.args, server.env);

    register(
      ...client.tools.map(
        (tool): Tool => ({
          name: toolName(server.id, tool.name),
          source: `mcp:${server.id}`,
          dangerous: true,
          description: `${tool.description ?? tool.name} (from ${server.label})`,
          parameters: normaliseSchema(tool.inputSchema),
          async run(input, ctx) {
            ctx.report(`${server.label}: ${tool.name}`);
            return client.call(tool.name, input);
          },
        }),
      ),
    );

    set(server.id, { state: "ready", tools: client.tools.length, log: client.log.slice(-6) });
  } catch (e) {
    set(server.id, {
      state: "failed",
      error: e instanceof Error ? e.message : String(e),
      log: client.log.slice(-6),
    });
    await client.stop().catch(() => undefined);
    clients.delete(server.id);
  }
}

export async function stopServer(id: string): Promise<void> {
  unregisterSource(`mcp:${id}`);
  const client = clients.get(id);
  if (client) {
    await client.stop().catch(() => undefined);
    clients.delete(id);
  }
  if (status.has(id)) set(id, { state: "stopped", tools: 0 });
}

/**
 * Brings the running set in line with what is configured.
 *
 * Called at startup and whenever the list changes, so enabling a server takes
 * effect immediately rather than at next launch.
 */
export async function syncServers(): Promise<void> {
  const configured = getSettings().mcp.servers;
  const wanted = new Set(configured.filter((s) => s.enabled).map((s) => s.id));

  for (const id of [...clients.keys()]) {
    if (!wanted.has(id)) await stopServer(id);
  }
  for (const id of [...status.keys()]) {
    if (!configured.some((s) => s.id === id)) status.delete(id);
  }

  // Sequential rather than parallel: each one may run `npx`, and six package
  // installs racing for the same cache is slower than doing them in turn.
  for (const server of configured) {
    if (!server.enabled) {
      if (!status.has(server.id)) set(server.id, { label: server.label, state: "stopped" });
      continue;
    }
    if (clients.has(server.id) && status.get(server.id)?.state === "ready") continue;
    await startServer(server);
  }

  announce();
}

export async function stopAll(): Promise<void> {
  for (const id of [...clients.keys()]) await stopServer(id);
}

/**
 * Makes a server's schema acceptable to strict tool use.
 *
 * Servers vary in how carefully they write these, and a missing `type` or
 * absent `properties` is rejected by some providers — which would take out the
 * whole request, not just that one tool.
 */
function normaliseSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {}, required: [], additionalProperties: false };
  }
  const properties = (schema.properties as Record<string, unknown>) ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return {
    type: "object",
    properties,
    // Only list what actually exists, or a provider rejects the schema for
    // requiring a property it cannot find.
    required: required.filter((name) => typeof name === "string" && name in properties),
    additionalProperties: false,
  };
}
