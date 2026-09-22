import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { apiPort, createToken, revokeToken, routes } from "@/api/server";
import { saveSettings, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { useRuntime } from "@/models/runtime";
import { Setting, Switch } from "./CompanionPage";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Conduit as a server.
 *
 * Any tool that can talk to OpenAI can talk to Conduit instead, and through it
 * to the model loaded on this computer or any provider connected here. One
 * address, one token, and the provider keys never leave the credential store.
 */

interface LogLine {
  at: number;
  method: string;
  path: string;
  model: string | null;
  status: number;
  ms: number;
  remote: string;
}

const EXPIRY: Array<{ label: string; days: number | null }> = [
  { label: "Never", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

type Lang = "curl" | "python" | "js";

export function ApiPage() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const loaded = useRuntime((s) => s.loaded);
  const api = settings.api;

  const [port, setPort] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [lan, setLan] = useState<string[]>([]);
  const [lang, setLang] = useState<Lang>("curl");
  const [copied, setCopied] = useState<string | null>(null);

  const patch = async (next: Partial<Settings["api"]>) => {
    const merged = { ...settings, api: { ...api, ...next } };
    setSettings(merged);
    await saveSettings(merged);
  };

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string[]>("lan_addresses").then(setLan).catch(() => undefined);
    const off = listen<LogLine>("conduit://api-log", (e) => setLog((l) => [e.payload, ...l].slice(0, 60)));
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void apiPort().then(setPort), 300);
    return () => window.clearTimeout(t);
  }, [api.enabled, api.port, api.lan]);

  const available = useMemo(() => routes(settings), [settings, loaded]);
  const running = api.enabled && port !== null;
  const base = `http://${api.lan && lan[0] ? lan[0] : "127.0.0.1"}:${api.port}/v1`;
  const model = available[0]?.id ?? "local/your-model";
  const token = fresh ?? (api.keylessLocal && !api.lan ? "" : "cnd_your_token");

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const example = sample(lang, base, model, token);
  const grantSample = grantFlow(base);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">API</h1>
          <p className="page__sub">
            An OpenAI-compatible endpoint in front of every model in Conduit. Point any app, script or coding agent at
            it.
          </p>
        </div>
        <div className="apistate">
          <span className="apistate__dot" data-on={running} />
          <span>{running ? `Running on port ${port}` : "Off"}</span>
          <Switch checked={api.enabled} onChange={(enabled) => void patch({ enabled })} label="Run the API" />
        </div>
      </header>

      <section className="card card--hero">
        <div className="endpoint">
          <span className="endpoint__label">Base URL</span>
          <code className="endpoint__url">{base}</code>
          <button className="btn btn--small" onPointerDown={() => copy(base, "base")}>
            {copied === "base" ? <Icon.check /> : <Icon.copy />}
            {copied === "base" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="endpoint__models">
          {available.length === 0 ? (
            <span className="muted">
              No models yet. Load one in the Model hub or connect a provider, and it appears here.
            </span>
          ) : (
            available.slice(0, 12).map((r) => (
              <button key={r.id} className="pill pill--mono" onPointerDown={() => copy(r.id, r.id)}>
                {copied === r.id ? "Copied" : r.id}
              </button>
            ))
          )}
          {available.length > 12 && <span className="muted">and {available.length - 12} more</span>}
        </div>
      </section>

      <section className="block">
        <h3 className="block__title">Access tokens</h3>
        <div className="tokenbar">
          <input
            className="input"
            placeholder="Token name, for example: editor"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="seg">
            {EXPIRY.map((e) => (
              <button key={e.label} className="seg__item" aria-current={expiry === e.days} onPointerDown={() => setExpiry(e.days)}>
                {expiry === e.days && <motion.span layoutId="expiry-pill" className="seg__pill" transition={SPRING_SNAP} />}
                <span>{e.label}</span>
              </button>
            ))}
          </div>
          <button
            className="btn btn--accent"
            onPointerDown={async () => {
              setFresh(await createToken(name, expiry));
              setName("");
            }}
          >
            Create token
          </button>
        </div>

        <AnimatePresence>
          {fresh && (
            <motion.div
              className="fresh"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
            >
              <div className="fresh__inner">
                <b>Copy this token now.</b> It is shown once. Conduit keeps only a fingerprint of it.
                <div className="endpoint">
                  <code className="endpoint__url">{fresh}</code>
                  <button className="btn btn--small" onPointerDown={() => copy(fresh, "fresh")}>
                    {copied === "fresh" ? <Icon.check /> : <Icon.copy />}
                    {copied === "fresh" ? "Copied" : "Copy"}
                  </button>
                  <button className="btn btn--small" onPointerDown={() => setFresh(null)}>
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {api.tokens.length === 0 ? (
          <div className="emptyline">No tokens yet.</div>
        ) : (
          <div className="cardlist">
            {api.tokens.map((t) => {
              const expired = t.expires !== null && t.expires < Date.now();
              return (
                <div key={t.id} className="lrow">
                  <span className="ptile ptile--ink">
                    <Icon.key />
                  </span>
                  <div className="lrow__text">
                    <b>{t.name}</b>
                    <span>
                      <code>{t.prefix}…</code> · created {new Date(t.created).toLocaleDateString()} ·{" "}
                      {t.expires ? (expired ? "expired" : `expires ${new Date(t.expires).toLocaleDateString()}`) : "never expires"}
                    </span>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn--small btn--danger" onPointerDown={() => void revokeToken(t.id)}>
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="block">
        <h3 className="block__title">Let an app connect itself</h3>
        <div className="grantdoc">
          <p className="block__sub">
            Instead of asking people to paste a token, another program can send them here and be granted one — the
            same handshake OpenRouter and ChatGPT use. Conduit asks in its own window, the program never sees a
            password, and what it gets is an ordinary token you can revoke above.
          </p>
          <div className="codebox">
            <button className="codebox__copy btn btn--small" onPointerDown={() => copy(grantSample, "grant")}>
              {copied === "grant" ? <Icon.check /> : <Icon.copy />}
              {copied === "grant" ? "Copied" : "Copy"}
            </button>
            <pre>{grantSample}</pre>
          </div>
          <p className="block__sub">
            The code is worth nothing without the verifier behind the challenge, it can be spent once, and it expires
            in ten minutes. Conduit sends it back only to this machine or to the program's own URL scheme.
          </p>
        </div>
      </section>

      <section className="block">
        <h3 className="block__title">Access</h3>
        <div className="card">
          <Setting label="Programs on this computer need no token" help="Convenient for local tools. Requests from other devices always need one.">
            <Switch checked={api.keylessLocal} onChange={(keylessLocal) => void patch({ keylessLocal })} />
          </Setting>
          <Setting
            label="Reachable from your network"
            help={lan[0] ? `Other devices can use http://${lan[0]}:${api.port}/v1 with a token.` : "Other devices on your Wi-Fi can reach it, with a token."}
          >
            <Switch checked={api.lan} onChange={(v) => void patch({ lan: v })} />
          </Setting>
          <Setting label="Port" help="Change it if something else is using this one.">
            <input
              className="input input--small input--mono"
              type="number"
              min={1024}
              max={65535}
              value={api.port}
              onChange={(e) => void patch({ port: Number(e.target.value) || 8888 })}
            />
          </Setting>
        </div>
      </section>

      <section className="block">
        <div className="block__head">
          <h3 className="block__title">Try it</h3>
          <div className="seg seg--tiny">
            {(["curl", "python", "js"] as Lang[]).map((l) => (
              <button key={l} className="seg__item" aria-current={lang === l} onPointerDown={() => setLang(l)}>
                {lang === l && <motion.span layoutId="lang-pill" className="seg__pill" transition={SPRING_SNAP} />}
                <span>{l === "curl" ? "curl" : l === "python" ? "Python" : "JavaScript"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="codebox">
          <button className="codebox__copy btn btn--small" onPointerDown={() => copy(example, "example")}>
            {copied === "example" ? <Icon.check /> : <Icon.copy />}
            {copied === "example" ? "Copied" : "Copy"}
          </button>
          <pre>{example}</pre>
        </div>
      </section>

      <section className="block">
        <h3 className="block__title">Recent requests</h3>
        {log.length === 0 ? (
          <div className="emptyline">{running ? "Waiting for the first request." : "Turn the API on to see requests here."}</div>
        ) : (
          <div className="reqlog">
            {log.map((l, i) => (
              <div key={`${l.at}-${i}`} className="reqlog__row" data-ok={l.status < 400}>
                <span className="reqlog__status">{l.status}</span>
                <span className="reqlog__method">{l.method}</span>
                <span className="reqlog__path">{l.path}</span>
                <span className="reqlog__model">{l.model ?? ""}</span>
                <span className="reqlog__ms">{l.ms} ms</span>
                <span className="reqlog__time">{new Date(l.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * How another program asks for access.
 *
 * Written as three shell steps rather than prose because that is the shape the
 * person reading it will paste somewhere, and because it makes the one rule
 * obvious: the key is fetched by the program, never handed to a browser.
 */
function grantFlow(base: string): string {
  const root = base.replace(/\/v1$/, "");
  return [
    "# 1. Send the user's browser here.",
    "#    CHALLENGE = base64url(sha256(VERIFIER))",
    `${root}/oauth/authorize?client_name=Your%20App&redirect_uri=http://localhost:7777/cb`,
    "  &code_challenge=$CHALLENGE&code_challenge_method=S256&state=$STATE",
    "",
    "# 2. Conduit asks the user. On approval the browser comes back to",
    "#    http://localhost:7777/cb?code=...&state=...",
    "",
    "# 3. Your program trades the code for a key, once:",
    `curl ${root}/oauth/token \\`,
    '  -H "content-type: application/json" \\',
    `  -d '{"code":"$CODE","code_verifier":"$VERIFIER"}'`,
    "",
    '# {"key":"cnd_..."} \u2014 send it as Authorization: Bearer from then on.',
  ].join("\n");
}

function sample(lang: Lang, base: string, model: string, token: string): string {
  const auth = token ? token : "not-needed-on-this-computer";
  if (lang === "python") {
    return [
      "from openai import OpenAI",
      "",
      `client = OpenAI(base_url="${base}", api_key="${auth}")`,
      "",
      "reply = client.chat.completions.create(",
      `    model="${model}",`,
      '    messages=[{"role": "user", "content": "Say hello in five words."}],',
      ")",
      "print(reply.choices[0].message.content)",
    ].join("\n");
  }
  if (lang === "js") {
    return [
      'import OpenAI from "openai";',
      "",
      `const client = new OpenAI({ baseURL: "${base}", apiKey: "${auth}" });`,
      "",
      "const reply = await client.chat.completions.create({",
      `  model: "${model}",`,
      '  messages: [{ role: "user", content: "Say hello in five words." }],',
      "});",
      "console.log(reply.choices[0].message.content);",
    ].join("\n");
  }
  return [
    `curl ${base}/chat/completions \\`,
    ...(token ? [`  -H "Authorization: Bearer ${token}" \\`] : []),
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Say hello in five words."}]}'`,
  ].join("\n");
}
