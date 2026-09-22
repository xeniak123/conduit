import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { pull, signIn, signOut, signUp, useAccount } from "@/core/account";
import { Icon } from "./icons";
import { SPRING } from "./motion";

/** Sign in, sign up, or see what is synced. Opened from the name in the sidebar. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const session = useAccount((s) => s.session);
  const syncing = useAccount((s) => s.syncing);
  const lastSync = useAccount((s) => s.lastSync);
  const error = useAccount((s) => s.error);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (mode === "up") {
        const r = await signUp(email.trim(), password);
        setNote({
          ok: true,
          text: r === "confirm" ? `Check ${email.trim()} for a confirmation link, then sign in here.` : "Account created.",
        });
        if (r === "confirm") setMode("in");
      } else {
        await signIn(email.trim(), password);
      }
      setPassword("");
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
      <motion.div
        className="dialog"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {session ? (
          <>
            <div className="acct__head">
              <span className="me__avatar acct__avatar">{session.user.email.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2 className="dialog__title" style={{ margin: 0 }}>
                  {session.user.email}
                </h2>
                <span className="muted">
                  {syncing ? "Syncing…" : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Signed in"}
                </span>
              </div>
            </div>
            <ul className="acct__list">
              <li><Icon.check /> Prompts, memories and scheduled tasks</li>
              <li><Icon.check /> Providers and pinned models</li>
              <li><Icon.check /> Look, companion and approval level</li>
              <li className="acct__never"><Icon.close /> API keys never leave this computer</li>
            </ul>
            {error && <div className="result result--bad">{error}</div>}
            <div className="dialog__foot">
              <button className="btn" onPointerDown={() => { signOut(); onClose(); }}>
                Sign out
              </button>
              <button className="btn btn--ink" disabled={syncing} onPointerDown={() => void pull()}>
                <Icon.refresh /> Sync now
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="dialog__title">{mode === "in" ? "Sign in to Conduit" : "Create a Conduit account"}</h2>
            <p className="muted" style={{ marginTop: -8 }}>
              Optional. It keeps your prompts, memories, scheduled tasks and providers the same on every computer. Keys are never uploaded.
            </p>
            <label className="form">
              <span>Email</span>
              <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="form">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && password && void submit()}
              />
            </label>
            <AnimatePresence>
              {note && <div className={`result result--${note.ok ? "ok" : "bad"}`}>{note.text}</div>}
            </AnimatePresence>
            <div className="dialog__foot">
              <button className="linkbtn" style={{ marginRight: "auto" }} onPointerDown={() => setMode(mode === "in" ? "up" : "in")}>
                {mode === "in" ? "No account? Create one" : "Have an account? Sign in"}
              </button>
              <button className="btn btn--ink" disabled={busy || !email.trim() || password.length < 8} onPointerDown={() => void submit()}>
                {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
