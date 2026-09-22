import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  changePassword,
  deleteSyncedData,
  pull,
  resendConfirmation,
  resetPassword,
  signIn,
  signOut,
  signUp,
  useAccount,
} from "@/core/account";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Accounts, opened from the name in the sidebar.
 *
 * Signed out: one form that switches between signing in, creating an account
 * and resetting a forgotten password, next to a plain list of what an account
 * does (and the one thing it never does). Signed in: what is synced, when,
 * and the few things you might want to change.
 */

type Mode = "in" | "up" | "reset";

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
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; resend?: boolean } | null>(null);

  const strength = score(password);
  const valid =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    (mode === "reset" || password.length >= 8) &&
    (mode !== "up" || confirm === password);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (mode === "reset") {
        await resetPassword(email.trim());
        setNote({ ok: true, text: `If ${email.trim()} has an account, a link to choose a new password is on its way. Open it on any device.` });
      } else if (mode === "up") {
        const r = await signUp(email.trim(), password);
        if (r === "confirm") {
          setNote({ ok: true, text: `Almost there. Open the link sent to ${email.trim()}, then sign in here.`, resend: true });
          setMode("in");
          setConfirm("");
        }
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setNote({ ok: false, text, resend: /confirm your email/i.test(text) });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await resendConfirmation(email.trim());
      setNote({ ok: true, text: `Sent a new confirmation link to ${email.trim()}.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const title = mode === "in" ? "Welcome back" : mode === "up" ? "Create your account" : "Reset your password";

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
        {mode !== "reset" && (
          <div className="seg acct__tabs">
            {(
              [
                ["in", "Sign in"],
                ["up", "Create account"],
              ] as Array<[Mode, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                className="seg__item"
                aria-current={mode === id}
                onPointerDown={() => {
                  setMode(id);
                  setNote(null);
                }}
              >
                {mode === id && <motion.span layoutId="acct-tab" className="seg__pill" transition={SPRING_SNAP} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        <h2 className="acct__title">{title}</h2>
        {mode === "reset" && <p className="muted acct__lead">Enter your email and we will send a link to choose a new password.</p>}

        <label className="form">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>

        {mode !== "reset" && (
          <label className="form">
            <span className="acct__labelrow">
              Password
              {mode === "in" && (
                <button
                  className="linkbtn"
                  type="button"
                  onPointerDown={() => {
                    setMode("reset");
                    setNote(null);
                  }}
                >
                  Forgot password?
                </button>
              )}
            </span>
            <span className="acct__pw">
              <input
                className="input"
                type={show ? "text" : "password"}
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
              <button type="button" className="acct__eye" aria-label={show ? "Hide password" : "Show password"} onPointerDown={() => setShow(!show)}>
                {show ? "Hide" : "Show"}
              </button>
            </span>
            {mode === "up" && password && (
              <span className="acct__strength" data-level={strength.level}>
                <i />
                <i />
                <i />
                <em>{strength.label}</em>
              </span>
            )}
          </label>
        )}

        {mode === "up" && (
          <label className="form">
            <span>Repeat password</span>
            <input
              className="input"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            {confirm && confirm !== password && <em className="form__hint form__hint--warn">The passwords differ.</em>}
          </label>
        )}

        <AnimatePresence>
          {note && (
            <motion.div
              className={`result result--${note.ok ? "ok" : "bad"}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              {note.text}
              {note.resend && email.trim() && (
                <button className="linkbtn acct__resend" onPointerDown={() => void resend()}>
                  Send the link again
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button className="btn btn--ink btn--lg acct__submit" disabled={!valid || busy} onPointerDown={() => void submit()}>
          {busy ? <span className="spin spin--ink" /> : null}
          {mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
        </button>

        {mode === "reset" && (
          <button className="linkbtn acct__back" onPointerDown={() => setMode("in")}>
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

function Profile({ onClose }: { onClose: () => void }) {
  const session = useAccount((s) => s.session)!;
  const syncing = useAccount((s) => s.syncing);
  const lastSync = useAccount((s) => s.lastSync);
  const error = useAccount((s) => s.error);
  const settings = useApp((s) => s.settings);
  const [changing, setChanging] = useState(false);
  const [pw, setPw] = useState("");
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
          <span>Password</span>
          {changing ? (
            <span className="acct__inline">
              <input className="input input--small" type="password" autoFocus placeholder="New password, 8+ characters" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button
                className="btn btn--small btn--ink"
                disabled={pw.length < 8}
                onPointerDown={async () => {
                  try {
                    await changePassword(pw);
                    setNote({ ok: true, text: "Password changed." });
                    setChanging(false);
                    setPw("");
                  } catch (e) {
                    setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                Save
              </button>
              <button className="btn btn--small" onPointerDown={() => setChanging(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn--small" onPointerDown={() => setChanging(true)}>
              Change
            </button>
          )}
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

/** A rough, honest strength hint: length and variety, nothing cleverer. */
function score(pw: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < 8) return { level: 0, label: "Too short" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return { level: 3, label: "Strong" };
  if (pw.length >= 10 || kinds >= 3) return { level: 2, label: "Good" };
  return { level: 1, label: "Fair" };
}
