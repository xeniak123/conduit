//! Conduit's own API: one OpenAI-compatible endpoint in front of every model.
//!
//! Other programs on this machine (an editor, a script, a coding agent) can
//! point at `http://127.0.0.1:<port>/v1` and reach whatever model is loaded
//! locally, or any connected cloud provider, with one token. The provider keys
//! stay in the credential store and are attached here, on the way out, exactly
//! as they are for Conduit's own requests. A client of this API never sees
//! them.
//!
//! Tokens are stored as SHA-256 hashes. The plaintext is shown once, when it is
//! created, and cannot be recovered from the settings file afterwards.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize, Clone)]
pub struct Route {
    /// The name clients ask for, e.g. `local/qwen3-8b` or `openai/gpt-5`.
    pub id: String,
    pub base_url: String,
    /// The name the upstream expects.
    pub upstream: String,
    /// Credential to attach, if any, as `Authorization: Bearer <key>`.
    pub account: Option<String>,
    /// A decision model, served through /v1/decide.
    #[serde(default)]
    pub decision: bool,
}

#[derive(Deserialize, Clone)]
pub struct Config {
    pub port: u16,
    /// Listen on every interface rather than only this machine.
    pub lan: bool,
    pub token_hashes: Vec<String>,
    /// Allow requests from this machine without a token.
    pub keyless_local: bool,
    pub routes: Vec<Route>,
}

#[derive(Serialize, Clone)]
struct Log {
    at: u64,
    method: String,
    path: String,
    model: Option<String>,
    status: u16,
    ms: u64,
    remote: String,
}

#[derive(Default)]
pub struct Api {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    running_on: Mutex<Option<u16>>,
}

pub fn hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

impl Api {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn port(&self) -> Option<u16> {
        *self.running_on.lock().unwrap()
    }

    pub fn stop(&self) {
        if let Some(flag) = self.stop.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        *self.running_on.lock().unwrap() = None;
    }

    pub fn start(&self, app: AppHandle, config: Config) -> Result<u16, String> {
        self.stop();
        let host = if config.lan { "0.0.0.0" } else { "127.0.0.1" };
        // A restart can land while the previous listener is still winding down
        // (it checks for the stop flag every 300 ms), so binding is retried
        // briefly rather than failing with "address in use".
        let mut attempt = 0;
        let server = loop {
            match tiny_http::Server::http(format!("{host}:{}", config.port)) {
                Ok(server) => break server,
                Err(e) if attempt < 8 => {
                    attempt += 1;
                    let _ = e;
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                Err(e) => return Err(format!("Could not listen on port {}: {e}", config.port)),
            }
        };

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop.lock().unwrap() = Some(stop.clone());
        *self.running_on.lock().unwrap() = Some(config.port);

        let config = Arc::new(config);
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                let request = match server.recv_timeout(std::time::Duration::from_millis(300)) {
                    Ok(Some(r)) => r,
                    Ok(None) => continue,
                    Err(_) => break,
                };
                let config = config.clone();
                let app = app.clone();
                // One thread per request: a streamed completion can run for
                // minutes and must not hold up a /models call behind it.
                std::thread::spawn(move || handle(app, &config, request));
            }
        });

        Ok(self.port().unwrap_or(0))
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn json_response(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "application/json"))
        .with_header(header("access-control-allow-origin", "*"))
}

fn header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

fn error(status: u16, message: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    json_response(
        status,
        serde_json::json!({ "error": { "message": message, "type": "conduit_error" } }).to_string(),
    )
}

fn authorised(config: &Config, request: &tiny_http::Request) -> bool {
    let remote_local = request
        .remote_addr()
        .map(|a| match a.ip() {
            IpAddr::V4(v4) => v4.is_loopback(),
            IpAddr::V6(v6) => v6.is_loopback(),
        })
        .unwrap_or(false);
    if config.keyless_local && remote_local {
        return true;
    }
    let token = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("authorization"))
        .map(|h| h.value.as_str().trim().trim_start_matches("Bearer ").trim().to_string())
        .or_else(|| {
            request
                .headers()
                .iter()
                .find(|h| h.field.equiv("x-api-key"))
                .map(|h| h.value.as_str().trim().to_string())
        });
    match token {
        Some(t) if !t.is_empty() => config.token_hashes.contains(&hash(&t)),
        _ => false,
    }
}

