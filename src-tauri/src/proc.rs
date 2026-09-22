//! Long-lived child processes, downloads, and what this machine can run.
//!
//! Three features need this and none of them fit `run_command`, which starts a
//! process, waits, and hands back the output:
//!
//!   - **MCP servers** speak JSON-RPC over stdin/stdout for as long as they are
//!     connected. A one-shot command cannot hold a conversation.
//!   - **A local speech model** is a file of between 75 MB and 1.6 GB. A
//!     download with no progress is indistinguishable from a hang, and people
//!     kill applications that appear to have hung.
//!   - **Recommending a model** requires knowing how much memory is actually
//!     installed, rather than asking the user to guess.
//!
//! Every child is tracked by an id the caller chose, so the web layer can stop
//! one without knowing a pid, and so a reload does not leak orphans.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A running child, minus everything the caller is not allowed to touch.
struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct Processes {
    running: Arc<Mutex<HashMap<String, Running>>>,
}

#[derive(Serialize, Clone)]
struct Line {
    id: String,
    line: String,
}

#[derive(Serialize, Clone)]
struct Exit {
    id: String,
    code: i32,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub id: String,
    /// Bytes written so far.
    pub received: u64,
    /// Total, when the server declared one. Zero means unknown.
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
}

impl Processes {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts a child and streams both of its output pipes as events.
    ///
    /// Lines rather than bytes: every protocol this is used for is line
    /// delimited, and a partial line delivered to the web layer would have to
    /// be reassembled there, where it is much easier to get wrong.
    pub fn spawn(
        &self,
        app: AppHandle,
        id: &str,
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        env: &HashMap<String, String>,
    ) -> Result<u32, String> {
        if self.running.lock().unwrap().contains_key(id) {
            return Err(format!("{id} is already running."));
        }

        let mut command = Command::new(program);
        command
            .args(args)
            .envs(resolve_env(env))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = cwd {
            command.current_dir(crate::host::resolve_public(dir)?);
        }

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                format!("{program} is not installed, or not on PATH.")
            }
            _ => format!("Could not start {program}: {e}"),
        })?;

        let pid = child.id();
        let stdin = child.stdin.take();

        pump(app.clone(), id.to_string(), child.stdout.take(), "conduit://proc-out");
        pump(app.clone(), id.to_string(), child.stderr.take(), "conduit://proc-err");

        // Reaping happens on its own thread so an exit is reported the moment
        // it occurs, rather than the next time somebody happens to ask.
        {
            let running = self.running.clone();
            let id = id.to_string();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(220));
                let mut guard = running.lock().unwrap();
                let Some(entry) = guard.get_mut(&id) else { return };
                match entry.child.try_wait() {
                    Ok(Some(status)) => {
                        guard.remove(&id);
                        drop(guard);
                        let _ = app.emit(
                            "conduit://proc-exit",
                            Exit { id: id.clone(), code: status.code().unwrap_or(-1) },
                        );
                        return;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        guard.remove(&id);
                        return;
                    }
                }
            });
        }

        self.running
            .lock()
            .unwrap()
            .insert(id.to_string(), Running { child, stdin });

        Ok(pid)
    }

    /// Writes one line to a child's stdin, newline included.
    pub fn write(&self, id: &str, line: &str) -> Result<(), String> {
        let mut guard = self.running.lock().unwrap();
        let entry = guard.get_mut(id).ok_or_else(|| format!("{id} is not running."))?;
        let stdin = entry.stdin.as_mut().ok_or("That process has no input pipe.")?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Could not write to {id}: {e}"))
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut guard = self.running.lock().unwrap();
        let Some(mut entry) = guard.remove(id) else { return Ok(()) };
        // Dropping stdin first gives a well-behaved server the chance to exit
        // on its own; the kill is the backstop, not the plan.
        entry.stdin.take();
        let _ = entry.child.kill();
        let _ = entry.child.wait();
        Ok(())
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.running.lock().unwrap().keys().cloned().collect()
    }

    /// Stops everything. Called on shutdown so a quit never leaves servers
    /// running with no window left to stop them from.
    pub fn kill_all(&self) {
        for id in self.ids() {
            let _ = self.kill(&id);
        }
    }
}

