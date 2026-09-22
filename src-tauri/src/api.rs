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
use tauri::{AppHandle, Emitter};

#[derive(Deserialize, Clone)]
pub struct Route {
    /// The name clients ask for, e.g. `local/qwen3-8b` or `openai/gpt-5`.
    pub id: String,
    pub base_url: String,
    /// The name the upstream expects.
    pub upstream: String,
    /// Credential to attach, if any, as `Authorization: Bearer <key>`.
    pub account: Option<String>,
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
        _ => {
            let _ = request.respond(error(404, "Not found. This server speaks /v1/models, /v1/chat/completions, /v1/messages and /v1/responses."));
            log(404, None);
        }
    }
}

/// Sends the request on and relays the answer, streaming it when asked to.
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

