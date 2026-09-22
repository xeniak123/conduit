import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { createToken } from "@/api/server";
import { Icon } from "./icons";
import { SPRING, materialize } from "./motion";

/**
 * Another program asking to use Conduit.
 *
 * The same shape as signing in with Google somewhere: the program sends the
 * user here, Conduit asks in its own window, and the program never sees a
 * password or gets handed a key it did not earn. What it receives is an
 * ordinary Conduit access token — revokable on the API page, like every other
 * one — issued only after this dialog is approved.
 *
 * The name and the address come from the program itself, so they are shown as
 * what they are: a claim, not a fact. The address is the part worth reading,
 * which is why it is the part in monospace.
 */

interface Request {
  id: string;
  client: string;
  redirect: string;
}

export function GrantSheet() {
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stop = listen<Request>("conduit://oauth-request", (event) => setRequest(event.payload));
    return () => void stop.then((un) => un());
  }, []);

  const decide = async (approve: boolean) => {
    if (!request || busy) return;
    setBusy(true);
    try {
      // The key is created here, in the window, so its fingerprint lands in
      // settings exactly like a hand-made one. The native side holds the
      // plaintext only until the program exchanges its code.
      const key = approve ? await createToken(request.client, 90) : null;
      await invoke("oauth_decide", { id: request.id, key });
    } finally {
      setBusy(false);
      setRequest(null);
    }
  };

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        void decide(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          style={{ zIndex: 75 }}
        >
          <motion.div className="confirm grant" {...materialize} transition={SPRING} role="dialog" aria-modal="true">
            <div className="grant__head">
              <span className="ptile ptile--ink">
                <Icon.plug />
              </span>
              <div>
                <b>{request.client} wants to use your models</b>
                <span className="muted">It is asking for an access token for this computer's Conduit API.</span>
              </div>
            </div>

            <ul className="grant__list">
              <li>
                <Icon.check /> Send prompts to any model Conduit serves, including local ones
              </li>
              <li>
                <Icon.check /> See the list of models, and what they cost
              </li>
              <li className="grant__never">
                <Icon.shield /> Never your provider keys, your chats, or your files
              </li>
            </ul>

            <div className="grant__where">
              <span className="muted">The token goes to</span>
              <code>{request.redirect}</code>
            </div>

            <div className="confirm__actions">
              <button className="btn" disabled={busy} onPointerDown={() => void decide(false)}>
                Refuse
              </button>
              <button className="btn btn--accent" disabled={busy} onPointerDown={() => void decide(true)}>
                Allow for 90 days
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
