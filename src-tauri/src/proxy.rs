//! Outbound requests, with credentials attached in the native layer.
//!
//! The renderer composes every provider request — that is where the provider
//! logic belongs, and it stays hackable there. What it never holds is the key.
//! It names a credential; this module fetches that credential from the OS
//! store and attaches it as the request leaves the process.
//!
//! The practical consequence: a compromised dependency in the web bundle, a
//! devtools session, or an injected script cannot read a key that is already
//! saved. It can make requests, which the user can see and revoke — it cannot
//! walk away with the credential itself.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::secrets;

#[derive(Deserialize)]
pub struct Auth {
    /// Credential name in the OS store, e.g. "anthropic".
    account: String,
    /// Header to carry it, e.g. "x-api-key" or "authorization".
    header: String,
    /// How to format it; `{key}` is substituted. e.g. "Bearer {key}".
    template: String,
}

#[derive(Deserialize)]
pub struct ProxyRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    auth: Option<Auth>,
}

#[derive(Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Model calls can legitimately run for minutes on a hard prompt; the
        // agent loop has its own abort, so this only catches a dead connection.
        .timeout(std::time::Duration::from_secs(300))
        .user_agent(concat!("Conduit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("could not create HTTP client: {e}"))
}

fn resolve(auth: &Auth) -> Result<String, String> {
    let key = secrets::get(&auth.account)?.ok_or_else(|| {
        format!("No API key saved for {}. Open Settings → Models.", auth.account)
    })?;
    Ok(auth.template.replace("{key}", &key))
}

pub async fn send(request: ProxyRequest) -> Result<ProxyResponse, String> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("unsupported method: {}", request.method))?;

    let mut builder = client()?.request(method, &request.url);

    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }

    if let Some(auth) = &request.auth {
        builder = builder.header(auth.header.as_str(), resolve(auth)?);
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| format!("could not read response: {e}"))?;

    Ok(ProxyResponse { status, headers, body })
}

/// Speech-to-text, which needs a multipart upload rather than a JSON body.
///
/// Audio arrives as base64 because that is what the recorder hands the
/// renderer; decoding here avoids a second copy through a Blob and keeps the
/// credential on this side of the boundary like every other request.
pub async fn transcribe(
    url: String,
    account: String,
    model: String,
    language: Option<String>,
    wav_base64: String,
) -> Result<ProxyResponse, String> {
    use base64::Engine;

    let audio = base64::engine::general_purpose::STANDARD
        .decode(wav_base64)
        .map_err(|e| format!("invalid audio payload: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(audio)
                .file_name("speech.wav")
                .mime_str("audio/wav")
                .map_err(|e| e.to_string())?,
        )
        .text("model", model)
        .text("response_format", "verbose_json");

    if let Some(language) = language.filter(|l| !l.is_empty()) {
        form = form.text("language", language);
    }

    let mut builder = client()?.post(&url).multipart(form);

    // A local Whisper server needs no key; a hosted one does.
    if !account.is_empty() {
        if let Some(key) = secrets::get(&account)? {
            builder = builder.header("authorization", format!("Bearer {key}"));
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("transcription request failed: {e}"))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("could not read transcription: {e}"))?;

    Ok(ProxyResponse { status, headers: HashMap::new(), body })
}

/// Streams a response back to the renderer as it arrives.
///
/// The non-streaming path buffers the whole body, which is correct for a tool
/// call but wrong for prose: a thirty-second silence followed by a wall of
/// text reads as a hang, while the same text arriving progressively reads as
/// thinking. Chunks are emitted as events keyed by a caller-supplied id, so
/// several requests can be in flight without their bytes interleaving.
pub async fn stream(
    app: tauri::AppHandle,
    id: String,
    request: ProxyRequest,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("unsupported method: {}", request.method))?;

    let mut builder = client()?.request(method, &request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(auth) = &request.auth {
        builder = builder.header(auth.header.as_str(), resolve(auth)?);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|e| format!("request failed: {e}"))?;
    let status = response.status().as_u16();

    // A failed stream still has a body worth reading — it carries the provider's
    // explanation, and dropping it leaves the user with a bare status code.
    if !(200..300).contains(&status) {
        let body = response.text().await.unwrap_or_default();
        let _ = app.emit(
            &format!("conduit://stream/{id}"),
            StreamEvent::Error { status, message: body },
        );
        return Ok(());
    }

    let mut bytes = response.bytes_stream();
    while let Some(chunk) = bytes.next().await {
        match chunk {
            Ok(data) => {
                let text = String::from_utf8_lossy(&data).to_string();
                let _ = app.emit(&format!("conduit://stream/{id}"), StreamEvent::Chunk { text });
            }
            Err(e) => {
                let _ = app.emit(
                    &format!("conduit://stream/{id}"),
                    StreamEvent::Error { status: 0, message: e.to_string() },
                );
                return Ok(());
            }
        }
    }

    let _ = app.emit(&format!("conduit://stream/{id}"), StreamEvent::Done);
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum StreamEvent {
    Chunk { text: String },
    Error { status: u16, message: String },
    Done,
}