fn handle(app: AppHandle, config: &Config, mut request: tiny_http::Request) {
    let started = std::time::Instant::now();
    let method = request.method().to_string();
    let path = request.url().split('?').next().unwrap_or("").to_string();
    let remote = request.remote_addr().map(|a| a.ip().to_string()).unwrap_or_default();

    let log = |status: u16, model: Option<String>| {
        let _ = app.emit(
            "conduit://api-log",
            Log {
                at: now_ms(),
                method: method.clone(),
                path: path.clone(),
                model,
                status,
                ms: started.elapsed().as_millis() as u64,
                remote: remote.clone(),
            },
        );
    };

    if method == "OPTIONS" {
        let _ = request.respond(
            tiny_http::Response::empty(204)
                .with_header(header("access-control-allow-origin", "*"))
                .with_header(header(
                    "access-control-allow-headers",
                    "authorization, content-type, x-api-key, anthropic-version, anthropic-beta",
                ))
                .with_header(header("access-control-allow-methods", "GET, POST, OPTIONS")),
        );
        return;
    }

    if path == "/health" {
        let _ = request.respond(json_response(200, r#"{"status":"ok"}"#.into()));
        return;
    }

    // Granting another program access happens before the token check, because
    // this is how a program that has no token gets one. Nothing here reaches a
    // model, and every grant is decided in Conduit's own window.
    if path.starts_with("/oauth/") {
        oauth_route(&app, config, request, &path);
        log(200, None);
        return;
    }

    if !authorised(config, &request) {
        let _ = request.respond(error(401, "Missing or invalid API token. Create one in Conduit, API."));
        log(401, None);
        return;
    }

    match (method.as_str(), path.as_str()) {
        ("GET", "/v1/models") => {
            let data: Vec<_> = config
                .routes
                .iter()
                .map(|r| serde_json::json!({ "id": r.id, "object": "model", "owned_by": "conduit" }))
                .collect();
            let _ = request.respond(json_response(200, serde_json::json!({ "object": "list", "data": data }).to_string()));
            log(200, None);
        }
        // Chat Completions for most clients, Messages for Claude Code and the
        // Anthropic SDKs, Responses for Codex. Each is passed through to the
        // model's own server in the dialect the client spoke.
        ("POST", "/v1/chat/completions")
        | ("POST", "/v1/completions")
        | ("POST", "/v1/embeddings")
        | ("POST", "/v1/messages")
        | ("POST", "/v1/messages/count_tokens")
        | ("POST", "/v1/responses") => {
            let passed: Vec<(String, String)> = request
                .headers()
                .iter()
                .filter(|h| h.field.equiv("anthropic-version") || h.field.equiv("anthropic-beta"))
                .map(|h| (h.field.as_str().to_string(), h.value.as_str().to_string()))
                .collect();
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                let _ = request.respond(error(400, "Could not read the request body."));
                log(400, None);
                return;
            }
            let mut json: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(_) => {
                    let _ = request.respond(error(400, "The body is not valid JSON."));
                    log(400, None);
                    return;
                }
            };
            let asked = json.get("model").and_then(|m| m.as_str()).unwrap_or("").to_string();
            // An exact id wins; otherwise the upstream name alone, which is what
            // most clients have been configured with before they met Conduit.
            let route = config
                .routes
                .iter()
                .find(|r| r.id == asked)
                .or_else(|| config.routes.iter().find(|r| r.upstream == asked))
                .or_else(|| if asked.is_empty() { config.routes.first() } else { None })
                .cloned();
            let Some(route) = route else {
                let _ = request.respond(error(404, &format!("No model called '{asked}'. GET /v1/models lists them.")));
                log(404, Some(asked));
                return;
            };
            json["model"] = serde_json::Value::String(route.upstream.clone());
            let stream = json.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
            let suffix = path.trim_start_matches("/v1");
            let url = format!("{}{}", route.base_url.trim_end_matches('/'), suffix);
            let anthropic = path.starts_with("/v1/messages");
            let status = forward(request, &route, url, json.to_string(), stream, anthropic, passed);
            log(status, Some(route.id));
        }
        ("POST", "/v1/decide") => {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                let _ = request.respond(error(400, "Could not read the request body."));
                log(400, None);
                return;
            }
            let (status, answer, model) = decide(config, &body);
            let _ = request.respond(json_response(status, answer));
            log(status, model);
        }
        _ => {
            let _ = request.respond(error(404, "Not found. This server speaks /v1/models, /v1/chat/completions, /v1/messages and /v1/responses."));
            log(404, None);
        }
    }
}

