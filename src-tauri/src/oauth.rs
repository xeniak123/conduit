//! Signing in, in both directions.
//!
//! **Out:** Conduit no longer asks for a password. Signing in happens in the
//! user's own browser, where the address bar is visible and a password manager
//! works, and comes back to a listener on this machine — the loopback flow
//! every desktop application uses, with PKCE so the code that arrives is
//! useless to anything that did not start the sign-in.
//!
//! **In:** other programs can be granted access to Conduit's local API the
//! same way, instead of the user pasting a token around. The program opens
//! Conduit's authorize URL, Conduit asks the user in its own window, and the
//! program exchanges the resulting code for a key. Conduit never shows the key
//! to the browser: the code is exchanged over a direct POST, once, and expires
//! in ten minutes.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

// --- signing in to Conduit, in the browser --------------------------------------

/// A page the browser lands on when it comes back. It says the one thing the
/// person needs to know and gets out of the way.
fn done_page(title: &str, detail: &str) -> String {
    format!(
        r#"<!doctype html><meta charset="utf-8"><title>{title}</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#0b0c0f; color:#e9e9ee; }}
  .card {{ max-width:26rem; padding:2.5rem; text-align:center; }}
  h1 {{ font-size:1.35rem; letter-spacing:-0.02em; margin:0 0 .5rem; }}
  p {{ margin:0; opacity:.7; }}
  .dot {{ width:10px; height:10px; border-radius:50%; background:#6ee7a8;
         display:inline-block; margin-bottom:1.25rem; }}
</style>
<div class="card"><span class="dot"></span><h1>{title}</h1><p>{detail}</p></div>"#
    )
}

/// Waits on loopback for the browser to come back, once.
///
/// Returns the port immediately so the caller can build the redirect URL, and
/// sends the query string through the channel when it arrives. Binding to port
/// 0 lets the operating system pick a free one, which matters on a machine
/// where somebody is already running something on the obvious ports.
pub fn listen_once() -> Result<(u16, std::sync::mpsc::Receiver<Result<String, String>>), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| format!("Could not listen for the sign-in: {e}"))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("No port")?;
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        // Five minutes is long enough to find the password manager, sign in
        // with Google, and come back; after that the listener closes rather
        // than sitting open for the rest of the session.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                let _ = tx.send(Err("The sign-in took too long. Try again.".into()));
                return;
            }
            match server.recv_timeout(left) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();
                    let query = url.split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default();
                    // A browser asks for /favicon.ico too; that is not the answer.
                    if url.starts_with("/favicon") {
                        let _ = request.respond(tiny_http::Response::empty(404));
                        continue;
                    }
                    let body = if query.is_empty() {
                        done_page("Something went wrong", "Nothing came back from the sign-in. Try again in Conduit.")
                    } else {
                        done_page("You are signed in", "Close this tab and go back to Conduit.")
                    };
                    let _ = request.respond(
                        tiny_http::Response::from_string(body)
                            .with_header(html_header())
                            .with_status_code(200),
                    );
                    let _ = tx.send(if query.is_empty() { Err("Nothing came back.".into()) } else { Ok(query) });
                    return;
                }
                Ok(None) => continue,
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                    return;
                }
            }
        }
    });

    Ok((port, rx))
}

fn html_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"content-type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
}

// --- granting other programs access to Conduit ----------------------------------

pub struct Pending {
    pub client: String,
    pub redirect: String,
    pub state: String,
    /// The client's PKCE challenge, base64url of SHA-256 of its verifier.
    pub challenge: String,
    pub created: std::time::Instant,
    /// None until the user decides. Some(None) is a refusal; Some(Some(code))
    /// is an approval, and `keys` holds what that code is worth.
    pub decision: Option<Option<String>>,
}

