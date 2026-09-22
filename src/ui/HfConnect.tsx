import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { saveSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { clearKey, keyKnown, refreshKeyStatus, saveKey } from "@/core/secrets";
import { useApp } from "@/core/store";
import { useCatalog } from "@/llm/catalog";
import { whoami, type HfUser } from "@/models/hub";
import { Icon } from "./icons";
import { SPRING_SNAP } from "./motion";

const ROUTER = "https://router.huggingface.co/v1";

/**
 * One token, three things: gated and private repositories in the hub,
 * downloads that need a login, and every model on Hugging Face's inference
 * router in the model switcher. Asking for it once, where models live, beats
 * three separate places to paste the same string.
 */
export function HfConnect() {
  const [user, setUser] = useState<HfUser | null>(null);
  const [connected, setConnected] = useState(keyKnown("huggingface"));
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "bad">("idle");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void refreshKeyStatus(["huggingface"]).then(async () => {
      const has = keyKnown("huggingface");
      setConnected(has);
      if (has) setUser(await whoami().catch(() => null));
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  /** Makes the router a provider, so its models show up in the switcher. */
  const addRouter = () => {
    const { settings, setSettings } = useApp.getState();
    if (settings.customProviders.some((p) => p.id === "huggingface")) return;
    const next = {
      ...settings,
      customProviders: [
        ...settings.customProviders,
        { id: "huggingface", label: "Hugging Face", baseUrl: ROUTER, needsKey: true, models: [] },
      ],
    };
    setSettings(next);
    void saveSettings(next);
    void useCatalog.getState().refresh("huggingface", next, true);
  };

  const connect = async () => {
    setState("busy");
    try {
      await saveKey("huggingface", token.trim());
      const who = await whoami();
      if (!who) {
        await clearKey("huggingface");
        setState("bad");
        return;
      }
      setUser(who);
      setConnected(true);
      setToken("");
      setState("idle");
      setOpen(false);
      addRouter();
    } catch {
      setState("bad");
    }
  };

  const disconnect = async () => {
    await clearKey("huggingface");
    setConnected(false);
    setUser(null);
    setOpen(false);
  };

  return (
    <div className="hfc" ref={ref}>
      <button className="hfc__btn" data-on={connected} onPointerDown={() => setOpen(!open)}>
        <HfMark />
        {connected ? (
          <>
            <span>{user?.name ?? "Hugging Face"}</span>
            <i className="hfc__dot" />
          </>
        ) : (
          <span>Connect Hugging Face</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="hfc__card"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={SPRING_SNAP}
          >
            {connected ? (
              <>
                <b className="hfc__title">Connected{user ? ` as ${user.fullname || user.name}` : ""}</b>
                <p className="hfc__text">
                  Gated and private models open in the hub, downloads use your account, and every model
                  on the Hugging Face router is in the model switcher.
                </p>
                <div className="hfc__actions">
                  <a className="btn btn--small" href={`https://huggingface.co/${user?.name ?? ""}`} target="_blank" rel="noreferrer">
                    <Icon.external /> Profile
                  </a>
                  <button className="btn btn--small btn--danger" onPointerDown={() => void disconnect()}>
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <b className="hfc__title">Connect Hugging Face</b>
                <p className="hfc__text">
                  Paste an access token with read permission. It goes to your system credential store,
                  and Conduit only ever sends it to huggingface.co.
                </p>
                <input
                  className="input input--mono"
                  type="password"
                  placeholder="hf_…"
                  value={token}
                  autoFocus
                  onChange={(e) => {
                    setToken(e.target.value);
                    setState("idle");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && token.trim() && void connect()}
                />
                {state === "bad" && <div className="hfc__bad">Hugging Face did not accept that token.</div>}
                <div className="hfc__actions">
                  <a className="linkbtn" href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
                    Create a token
                  </a>
                  <span className="spacer" />
                  <button
                    className="btn btn--small btn--ink"
                    disabled={!token.trim() || state === "busy"}
                    onPointerDown={() => void connect()}
                  >
                    {state === "busy" ? "Checking…" : "Connect"}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A plain smiling face: recognisable as "the hugging one" without the logo. */
function HfMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#FFD21E" />
      <circle cx="8.6" cy="10" r="1.3" fill="#3a3b45" />
      <circle cx="15.4" cy="10" r="1.3" fill="#3a3b45" />
      <path d="M8 14c1 2 2.4 3 4 3s3-1 4-3" stroke="#3a3b45" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