/// Sends the request on and relays the answer, streaming it when asked to.
/// One query parameter, percent-decoded.
fn param(query: &str, name: &str) -> String {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| percent_decode(v))
        .unwrap_or_default()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn html_response(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "text/html; charset=utf-8"))
        .with_header(header("cache-control", "no-store"))
}

#[derive(Serialize, Clone)]
struct GrantRequest {
    id: String,
    client: String,
    redirect: String,
}

/// Conduit's half of the OAuth flow other programs use.
///
/// `/oauth/authorize` is opened in the browser by the program that wants
/// access; Conduit asks the user in its own window, and the browser waits on a
/// page that polls `/oauth/poll`. The key itself is only ever handed over by
/// `/oauth/token`, in a direct request from the program, in exchange for a
/// one-time code and the verifier matching the challenge it started with.
fn oauth_route(app: &AppHandle, config: &Config, request: tiny_http::Request, path: &str) {
    let query = request.url().split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default();

    match path {
        "/oauth/authorize" => {
            let client = param(&query, "client_name");
            let redirect = param(&query, "redirect_uri");
            let state = param(&query, "state");
            let challenge = param(&query, "code_challenge");

            if redirect.is_empty() || !crate::oauth::redirect_allowed(&redirect) {
                let _ = request.respond(html_response(
                    400,
                    "<h1>That redirect is not allowed</h1><p>Conduit only sends a code back to this \
                     machine, or to the program's own URL scheme.</p>"
                        .into(),
                ));
                return;
            }

            let client = if client.trim().is_empty() { "An application".to_string() } else { client };
            let id = crate::oauth::request(&client, &redirect, &state, &challenge);
            let _ = app.emit(
                "conduit://oauth-request",
                GrantRequest { id: id.clone(), client: client.clone(), redirect: redirect.clone() },
            );
            // Bring the window forward: the request came from another program,
            // so nobody is looking at Conduit yet.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = request.respond(html_response(200, crate::oauth::waiting_page(&id, &client, config.port)));
        }

        "/oauth/poll" => {
            let id = param(&query, "id");
            let body = match crate::oauth::peek(&id) {
                None => serde_json::json!({ "status": "unknown" }),
                Some((_, redirect, decision, state)) => match decision {
                    None => serde_json::json!({ "status": "pending" }),
                    Some(None) => serde_json::json!({ "status": "refused" }),
                    Some(Some(code)) => {
                        let joiner = if redirect.contains('?') { '&' } else { '?' };
                        let mut url = format!("{redirect}{joiner}code={code}");
                        if !state.is_empty() {
                            url.push_str(&format!("&state={state}"));
                        }
                        serde_json::json!({ "status": "approved", "redirect": url })
                    }
                },
            };
            let _ = request.respond(json_response(200, body.to_string()).with_header(header("access-control-allow-origin", "*")));
        }

        "/oauth/token" => {
            let mut body = String::new();
            let mut request = request;
            let _ = request.as_reader().read_to_string(&mut body);
            let json: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            let code = json.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let verifier = json.get("code_verifier").and_then(|v| v.as_str()).unwrap_or("").to_string();

            match crate::oauth::exchange(&code, &verifier) {
                Ok(key) => {
                    let payload = serde_json::json!({ "key": key, "type": "conduit_api_key" });
                    let _ = request.respond(
                        json_response(200, payload.to_string()).with_header(header("access-control-allow-origin", "*")),
                    );
                }
                Err(message) => {
                    let _ = request.respond(error(400, &message).with_header(header("access-control-allow-origin", "*")));
                }
            }
        }

        _ => {
            let _ = request.respond(error(404, "No such endpoint."));
        }
    }
}

