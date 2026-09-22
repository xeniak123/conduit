import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * An MCP session, over the child process bridge.
 *
 * The protocol is JSON-RPC 2.0, one message per line, on the server's stdin
 * and stdout. The native side owns the process and forwards whole lines, so
 * everything here is about correlating replies with requests and not hanging
 * when one never comes.
 *
 * Two things a naive implementation gets wrong and this does not:
 *
 *   **Every request has a deadline.** A server that accepts a call and never
 *   answers would otherwise leave a promise pending for the life of the app,
 *   and a tool call that never settles stalls the whole agent run.
 *
 *   **stderr is not failure.** Many servers log to stderr on a perfectly
 *   healthy start. It is kept for diagnostics and never treated as an error,
 *   or every second server would appear broken.
 */

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT = 30_000;
/** Starting a server can mean fetching a package, which is not quick. */
const START_TIMEOUT = 90_000;

export class McpClient {
  readonly id: string;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private offs: UnlistenFn[] = [];
  private buffer: string[] = [];
  private started = false;

  tools: McpTool[] = [];
  /** The last few stderr lines, shown when something goes wrong. */
  log: string[] = [];

  constructor(id: string) {
    this.id = id;
  }

  async start(
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd?: string,
  ): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.offs = await Promise.all([
      listen<{ id: string; line: string }>("conduit://proc-out", (e) => {
        if (e.payload.id === this.id) this.receive(e.payload.line);
      }),
      listen<{ id: string; line: string }>("conduit://proc-err", (e) => {
        if (e.payload.id !== this.id) return;
        this.log.push(e.payload.line);
        if (this.log.length > 60) this.log.shift();
      }),
      listen<{ id: string; code: number }>("conduit://proc-exit", (e) => {
        if (e.payload.id !== this.id) return;
        this.failAll(
          new Error(
            `${this.id} stopped (exit ${e.payload.code}).` +
              (this.log.length ? ` Last output: ${this.log.slice(-2).join(" / ")}` : ""),
          ),
        );
        this.started = false;
      }),
    ]);

    try {
      await invoke("proc_spawn", { id: this.id, program: command, args, cwd: cwd ?? null, env });
    } catch (e) {
      await this.stop();
      throw e instanceof Error ? e : new Error(String(e));
    }

    const info = (await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: "Conduit", version: "0.1.0" },
      },
      START_TIMEOUT,
    )) as { serverInfo?: { name?: string } };

    // The notification is required by the protocol; a server is allowed to
    // reject every later call until it arrives.
    await this.notify("notifications/initialized");
    void info;

    await this.refreshTools();
  }

  async refreshTools(): Promise<McpTool[]> {
    const listed = (await this.request("tools/list", {})) as { tools?: McpTool[] };
    this.tools = (listed.tools ?? []).filter((t) => typeof t?.name === "string");
    return this.tools;
  }

  async call(name: string, args: Record<string, unknown>, timeout = 120_000): Promise<string> {
    const result = (await this.request(
      "tools/call",
      { name, arguments: args },
      timeout,
    )) as McpToolResult;

    const text = (result.content ?? [])
      .map((part) => {
        if (part.type === "text") return part.text ?? "";
        if (part.type === "image") return `[image: ${part.mimeType ?? "unknown"}]`;
        if (part.type === "resource") return part.text ?? "[resource]";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    // An error result is returned rather than thrown: the model can react to
    // "that path does not exist" far better than the run can survive an
    // exception, and a refusal is information, not a crash.
    if (result.isError) return `The tool reported a problem: ${text || "no detail given"}`;
    return text || "Done. The tool returned nothing to show.";
  }

  async stop(): Promise<void> {
    this.failAll(new Error(`${this.id} was stopped.`));
    this.offs.forEach((off) => off());
    this.offs = [];
    this.started = false;
    this.tools = [];
    await invoke("proc_kill", { id: this.id }).catch(() => undefined);
  }

  get running(): boolean {
    return this.started;
  }

  // --- plumbing --------------------------------------------------------------

  private request(method: string, params: unknown, timeout = DEFAULT_TIMEOUT): Promise<unknown> {
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.id} did not answer ${method} within ${Math.round(timeout / 1000)}s.`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      void invoke("proc_write", { id: this.id, line: message }).catch((e) => {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  private async notify(method: string, params: unknown = {}): Promise<void> {
    await invoke("proc_write", {
      id: this.id,
      line: JSON.stringify({ jsonrpc: "2.0", method, params }),
    }).catch(() => undefined);
  }

  /**
   * One line in.
   *
   * Servers sometimes emit a banner before their first JSON-RPC message, so a
   * line that does not parse is kept as diagnostics rather than treated as a
   * protocol violation.
   */
  private receive(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: Rpc;
    try {
      message = JSON.parse(trimmed) as Rpc;
    } catch {
      this.buffer.push(trimmed);
      if (this.buffer.length > 20) this.buffer.shift();
      return;
    }

    if (message.id === undefined) return; // A notification from the server.

    const waiting = this.pending.get(message.id as number);
    if (!waiting) return;

    this.pending.delete(message.id as number);
    window.clearTimeout(waiting.timer);

    if (message.error) {
      waiting.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      return;
    }
    waiting.resolve(message.result ?? {});
  }

  private failAll(error: Error): void {
    for (const [, waiting] of this.pending) {
      window.clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }
}
