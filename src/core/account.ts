import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "./host";
import { getSettings, saveSettings, type Settings } from "./config";
import { useApp } from "./store";

/**
 * An optional Conduit account.
 *
 * Nothing needs one: every feature works signed out. What an account adds is
 * the same prompts, memories, scheduled tasks, providers and look on every
 * computer you use. API keys are never part of it; they stay in each
 * machine's own keychain and are not even readable from here.
 *
 * Talks to Supabase's REST endpoints directly rather than through the SDK:
 * five calls do not justify a dependency.
 */

export const CLOUD_URL = "https://puzhxhbopgauutdmctut.supabase.co";
/** Publishable by design: row-level security decides what it can touch. */
export const CLOUD_KEY = "sb_publishable_q5dMJSk3mFAxDaaF6lXQOQ_NG_rSdyH";

const SESSION_KEY = "conduit.session.v1";

/**
 * The window may not open connections itself (its CSP allows only the app),
 * so requests go out through the same native proxy as model calls.
 */
async function call(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  if (!isTauri()) {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  }
  const res = await invoke<{ status: number; body: string }>("proxy_send", {
    request: { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null, auth: null },
  });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => (res.body ? JSON.parse(res.body) : null),
  };
}

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string; created?: string };
}

interface AccountState {
  session: Session | null;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  set: (p: Partial<AccountState>) => void;
}

function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* signed in for this run only */
  }
}

export const useAccount = create<AccountState>((set) => ({
  session: loadSession(),
  syncing: false,
  lastSync: null,
  error: null,
  set: (p) => set(p),
}));

async function auth(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await call(`${CLOUD_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: CLOUD_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(json.msg ?? json.error_description ?? json.message ?? `Answered ${res.status}.`);
    throw new Error(friendly(msg));
  }
  return json;
}

function friendly(msg: string): string {
  if (/same.*password|different from the old/i.test(msg)) return "Choose a password different from the current one.";
  if (/rate limit|too many|security purposes/i.test(msg)) return "Too many emails in a short time. Wait a minute and try again.";
  if (/invalid.*email|unable to validate email/i.test(msg)) return "That does not look like an email address.";
  if (/invalid login/i.test(msg)) return "That email and password do not match.";
  if (/not confirmed/i.test(msg)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/already registered/i.test(msg)) return "That email already has an account. Sign in instead.";
  if (/password should be/i.test(msg)) return "Use at least 8 characters for the password.";
  return msg;
}

function toSession(json: Record<string, unknown>): Session {
  const user = json.user as { id: string; email: string; created_at?: string };
  return {
    access_token: String(json.access_token),
    refresh_token: String(json.refresh_token),
    expires_at: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    user: { id: user.id, email: user.email, created: user.created_at },
  };
}

/** Creates an account. Supabase emails a confirmation link before sign-in works. */
export async function signUp(email: string, password: string): Promise<"confirm" | "signed-in"> {
  const json = await auth("signup", { email, password });
  if (json.access_token) {
    const session = toSession(json);
    storeSession(session);
    useAccount.getState().set({ session, error: null });
    void pull();
    return "signed-in";
  }
  return "confirm";
}

export async function signIn(email: string, password: string): Promise<void> {
  const session = toSession(await auth("token?grant_type=password", { email, password }));
  storeSession(session);
  useAccount.getState().set({ session, error: null });
  await pull();
}

/** Where account emails send people back to: the website, which explains what happened. */
export const SITE = "https://xeniak123.github.io/conduit/";

/** Emails a link for choosing a new password. Says nothing about whether the address has an account. */
export async function resetPassword(email: string): Promise<void> {
  await auth(`recover?redirect_to=${encodeURIComponent(SITE)}`, { email });
}

/** Sends the confirmation email again, for a link that expired or went to spam. */
export async function resendConfirmation(email: string): Promise<void> {
  await auth(`resend?redirect_to=${encodeURIComponent(SITE)}`, { type: "signup", email });
}

export async function changePassword(password: string): Promise<void> {
  const session = await fresh();
  if (!session) throw new Error("Sign in first.");
  const res = await call(`${CLOUD_URL}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: CLOUD_KEY, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(friendly(String(json.msg ?? json.message ?? `Answered ${res.status}.`)));
  }
}