#[derive(Default)]
struct Store {
    pending: HashMap<String, Pending>,
    /// Authorization code → the API key it can be exchanged for, once.
    keys: HashMap<String, (String, std::time::Instant)>,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

/// A code nothing can guess.
///
/// Guessing one would mean taking over a grant in flight, so this is real
/// randomness from the operating system rather than a hash of the clock.
fn random_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Only somewhere on this machine, or the program's own URL scheme.
///
/// Without this check Conduit would be an open redirector: anyone could send a
/// user to a Conduit authorize link that bounces the approval to a site they
/// control.
pub fn redirect_allowed(redirect: &str) -> bool {
    if let Some(rest) = redirect.strip_prefix("http://") {
        let host = rest.split(['/', ':', '?', '#']).next().unwrap_or("");
        return host == "127.0.0.1" || host == "localhost" || host == "[::1]";
    }
    // A custom scheme (myapp://done) goes to whatever registered it, which is
    // the program itself. The browser's own schemes do not: `javascript:` in
    // particular would run in the page Conduit serves on loopback.
    let Some((scheme, _)) = redirect.split_once("://") else { return false };
    let scheme = scheme.to_ascii_lowercase();
    const BROWSER: &[&str] =
        &["http", "https", "javascript", "data", "vbscript", "file", "about", "blob", "ftp", "ws", "wss", "chrome", "edge"];
    !scheme.is_empty()
        && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        && !BROWSER.contains(&scheme.as_str())
        && !redirect.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// The program chooses its own name, so it is text, never markup.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Records a program's request and returns the id the window will decide on.
pub fn request(client: &str, redirect: &str, state: &str, challenge: &str) -> String {
    let id = random_id();
    let mut guard = store().lock().unwrap();
    guard.pending.retain(|_, p| p.created.elapsed().as_secs() < 600);
    guard.pending.insert(
        id.clone(),
        Pending {
            client: client.chars().take(60).collect(),
            redirect: redirect.to_string(),
            state: state.to_string(),
            challenge: challenge.to_string(),
            created: std::time::Instant::now(),
            decision: None,
        },
    );
    id
}

pub fn peek(id: &str) -> Option<(String, String, Option<Option<String>>, String)> {
    let guard = store().lock().unwrap();
    let p = guard.pending.get(id)?;
    Some((p.client.clone(), p.redirect.clone(), p.decision.clone(), p.state.clone()))
}

/// The window's answer. On approval the key is held against a fresh code.
pub fn decide(id: &str, key: Option<String>) -> Result<String, String> {
    let mut guard = store().lock().unwrap();
    let Some(p) = guard.pending.get_mut(id) else {
        return Err("That request has expired.".into());
    };
    match key {
        Some(key) => {
            let code = random_id();
            p.decision = Some(Some(code.clone()));
            guard.keys.insert(code.clone(), (key, std::time::Instant::now()));
            Ok(code)
        }
        None => {
            p.decision = Some(None);
            Ok(String::new())
        }
    }
}

/// Exchanges a code for the key, once, if the verifier matches the challenge.
pub fn exchange(code: &str, verifier: &str) -> Result<String, String> {
    let mut guard = store().lock().unwrap();

    let challenge = guard
        .pending
        .values()
        .find(|p| p.decision.as_ref().and_then(|d| d.as_ref()).map(|c| c == code).unwrap_or(false))
        .map(|p| p.challenge.clone())
        .ok_or("Unknown or already used code.")?;

    // An empty challenge means the client did not use PKCE. Allowed, because
    // the whole exchange is already confined to loopback, but the client that
    // did use it must prove it.
    if !challenge.is_empty() {
        let digest = Sha256::digest(verifier.as_bytes());
        let expected = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
        if expected != challenge.trim_end_matches('=') {
            return Err("The code verifier does not match.".into());
        }
    }

    let (key, made) = guard.keys.remove(code).ok_or("Unknown or already used code.")?;
    if made.elapsed().as_secs() > 600 {
        return Err("That code has expired.".into());
    }
    guard.pending.retain(|_, p| p.decision.as_ref().and_then(|d| d.as_ref()).map(|c| c != code).unwrap_or(true));
    Ok(key)
}

/// The page the browser sits on while the user decides in Conduit's window.
pub fn waiting_page(id: &str, client: &str, port: u16) -> String {
    let client = escape_html(client);
    format!(
        r#"<!doctype html><meta charset="utf-8"><title>Authorize {client}</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#0b0c0f; color:#e9e9ee; }}
  .card {{ max-width:28rem; padding:2.5rem; text-align:center; }}
  h1 {{ font-size:1.3rem; letter-spacing:-0.02em; margin:0 0 .5rem; }}
  p {{ margin:0; opacity:.7; }}
  .pulse {{ width:12px; height:12px; border-radius:50%; background:#8ab4ff;
           display:inline-block; margin-bottom:1.25rem; animation:p 1.4s ease-in-out infinite; }}
  @keyframes p {{ 50% {{ opacity:.25; }} }}
  @media (prefers-reduced-motion: reduce) {{ .pulse {{ animation:none; }} }}
</style>
<div class="card">
  <span class="pulse"></span>
  <h1>Approve this in Conduit</h1>
  <p id="msg">Conduit is asking whether {client} may use your models. This tab will finish by itself.</p>
</div>
<script>
const id = {id:?};
async function tick() {{
  try {{
    const res = await fetch("http://127.0.0.1:{port}/oauth/poll?id=" + encodeURIComponent(id));
    const body = await res.json();
    if (body.status === "approved") {{ location.replace(body.redirect); return; }}
    if (body.status === "refused") {{
      document.getElementById("msg").textContent = "Conduit refused this request. You can close this tab.";
      return;
    }}
  }} catch (e) {{ /* Conduit may still be starting up */ }}
  setTimeout(tick, 900);
}}
tick();
</script>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn challenge_for(verifier: &str) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
    }

    #[test]
    fn only_sends_a_code_somewhere_on_this_machine() {
        assert!(redirect_allowed("http://127.0.0.1:7777/cb"));
        assert!(redirect_allowed("http://localhost:1410/callback"));
        assert!(redirect_allowed("myeditor://conduit/done"));
        // The whole point: never to a site somebody else controls.
        assert!(!redirect_allowed("https://evil.example.com/steal"));
        assert!(!redirect_allowed("http://evil.example.com/steal"));
        assert!(!redirect_allowed("not a url"));
        // Browser schemes would run script in the page Conduit serves.
        assert!(!redirect_allowed("javascript://%0aalert(1)"));
        assert!(!redirect_allowed("JavaScript://x"));
        assert!(!redirect_allowed("data://text/html,hi"));
        assert!(!redirect_allowed("http://127.0.0.1@evil.example.com/cb"));
        assert!(redirect_allowed("http://127.0.0.1:9/cb?x=1"));
    }

    #[test]
    fn a_code_is_worth_a_key_once_and_only_with_the_verifier() {
        let verifier = "a-long-random-string-the-client-kept";
        let id = request("Test App", "http://127.0.0.1:7777/cb", "state-1", &challenge_for(verifier));
        let code = decide(&id, Some("cnd_secret".into())).unwrap();

        assert!(exchange(&code, "the-wrong-verifier").is_err());
        assert_eq!(exchange(&code, verifier).unwrap(), "cnd_secret");
        // Spent: a replay gets nothing.
        assert!(exchange(&code, verifier).is_err());
    }

    #[test]
    fn a_program_name_cannot_become_markup() {
        let page = waiting_page("abc", "<script>alert(1)</script>", 8888);
        assert!(!page.contains("<script>alert(1)"));
        assert!(page.contains("&lt;script&gt;"));
    }

    #[test]
    fn a_refusal_yields_no_key() {
        let id = request("Test App", "http://127.0.0.1:7777/cb", "", "");
        decide(&id, None).unwrap();
        let (_, _, decision, _) = peek(&id).unwrap();
        assert_eq!(decision, Some(None));
    }
}