/// Swaps `secret:name` placeholders for the real credential.
///
/// An MCP server usually wants its token in the environment, and the obvious
/// implementation — let the web layer put it there — would undo the one rule
/// the credential store exists to enforce: a key goes in and never comes back
/// out to the renderer. So the renderer stores the *name* of a credential in
/// its configuration, and the value is only ever assembled here, on its way
/// into the child's environment.
///
/// A name with nothing behind it becomes an empty value rather than the
/// literal placeholder, so a server fails its own authentication check with a
/// message about a missing token instead of one about a malformed one.
fn resolve_env(env: &HashMap<String, String>) -> HashMap<String, String> {
    env.iter()
        .map(|(key, value)| {
            let resolved = match value.strip_prefix("secret:") {
                Some(account) => crate::secrets::get(account).ok().flatten().unwrap_or_default(),
                None => value.clone(),
            };
            (key.clone(), resolved)
        })
        .collect()
}

fn pump<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    id: String,
    stream: Option<R>,
    event: &'static str,
) {
    let Some(stream) = stream else { return };
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else { return };
            let _ = app.emit(event, Line { id: id.clone(), line });
        }
    });
}

// --- downloads ---------------------------------------------------------------

/// Streams a URL to disk, reporting progress as it goes.
///
/// Written to a `.part` beside the destination and renamed at the end, so an
/// interrupted download can never be mistaken for a complete one — a truncated
/// model file fails later, deep inside a runtime, with an error nobody can act
/// on.
pub async fn download(
    app: AppHandle,
    id: String,
    url: String,
    dest: String,
    hf_token: bool,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let path = crate::host::resolve_public(&dest)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let partial = path.with_extension("part");

    let mut request = reqwest::Client::new().get(&url);
    // A Hugging Face token opens gated and private repositories. It is only
    // ever sent to huggingface.co itself, whatever URL the caller passes, so a
    // redirect or a crafted link cannot carry it anywhere else.
    if hf_token {
        let host = reqwest::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default();
        if host == "huggingface.co" {
            if let Ok(Some(token)) = crate::secrets::get("huggingface") {
                request = request.bearer_auth(token);
            }
        }
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Could not reach {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status().as_u16()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if take_cancel(&id) {
            drop(file);
            let _ = std::fs::remove_file(&partial);
            return Err("Cancelled.".into());
        }
        let chunk = chunk.map_err(|e| format!("The download stopped early: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;

        // Ten reports a second is past what anybody can read, and each one is
        // an IPC message competing with the interface that displays it.
        if last_emit.elapsed().as_millis() > 100 {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "conduit://download",
                Progress { id: id.clone(), received, total, done: false, error: None },
            );
        }
    }

    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "conduit://download",
        Progress { id, received, total, done: true, error: None },
    );

    Ok(path.to_string_lossy().to_string())
}

/// Unpacks a zip or a .tar.gz. Entries that would escape the destination are
/// refused — an archive is untrusted input no matter how reputable its origin.
pub fn unzip(archive: &str, dest: &str) -> Result<usize, String> {
    let archive_path = crate::host::resolve_public(archive)?;
    let dest_path = crate::host::resolve_public(dest)?;
    std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;

    let lower = archive_path.to_string_lossy().to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return untar(&archive_path, &dest_path);
    }

    let file = std::fs::File::open(&archive_path)
        .map_err(|e| format!("Could not open {}: {e}", archive_path.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Not a readable zip: {e}"))?;

    let mut written = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else {
            return Err(format!("The archive contains an unsafe path: {}", entry.name()));
        };
        let out = dest_path.join(name);

        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut target = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut target).map_err(|e| e.to_string())?;
        written += 1;
    }

    Ok(written)
}

/// Finds a named executable inside an archive extraction folder.
///
/// A release archive may add a wrapping directory between versions. Searching
/// its own extraction folder is safer than betting on a fixed layout, while a
/// depth cap keeps this a small, predictable recovery step rather than a disk
/// scan.
static CANCELLED: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

fn cancelled() -> &'static Mutex<std::collections::HashSet<String>> {
    CANCELLED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Asks a running download to stop. It notices at the next chunk.
pub fn cancel_download(id: &str) {
    cancelled().lock().unwrap().insert(id.to_string());
}

fn take_cancel(id: &str) -> bool {
    cancelled().lock().unwrap().remove(id)
}

