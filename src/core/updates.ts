import { create } from "zustand";
import { isTauri } from "./host";

/**
 * Updates from GitHub Releases.
 *
 * Every release carries a `latest.json` signed with Conduit's private key; the
 * app holds the public half and refuses anything that does not verify, so a
 * compromised download server cannot push a build. Checked once at start and
 * then every six hours. Installing always waits for a click.
 */

interface UpdateState {
  available: { version: string; notes: string } | null;
  checking: boolean;
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
}

export const useUpdates = create<UpdateState>(() => ({
  available: null,
  checking: false,
  progress: null,
  error: null,
  checkedAt: null,
}));

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: Update = null;

export async function checkForUpdate(): Promise<void> {
  if (!isTauri() || useUpdates.getState().checking) return;
  useUpdates.setState({ checking: true, error: null });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    useUpdates.setState({
      available: pending ? { version: pending.version, notes: pending.body ?? "" } : null,
      checkedAt: Date.now(),
    });
  } catch (e) {
    useUpdates.setState({ error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() });
  } finally {
    useUpdates.setState({ checking: false });
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  let total = 0;
  let received = 0;
  useUpdates.setState({ progress: 0, error: null });
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        received += event.data.chunkLength;
        useUpdates.setState({ progress: total ? received / total : null });
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdates.setState({ progress: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export function keepCheckingForUpdates(): () => void {
  const first = setTimeout(() => void checkForUpdate(), 8_000);
  const timer = setInterval(() => void checkForUpdate(), 6 * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
