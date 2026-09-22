import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { deleteSyncedData, pull, SITE, signInInBrowser, signOut, useAccount } from "@/core/account";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { SPRING } from "./motion";

/**
 * Accounts, opened from the name in the sidebar.
 *
 * Signed out: two buttons, and no password field. Signing in happens in the
 * browser, where the address bar is visible and a password manager works, and
 * comes back to Conduit on its own — so nothing about the account is ever
 * typed into this window. Signed in: what is synced, when, and the few things
 * you might want to change.
 */

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const session = useAccount((s) => s.session);
  return (
    <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
      <motion.div
        className="acct"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className="acct__close" aria-label="Close" onPointerDown={onClose}>
          <Icon.close />
        </button>
        {session ? <Profile onClose={onClose} /> : <SignedOut />}
      </motion.div>
    </motion.div>
  );
}

function SignedOut() {
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async (hint: "google" | "email") => {
    if (busy) return;
    setBusy(hint);
    setNote({ ok: true, text: "Finish signing in in your browser. This window will notice when you do." });
    try {
      await signInInBrowser(hint);
      setNote(null);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="acct__split">
      <aside className="acct__pitch">
        <span className="acct__logo">
          <Logo size={20} />
        </span>
        <b>One Conduit on every computer</b>
        <ul>
          <li>
            <Icon.check /> Prompts, memories and scheduled tasks
          </li>
          <li>
            <Icon.check /> Providers and pinned models
          </li>
          <li>
            <Icon.check /> Your look, pet and approval level
          </li>
          <li className="acct__never">
            <Icon.shield /> API keys never leave the computer they were typed on
          </li>
        </ul>
        <span className="acct__free">Optional and free. Everything works without an account.</span>
      </aside>

      <div className="acct__form">
        <h2 className="acct__title">Sign in to Conduit</h2>
        <p className="muted acct__lead">
          This opens your browser. Conduit has no password field — whatever you sign in with stays between you and the
          browser, and only a one-time code comes back.
        </p>

        <button className="btn btn--lg acct__oauth" disabled={busy !== null} onPointerDown={() => void start("google")}>
          {busy === "google" ? <span className="spin" /> : <GoogleMark />}
          Continue with Google
        </button>

        <button className="btn btn--ink btn--lg acct__oauth" disabled={busy !== null} onPointerDown={() => void start("email")}>
          {busy === "email" ? <span className="spin spin--ink" /> : <Icon.compose />}
          Continue with email
        </button>

        <AnimatePresence>
          {note && (
            <motion.div
              className={`result result--${note.ok ? "ok" : "bad"}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              {note.text}
            </motion.div>
          )}
        </AnimatePresence>

        <button className="linkbtn acct__back" onPointerDown={() => void invoke("open_target", { target: SITE })}>
          Open the website instead
        </button>
      </div>
    </div>
  );
}

/** Google's mark, drawn rather than fetched: this window loads nothing remote. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.8-2 5.1-4.4 6.7v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.4z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.3 15.4 46 24 46z"
      />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.5A22 22 0 0 0 2 24c0 3.6.9 6.9 2.5 9.9l7.3-5.6z" />
      <path
        fill="#EA4335"
        d="M24 10.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 3.9 29.9 2 24 2 15.4 2 8.1 6.7 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9.3 12.2-9.3z"
      />
    </svg>
  );
}

function Profile({ onClose }: { onClose: () => void }) {
  const session = useAccount((s) => s.session)!;
  const syncing = useAccount((s) => s.syncing);
  const lastSync = useAccount((s) => s.lastSync);
  const error = useAccount((s) => s.error);
  const settings = useApp((s) => s.settings);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const counts: Array<[string, number]> = [
    ["Prompts", settings.prompts?.length ?? 0],
    ["Memories", settings.memories?.length ?? 0],
    ["Scheduled", settings.schedules?.length ?? 0],
    ["Providers", settings.customProviders.length],
  ];

  return (
    <div className="acct__profile">
      <div className="acct__head">
        <span className="acct__avatar">{session.user.email.slice(0, 1).toUpperCase()}</span>
        <div>
          <h2 className="acct__title">{settings.userName || session.user.email.split("@")[0]}</h2>
          <span className="muted">
            {session.user.email}
            {session.user.created && ` · member since ${new Date(session.user.created).toLocaleDateString([], { month: "long", year: "numeric" })}`}
          </span>
        </div>
      </div>

      <div className="acct__sync">
        <span className="acct__syncdot" data-state={error ? "bad" : syncing ? "busy" : "ok"} />
        <span>
          {error ? "Sync failed" : syncing ? "Syncing…" : lastSync ? `Synced at ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Synced"}
        </span>
        <span className="spacer" />
        <button className="btn btn--small" disabled={syncing} onPointerDown={() => void pull()}>
          <Icon.refresh /> Sync now
        </button>
      </div>
      {error && <div className="result result--bad">{error}</div>}

      <div className="acct__counts">
        {counts.map(([label, n]) => (
          <div key={label}>
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="muted acct__keys">
        <Icon.shield /> API keys are not in this list on purpose: they stay in each computer's keychain.
      </p>

      <div className="acct__rows">
        <div className="acct__row">
          <span>Sign-in and password</span>
          <button className="btn btn--small" onPointerDown={() => void invoke("open_target", { target: SITE })}>
            <Icon.external /> On the website
          </button>
        </div>
        <div className="acct__row">
          <span>Synced data</span>
          {confirmDelete ? (
            <span className="acct__inline">
              <button
                className="btn btn--small btn--danger"
                onPointerDown={async () => {
                  try {
                    await deleteSyncedData();
                    signOut();
                    onClose();
                  } catch (e) {
                    setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                Delete and sign out
              </button>
              <button className="btn btn--small" onPointerDown={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="btn btn--small" onPointerDown={() => setConfirmDelete(true)}>
              Delete from the cloud
            </button>
          )}
        </div>
      </div>
      {note && <div className={`result result--${note.ok ? "ok" : "bad"}`}>{note.text}</div>}

      <div className="dialog__foot">
        <button
          className="btn"
          onPointerDown={() => {
            signOut();
            onClose();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
