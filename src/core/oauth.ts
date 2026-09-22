import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./host";

/**
 * Signing in without a password field.
 *
 * Conduit does not ask for a password any more. Clicking "Sign in" opens the
 * website in the real browser — where the address bar is visible, a password
 * manager works, and "continue with Google" is possible at all — and the
 * answer comes back to a listener on this machine.
 *
 * The exchange is PKCE: this app invents a secret, sends only its hash out
 * into the world, and the code that comes back is worthless to anything that
 * does not hold the secret. So a link sitting in a browser history, or a
 * neighbour watching the loopback port, is not a way into the account.
 */

const url = (path: string) => `https://xeniak123.github.io/conduit/${path}`;

export interface SignInStart {
  /** Where to send the browser. */
  url: string;
  /** Kept until the code comes back, then spent. */
  verifier: string;
  state: string;
}

function random(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Opens the browser and resolves with the code it comes back with.
 *
 * The listener is started first, because its port has to be in the address the
 * browser is sent to. Rejects if the user closes the browser instead: five
 * minutes, then the listener gives up rather than staying open all session.
 */
export async function signInWithBrowser(hint?: "google" | "email"): Promise<{ code: string; verifier: string }> {
  if (!isTauri()) throw new Error("Signing in needs the desktop app.");

  const verifier = random();
  const state = random(16);
  const challenge = await challengeFor(verifier);
  const port = await invoke<number>("auth_listen");

  const params = new URLSearchParams({ port: String(port), challenge, state });
  if (hint) params.set("with", hint);

  const waiting = new Promise<string>((resolve, reject) => {
    let stop: (() => void) | null = null;
    void listen<{ query?: string; error?: string }>("conduit://auth-callback", (event) => {
      stop?.();
      const payload = event.payload;
      if (payload.error) return reject(new Error(payload.error));
      const back = new URLSearchParams(payload.query ?? "");
      // The state is checked before the code is spent: it is the only thing
      // that says this answer belongs to the sign-in this app started.
      if (back.get("state") !== state) return reject(new Error("That sign-in did not come from this app. Try again."));
      const error = back.get("error_description") ?? back.get("error");
      if (error) return reject(new Error(error));
      const code = back.get("code");
      if (!code) return reject(new Error("The browser came back without a sign-in code."));
      resolve(code);
    }).then((un) => {
      stop = un;
    });
  });

  // The fragment, not the query: nothing after the # is sent to the server
  // hosting the page, so the challenge stays between this app and the browser.
  await invoke("open_target", { target: `${url("connect.html")}#${params}` });
  return { code: await waiting, verifier };
}

/** Where the browser goes for anything about the account that is not signing in. */
export const ACCOUNT_PAGE = url("account.html");
