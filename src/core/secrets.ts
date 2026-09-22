import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./host";

/**
 * Credentials, as far as the interface is concerned.
 *
 * Deliberately write-only. Settings can save a key and ask whether one exists;
 * it can never read one back, so there is no code path — and no devtools
 * session — that can print a saved key. The field shows "Saved", not a row of
 * dots that a screen recording could still betray the length of.
 */

const cache = new Map<string, boolean>();

export async function saveKey(account: string, secret: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("secret_set", { account, secret });
  cache.set(account, secret.length > 0);
}

export async function clearKey(account: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("secret_delete", { account });
  cache.set(account, false);
}

export async function hasKey(account: string): Promise<boolean> {
  if (!isTauri()) return false;
  const present = await invoke<boolean>("secret_has", { account });
  cache.set(account, present);
  return present;
}

/** Synchronous view for render paths, refreshed by `refreshKeyStatus`. */
export function keyKnown(account: string): boolean {
  return cache.get(account) ?? false;
}

export async function refreshKeyStatus(accounts: string[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    accounts.map(async (account) => [account, await hasKey(account)] as const),
  );
  return Object.fromEntries(entries);
}
