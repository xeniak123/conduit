import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/core/host";
import type { AuthSpec } from "./transport";

/**
 * Server-sent events, read through the native layer.
 *
 * The buffered proxy is right for a tool call and wrong for prose: thirty
 * seconds of silence followed by a wall of text reads as a hang, while the
 * same text arriving progressively reads as thinking. Bytes arrive as Tauri
 * events keyed by a request id, so concurrent requests never interleave.
 */

type StreamEvent =
  | { kind: "chunk"; text: string }
  | { kind: "error"; status: number; message: string }
  | { kind: "done" };

export interface SseLine {
  event?: string;
  data: string;
}

export async function streamSse(
  url: string,
  body: unknown,
  auth: AuthSpec | null,
  onEvent: (line: SseLine) => void,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<void> {
  if (!isTauri()) throw new Error("Model requests require the desktop app.");

  const id = crypto.randomUUID();
  let buffer = "";
  let failure: Error | null = null;

  await new Promise<void>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve();
    };

    const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort);

    void listen<StreamEvent>(`conduit://stream/${id}`, (event) => {
      const payload = event.payload;

      if (payload.kind === "error") {
        failure = new Error(
          payload.status
            ? `Provider error ${payload.status}: ${payload.message.slice(0, 300)}`
            : payload.message,
        );
        finish(failure);
        return;
      }

      if (payload.kind === "done") {
        // A final partial frame can sit in the buffer without a trailing
        // blank line; flushing it here avoids dropping the last delta.
        flush(buffer, onEvent, true);
        finish();
        return;
      }

      buffer += payload.text;
      buffer = flush(buffer, onEvent, false);
    }).then((off) => {
      unlisten = off;
      // Only start the request once the listener is attached, or the first
      // chunks of a fast response are lost.
      void invoke("proxy_stream", {
        id,
        request: {
          url,
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
          body: JSON.stringify(body),
          auth,
        },
      }).catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
    });
  });
}

/** Consumes whole `event:`/`data:` frames, returning whatever is left over. */
function flush(buffer: string, onEvent: (line: SseLine) => void, final: boolean): string {
  const frames = buffer.split("\n\n");
  const tail = final ? "" : (frames.pop() ?? "");

  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event: string | undefined;
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }

    if (data.length) onEvent({ event, data: data.join("\n") });
  }

  return tail;
}

/** Accumulates streamed tool-call arguments, which arrive as JSON fragments. */
export class ToolCallBuffer {
  private readonly calls = new Map<number, { id: string; name: string; json: string }>();

  start(index: number, id: string, name: string): void {
    this.calls.set(index, { id, name, json: "" });
  }

  append(index: number, fragment: string): void {
    const call = this.calls.get(index);
    if (call) call.json += fragment;
  }

  finish(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    return [...this.calls.values()].map((call) => ({
      id: call.id,
      name: call.name,
      // A truncated stream leaves invalid JSON. An empty object lets the tool
      // report a clear failure rather than the whole run collapsing on a parse.
      input: safeParse(call.json),
    }));
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