fn forward(
    request: tiny_http::Request,
    route: &Route,
    url: String,
    body: String,
    stream: bool,
    anthropic: bool,
    passed: Vec<(String, String)>,
) -> u16 {
    let key = match &route.account {
        Some(account) => match crate::secrets::get(account) {
            Ok(Some(k)) => Some(k),
            _ => {
                let _ = request.respond(error(502, &format!("No key is saved for {account} in Conduit.")));
                return 502;
            }
        },
        None => None,
    };

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let (head_tx, head_rx) = mpsc::channel::<(u16, String)>();

    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(900)).build() {
            Ok(c) => c,
            Err(e) => {
                let _ = head_tx.send((500, "application/json".into()));
                let _ = tx.send(Err(e.to_string()));
                return;
            }
        };
        let mut builder = client.post(&url).header("content-type", "application/json").body(body);
        let has_version = passed.iter().any(|(k, _)| k.eq_ignore_ascii_case("anthropic-version"));
        for (k, v) in passed {
            builder = builder.header(k, v);
        }
        if anthropic && !has_version {
            builder = builder.header("anthropic-version", "2023-06-01");
        }
        if let Some(key) = key {
            // Anthropic's native endpoint wants x-api-key; everything else,
            // including its OpenAI-compatible one, takes a bearer token.
            if anthropic {
                builder = builder.header("x-api-key", key.clone());
            }
            builder = builder.header("authorization", format!("Bearer {key}"));
        }
        match builder.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let kind = response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/json")
                    .to_string();
                let _ = head_tx.send((status, kind));
                let mut chunks = response.bytes_stream();
                while let Some(chunk) = chunks.next().await {
                    match chunk {
                        Ok(bytes) => {
                            if tx.send(Ok(bytes.to_vec())).is_err() {
                                return;
                            }
                        }
                        Err(e) => {
                            let _ = tx.send(Err(e.to_string()));
                            return;
                        }
                    }
                }
            }
            Err(e) => {
                let _ = head_tx.send((502, "application/json".into()));
                let _ = tx.send(Ok(serde_json::json!({ "error": { "message": format!("Upstream unreachable: {e}") } })
                    .to_string()
                    .into_bytes()));
            }
        }
    });

    let (status, kind) = head_rx.recv().unwrap_or((502, "application/json".into()));
    let reader = ChannelReader { rx, buffer: Vec::new(), offset: 0 };
    let mut response = tiny_http::Response::new(
        tiny_http::StatusCode(status),
        vec![header("content-type", &kind), header("access-control-allow-origin", "*")],
        reader,
        None,
        None,
    );
    if stream {
        response.add_header(header("cache-control", "no-cache"));
    }
    let _ = request.respond(response);
    status
}

/// Turns a channel of byte chunks into something `Read`, so a streamed
/// upstream response can be relayed as it arrives rather than buffered.
struct ChannelReader {
    rx: mpsc::Receiver<Result<Vec<u8>, String>>,
    buffer: Vec<u8>,
    offset: usize,
}

impl Read for ChannelReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        while self.offset >= self.buffer.len() {
            match self.rx.recv() {
                Ok(Ok(chunk)) => {
                    self.buffer = chunk;
                    self.offset = 0;
                }
                Ok(Err(e)) => return Err(std::io::Error::new(std::io::ErrorKind::Other, e)),
                Err(_) => return Ok(0),
            }
        }
        let n = out.len().min(self.buffer.len() - self.offset);
        out[..n].copy_from_slice(&self.buffer[self.offset..self.offset + n]);
        self.offset += n;
        Ok(n)
    }
}

/// Addresses other devices can use to reach this machine, for the LAN option.
pub fn lan_addresses() -> Vec<String> {
    let mut out = Vec::new();
    // Asking the OS which interface it would route through to a public address
    // gives the LAN address without listing every virtual adapter.
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                out.push(addr.ip().to_string());
            }
        }
    }
    out
}


