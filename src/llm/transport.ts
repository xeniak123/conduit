import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/core/host";

/**
 * A `fetch` that never sees the API key.
 *
 * The provider modules keep composing requests exactly as they would against
 * the real `fetch` — that logic belongs in TypeScript, where it stays readable
 * and hackable. What changes is the last inch: the request is handed to the
 * native layer, which pulls the credential out of the OS keychain and attaches
 * it as the request leaves the process.
 *
 * Returning a genuine `Response` means the Anthropic SDK, and anything else
 * expecting standard fetch semantics, works unmodified.
 */

export interface AuthSpec {
  /** Credential name in the OS store, e.g. "anthropic". */
  account: string;
  /** Header that carries it. */
  header: string;
  /** Format string; `{key}` is substituted natively. */
  template: string;
}

interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function proxyFetch(auth: AuthSpec | null): typeof globalThis.fetch {
  return async (input, init) => {
    if (!isTauri()) {
      // Browser preview has no native layer and no keychain. Failing clearly
      // beats a confusing CORS error from a half-formed request.
      throw new Error("Model requests require the desktop app.");
    }

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined)).forEach(
      (value, key) => {
        // The SDK sets its own auth header from a placeholder key; the real
        // one is attached natively, so drop whatever it put there.
        if (key.toLowerCase() === "x-api-key" || key.toLowerCase() === "authorization") return;
        headers[key] = value;
      },
    );

    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : init?.body
            ? await new Response(init.body as BodyInit).text()
            : undefined;

    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // The native call itself cannot be cancelled, but nobody has to wait for
    // it: Stop settles this at once and the late answer is dropped.
    const response = await abortable(
      invoke<ProxyResponse>("proxy_send", {
        request: { url, method, headers, body, auth },
      }),
      signal,
    );

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/** Resolves with `work`, or rejects the moment `signal` aborts, whichever is first. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export const AUTH: Record<string, AuthSpec> = {
  anthropic: { account: "anthropic", header: "x-api-key", template: "{key}" },
  openai: { account: "openai", header: "authorization", template: "Bearer {key}" },
  openrouter: { account: "openrouter", header: "authorization", template: "Bearer {key}" },
  google: { account: "google", header: "x-goog-api-key", template: "{key}" },
};