// --- graphics ------------------------------------------------------------------

#[derive(Serialize, Clone, Default)]
pub struct Gpu {
    pub name: String,
    /// Dedicated video memory in megabytes; zero when unknown.
    pub vram_mb: u64,
    pub vendor: String,
}

/// The graphics card and how much memory it has.
///
/// `nvidia-smi` is exact when it is there. Without it, Windows keeps the real
/// figure in the display adapter's registry key — the WMI `AdapterRAM` value
/// everybody reaches for first is a 32-bit field and reports 4 GB for any card
/// with more than that.
pub fn gpu() -> Gpu {
    if let Ok(out) = quiet("nvidia-smi", &["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]) {
        if let Some(line) = out.lines().find(|l| l.contains(',')) {
            let mut parts = line.split(',');
            let name = parts.next().unwrap_or("").trim().to_string();
            let vram = parts.next().unwrap_or("0").trim().parse::<u64>().unwrap_or(0);
            if !name.is_empty() {
                return Gpu { name, vram_mb: vram, vendor: "nvidia".into() };
            }
        }
    }

    #[cfg(windows)]
    {
        let script = r#"Get-ItemProperty 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { "$($_.DriverDesc)|$($_.'HardwareInformation.qwMemorySize')" }"#;
        if let Ok(out) = quiet("powershell", &["-NoProfile", "-Command", script]) {
            let best = out
                .lines()
                .filter_map(|l| {
                    let (name, bytes) = l.trim().rsplit_once('|')?;
                    Some((name.trim().to_string(), bytes.trim().parse::<u64>().ok()? / (1024 * 1024)))
                })
                .max_by_key(|(_, mb)| *mb);
            if let Some((name, vram)) = best {
                let lower = name.to_lowercase();
                let vendor = if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") {
                    "nvidia"
                } else if lower.contains("amd") || lower.contains("radeon") {
                    "amd"
                } else if lower.contains("intel") {
                    "intel"
                } else {
                    "other"
                };
                return Gpu { name, vram_mb: vram, vendor: vendor.into() };
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if std::env::consts::ARCH == "aarch64" {
            // Unified memory: the GPU can use most of it.
            let ram = memory_mb();
            return Gpu { name: "Apple Silicon".into(), vram_mb: ram * 3 / 4, vendor: "apple".into() };
        }
    }

    Gpu::default()
}

fn quiet(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let out = command.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn find_file(root: &str, name: &str) -> Result<String, String> {
    let root = crate::host::resolve_public(root)?;
    let mut todo = vec![(root.clone(), 0usize)];

    while let Some((dir, depth)) = todo.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file()
                && path
                    .file_name()
                    .map(|file| file.to_string_lossy().eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            {
                return Ok(path.to_string_lossy().to_string());
            }
            if depth < 4 && path.is_dir() {
                todo.push((path, depth + 1));
            }
        }
    }

    Err(format!("Could not find {name} inside {}.", root.display()))
}

fn untar(archive: &std::path::Path, dest: &std::path::Path) -> Result<usize, String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut written = 0usize;
    for entry in tar.entries().map_err(|e| format!("Not a readable archive: {e}"))? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        // `unpack_in` refuses paths that would land outside `dest` and
        // returns false for them; that is the same rule as the zip branch.
        if entry.unpack_in(dest).map_err(|e| e.to_string())? {
            written += 1;
        }
    }
    Ok(written)
}

/// SHA-256 of a file, streamed so a 1.6 GB model does not need 1.6 GB of RAM.
pub fn sha256(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let resolved = crate::host::resolve_public(path)?;
    let mut file = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

// --- what this machine can run ----------------------------------------------

#[derive(Serialize, Clone)]
pub struct Machine {
    pub os: String,
    pub arch: String,
    pub cores: usize,
    /// Physical memory in megabytes. Zero when it could not be determined,
    /// which the caller must treat as "unknown", never as "none".
    pub memory_mb: u64,
}

pub fn machine() -> Machine {
    Machine {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        memory_mb: memory_mb(),
    }
}

#[cfg(windows)]
fn memory_mb() -> u64 {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe {
        if GlobalMemoryStatusEx(&mut status).is_ok() {
            return status.ullTotalPhys / (1024 * 1024);
        }
    }
    0
}

#[cfg(target_os = "linux")]
fn memory_mb() -> u64 {
    let Ok(text) = std::fs::read_to_string("/proc/meminfo") else { return 0 };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: u64 = rest.trim().trim_end_matches(" kB").trim().parse().unwrap_or(0);
            return kb / 1024;
        }
    }
    0
}