const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// One decision from a decision model: a state, a question and options in,
/// a probability per option out. Built here, next to the model, so a game
/// loop pays for one local HTTP hop and nothing else.
fn decide(config: &Config, body: &str) -> (u16, String, Option<String>) {
    let fail = |status: u16, message: &str| (status, serde_json::json!({ "error": { "message": message } }).to_string(), None);
    let Ok(input) = serde_json::from_str::<serde_json::Value>(body) else {
        return fail(400, "The body is not valid JSON.");
    };
    let text = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let kind = text("kind");
    let options: Vec<String> = if kind == "bool" {
        vec!["yes".into(), "no".into()]
    } else {
        input
            .get("options")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|o| o.as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default()
    };
    if options.len() < 2 || options.len() > 26 {
        return fail(400, "Send between 2 and 26 options.");
    }
    let asked = text("model");
    let route = config
        .routes
        .iter()
        .find(|r| !asked.is_empty() && (r.id == asked || r.upstream == asked))
        .or_else(|| config.routes.iter().find(|r| r.decision));
    let Some(route) = route else {
        return fail(404, "No decision model is loaded. Load one in Conduit's Model hub.");
    };

    let mut prompt = String::from(
        "You are a decision function. Read the state, then answer the question by choosing exactly one option.\n\n[State]\n",
    );
    prompt.push_str(&text("state"));
    prompt.push_str("\n\n[Question]\n");
    prompt.push_str(&text("question"));
    prompt.push_str("\n\n[Options]\n");
    for (i, o) in options.iter().enumerate() {
        prompt.push_str(&format!("{}. {}\n", &LETTERS[i..i + 1], o));
    }
    prompt.push_str("\nAnswer:");

    let base = route.base_url.trim_end_matches('/').trim_end_matches("/v1").to_string();
    let started = std::time::Instant::now();
    let request = serde_json::json!({
        "prompt": prompt,
        "n_predict": 1,
        "n_probs": (options.len() * 2).clamp(20, 40),
        "temperature": 0,
        "cache_prompt": true,
    });
    let reply = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::new();
        let res = client.post(format!("{base}/completion")).json(&request).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("The model server answered {}.", res.status().as_u16()));
        }
        res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    });
    let reply = match reply {
        Ok(v) => v,
        Err(e) => return fail(502, &e),
    };

    // Two response shapes have shipped; read whichever is present.
    let mut mass = vec![0f64; options.len()];
    if let Some(first) = reply.get("completion_probabilities").and_then(|v| v.get(0)) {
        let mut add = |token: &str, p: f64| {
            let t = token.trim().trim_end_matches(['.', ')', ':']).to_uppercase();
            if t.len() == 1 {
                if let Some(i) = LETTERS.find(&t) {
                    if i < options.len() {
                        mass[i] += p;
                    }
                }
            }
        };
        if let Some(list) = first.get("top_logprobs").and_then(|v| v.as_array()) {
            for t in list {
                add(t["token"].as_str().unwrap_or(""), t["logprob"].as_f64().unwrap_or(f64::NEG_INFINITY).exp());
            }
        } else if let Some(list) = first.get("probs").and_then(|v| v.as_array()) {
            for t in list {
                add(t["tok_str"].as_str().unwrap_or(""), t["prob"].as_f64().unwrap_or(0.0));
            }
        }
    }
    let total: f64 = mass.iter().sum();
    let probs: Vec<f64> = mass.iter().map(|m| if total > 0.0 { m / total } else { 1.0 / options.len() as f64 }).collect();
    let best = probs
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| options[i].clone())
        .unwrap_or_default();
    let mut answer = serde_json::json!({
        "best": best,
        "options": options.iter().zip(probs.iter()).map(|(l, p)| serde_json::json!({ "label": l, "p": p })).collect::<Vec<_>>(),
        "ms": started.elapsed().as_millis() as u64,
        "model": route.id,
    });
    if kind == "score" {
        let expected: f64 = probs.iter().enumerate().map(|(i, p)| i as f64 * p).sum();
        answer["expected"] = serde_json::json!(expected);
    }
    (200, answer.to_string(), Some(route.id.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a llama-server with a decision model on 127.0.0.1:8699:
    /// `cargo test decide_live -- --ignored`
    #[test]
    #[ignore]
    fn decide_live() {
        let config = Config {
            port: 0,
            lan: false,
            token_hashes: vec![],
            keyless_local: true,
            routes: vec![Route {
                id: "local/jev".into(),
                base_url: "http://127.0.0.1:8699/v1".into(),
                upstream: "jev".into(),
                account: None,
                decision: true,
            }],
        };
        let body = r#"{"state":"Shares of the chipmaker jumped 8% after it raised its revenue forecast.","question":"Which news section does this article belong to?","options":["World","Sports","Business","Science/Technology"]}"#;
        let (status, answer, _) = decide(&config, body);
        println!("{answer}");
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&answer).unwrap();
        assert_eq!(v["best"], "Business");
    }
}