/** Removes everything synced to the account. Local settings stay as they are. */
export async function deleteSyncedData(): Promise<void> {
  const session = await fresh();
  if (!session) return;
  const res = await call(`${CLOUD_URL}/rest/v1/user_state?user_id=eq.${session.user.id}`, {
    method: "DELETE",
    headers: { apikey: CLOUD_KEY, authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`Could not delete (${res.status}).`);
  useAccount.getState().set({ lastSync: null });
}

export function signOut(): void {
  const session = useAccount.getState().session;
  if (session) {
    void call(`${CLOUD_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: CLOUD_KEY, authorization: `Bearer ${session.access_token}` },
    }).catch(() => undefined);
  }
  storeSession(null);
  useAccount.getState().set({ session: null, lastSync: null });
}

async function fresh(): Promise<Session | null> {
  const session = useAccount.getState().session;
  if (!session) return null;
  if (session.expires_at - Date.now() > 60_000) return session;
  try {
    const next = toSession(await auth("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
    storeSession(next);
    useAccount.getState().set({ session: next });
    return next;
  } catch {
    signOut();
    return null;
  }
}

/** The part of Settings that follows you. Machine-specific and secret-adjacent fields stay put. */
function portable(s: Settings) {
  return {
    prompts: s.prompts,
    memories: s.memories,
    autoMemory: s.autoMemory,
    schedules: s.schedules.map((t) => ({ ...t, lastRun: null, lastConversationId: null, projectId: null })),
    appearance: s.appearance,
    companion: s.companion,
    permissions: s.permissions,
    webSearch: s.webSearch,
    customProviders: s.customProviders,
    providerModels: s.providerModels,
    command: s.command,
  };
}

export async function push(): Promise<void> {
  const session = await fresh();
  if (!session) return;
  useAccount.getState().set({ syncing: true, error: null });
  try {
    const res = await call(`${CLOUD_URL}/rest/v1/user_state`, {
      method: "POST",
      headers: {
        apikey: CLOUD_KEY,
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: session.user.id, data: portable(getSettings()), updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Sync answered ${res.status}.`);
    useAccount.getState().set({ lastSync: Date.now() });
  } catch (e) {
    useAccount.getState().set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useAccount.getState().set({ syncing: false });
  }
}

/** Brings the account's copy down. Lists are merged, so nothing local is lost. */
export async function pull(): Promise<void> {
  const session = await fresh();
  if (!session) return;
  useAccount.getState().set({ syncing: true, error: null });
  try {
    const res = await call(`${CLOUD_URL}/rest/v1/user_state?select=data&user_id=eq.${session.user.id}`, {
      headers: { apikey: CLOUD_KEY, authorization: `Bearer ${session.access_token}` },
    });
    const rows = (await res.json()) as Array<{ data: Partial<ReturnType<typeof portable>> }>;
    const remote = rows[0]?.data;
    if (remote) {
      const local = getSettings();
      const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
        const seen = new Set(a.map((x) => x.id));
        return [...a, ...b.filter((x) => !seen.has(x.id))];
      };
      const next: Settings = {
        ...local,
        appearance: remote.appearance ?? local.appearance,
        companion: remote.companion ?? local.companion,
        prompts: byId(local.prompts, remote.prompts),
        memories: byId(local.memories, remote.memories),
        schedules: byId(local.schedules, remote.schedules as Settings["schedules"]),
        customProviders: byId(local.customProviders, remote.customProviders),
        providerModels: { ...remote.providerModels, ...local.providerModels },
      };
      useApp.getState().setSettings(next);
      await saveSettings(next);
    }
    await push();
  } catch (e) {
    useAccount.getState().set({ error: e instanceof Error ? e.message : String(e), syncing: false });
  }
}

/** Pushes a few seconds after settings change, while signed in. */
export function keepAccountInSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = useApp.getState().settings;
  const off = useApp.subscribe((s) => {
    if (s.settings === last) return;
    last = s.settings;
    if (!useAccount.getState().session) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(), 4000);
  });
  if (useAccount.getState().session) void pull();
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}