#[cfg(target_os = "macos")]
fn memory_mb() -> u64 {
    let Ok(out) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() else { return 0 };
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<u64>()
        .map(|bytes| bytes / (1024 * 1024))
        .unwrap_or(0)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn memory_mb() -> u64 {
    0
}

// --- coding agents in a terminal ------------------------------------------------

/// Programs Conduit will open in a terminal for the Agents page, plus the two
/// interpreters the fine-tuning page runs its generated script with. A fixed
/// list: the page composes the environment and the arguments, never the
/// program, and a training run belongs in a terminal the user can watch and
/// close rather than inside the app.
const AGENTS: &[&str] = &[
    "claude", "codex", "opencode", "aider", "goose", "crush", "qwen", "gemini", "hermes", "openclaw", "python",
    "python3",
];

/// Where a program is on PATH, if anywhere.
pub fn which(program: &str) -> Option<String> {
    let finder = if cfg!(windows) { "where" } else { "which" };
    let out = quiet(finder, &[program]).ok()?;
    out.lines().next().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
}

/// Opens a new terminal window running an agent with the given environment.
///
/// The agent's own configuration files are never touched: everything travels
/// as environment variables in a small launcher script that Conduit writes to
/// its own folder, so closing the window leaves nothing behind in the agent.
pub fn launch_agent(
    program: &str,
    args: &[String],
    env: &std::collections::HashMap<String, String>,
    cwd: Option<&str>,
) -> Result<String, String> {
    if !AGENTS.contains(&program) {
        return Err(format!("{program} is not an agent Conduit knows how to open."));
    }
    let bad = |v: &str| v.contains('"') || v.contains('\n') || v.contains('\r') || v.contains('%') || v.contains('`');
    for (k, v) in env {
        if !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || bad(v) {
            return Err(format!("Refused an unsafe value for {k}."));
        }
    }
    for a in args {
        if bad(a) {
            return Err("Refused an unsafe argument.".into());
        }
    }
    let dir = crate::host::data_dir()?.join("agents");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let quote = |a: &str| if a.contains(' ') || a.is_empty() { format!("\"{a}\"") } else { a.to_string() };
    let line = std::iter::once(program.to_string())
        .chain(args.iter().map(|a| quote(a)))
        .collect::<Vec<_>>()
        .join(" ");

    #[cfg(windows)]
    {
        let script = dir.join(format!("launch-{program}.cmd"));
        let mut body = String::from("@echo off\r\n");
        body.push_str(&format!("title Conduit: {program}\r\n"));
        for (k, v) in env {
            body.push_str(&format!("set \"{k}={v}\"\r\n"));
        }
        if let Some(cwd) = cwd {
            body.push_str(&format!("cd /d \"{cwd}\"\r\n"));
        }
        body.push_str(&format!("{line}\r\n"));
        std::fs::write(&script, body).map_err(|e| e.to_string())?;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "cmd", "/K"])
            .arg(&script)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(script.to_string_lossy().to_string());
    }

    #[cfg(not(windows))]
    {
        let ext = if cfg!(target_os = "macos") { "command" } else { "sh" };
        let script = dir.join(format!("launch-{program}.{ext}"));
        let mut body = String::from("#!/bin/sh\n");
        for (k, v) in env {
            body.push_str(&format!("export {k}='{}'\n", v.replace('\'', "")));
        }
        if let Some(cwd) = cwd {
            body.push_str(&format!("cd '{}'\n", cwd.replace('\'', "")));
        }
        body.push_str(&format!("exec {line}\n"));
        std::fs::write(&script, body).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
        }
        let spawned = if cfg!(target_os = "macos") {
            std::process::Command::new("open").args(["-a", "Terminal"]).arg(&script).spawn()
        } else {
            std::process::Command::new("x-terminal-emulator").arg("-e").arg(&script).spawn()
        };
        spawned.map_err(|e| e.to_string())?;
        Ok(script.to_string_lossy().to_string())
    }
}
