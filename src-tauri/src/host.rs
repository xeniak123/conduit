//! Filesystem, processes and opening things — as first-party commands.
//!
//! These used to go through Tauri's fs/shell/opener plugins, and every one of
//! them was refused at runtime: those plugins gate on an allowlist declared in
//! the capability file, and a capability without a *scope* denies everything.
//! The symptom was an agent that could not open a browser, run a command, or
//! read a file, reporting `not allowed by ACL` for each attempt.
//!
//! Rather than maintain a second allowlist, the operations live here. Conduit
//! already has a permission model — profiles, per-tool overrides, and a dialog
//! showing the verbatim command — and that model is the one the user actually
//! sees and controls. Two overlapping gates meant the invisible one silently
//! won.
//!
//! What is *not* given up: nothing here runs without passing through that
//! dialog when the user's profile says it should.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub directory: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

/// Resolves a path the way a person means it.
///
/// `~` and a bare relative path both mean "from home" — that is how people
/// speak ("a folder in Documents"), and the model repeats their phrasing.
fn resolve(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("No path given.".into());
    }

    let home = dirs_home()?;

    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        return Ok(home.join(rest));
    }
    if trimmed == "~" {
        return Ok(home);
    }

    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Ok(home.join(path))
}

fn dirs_home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not determine your home folder.".to_string())
}

/// The same resolution, for other modules.
///
/// Downloads, archives and installed extensions all land in the filesystem and
/// all arrive as strings written by a model or read from a manifest. One
/// resolver means there is one place where "Documents" becomes a real path,
/// and one place to look when it does not.
pub fn resolve_public(raw: &str) -> Result<PathBuf, String> {
    resolve(raw)
}

/// Where Conduit keeps what it installs: `~/.conduit`.
///
/// Outside the application bundle deliberately — an update replaces the
/// program, and taking a user's installed extensions and downloaded models
/// with it would be a data loss bug dressed up as a release.
pub fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs_home()?.join(".conduit");
    std::fs::create_dir_all(&dir).map_err(|e| describe(&dir, e))?;
    Ok(dir)
}

/// Turns an IO failure into something a person can act on.
///
/// "os error 2" tells the user nothing; naming the path and the reason tells
/// them whether they mistyped it or lack permission.
fn describe(path: &Path, e: std::io::Error) -> String {
    let what = match e.kind() {
        std::io::ErrorKind::NotFound => "does not exist",
        std::io::ErrorKind::PermissionDenied => "is not readable with your permissions",
        std::io::ErrorKind::AlreadyExists => "already exists",
        _ => return format!("{}: {e}", path.display()),
    };
    format!("{} {what}.", path.display())
}

pub fn read_file(raw: &str, limit: usize) -> Result<String, String> {
    let path = resolve(raw)?;
    let text = std::fs::read_to_string(&path).map_err(|e| describe(&path, e))?;
    Ok(if text.len() > limit {
        format!("{}\n\n[truncated at {limit} characters]", &text[..limit])
    } else {
        text
    })
}

pub fn write_file(raw: &str, contents: &str) -> Result<String, String> {
    let path = resolve(raw)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| describe(parent, e))?;
    }
    std::fs::write(&path, contents).map_err(|e| describe(&path, e))?;
    Ok(format!("Wrote {} characters to {}", contents.len(), path.display()))
}

pub fn list_dir(raw: &str) -> Result<Vec<Entry>, String> {
    let path = resolve(raw)?;
    let mut entries: Vec<Entry> = std::fs::read_dir(&path)
        .map_err(|e| describe(&path, e))?
        .filter_map(|e| e.ok())
        .map(|e| {
            let meta = e.metadata().ok();
            Entry {
                name: e.file_name().to_string_lossy().to_string(),
                directory: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                size: meta.map(|m| m.len()).unwrap_or(0),
            }
        })
        .collect();

    // Folders first, then alphabetical — the order a file manager uses, and
    // the order that makes a long listing scannable.
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then(a.name.cmp(&b.name)));
    Ok(entries)
}

pub fn make_dir(raw: &str) -> Result<String, String> {
    let path = resolve(raw)?;
    if path.exists() {
        return Ok(format!("{} already exists.", path.display()));
    }
    std::fs::create_dir_all(&path).map_err(|e| describe(&path, e))?;
    Ok(format!("Created {}", path.display()))
}

pub fn remove_path(raw: &str) -> Result<String, String> {
    let path = resolve(raw)?;
    let meta = std::fs::metadata(&path).map_err(|e| describe(&path, e))?;

    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| describe(&path, e))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| describe(&path, e))?;
    }
    Ok(format!("Deleted {}", path.display()))
}

pub fn exists(raw: &str) -> bool {
    resolve(raw).map(|p| p.exists()).unwrap_or(false)
}

/// Runs a command line through the platform shell.
///
/// Through the shell rather than spawning the binary directly, because that is
/// what makes pipes, redirection and shell builtins work — and the model, like
/// a person, writes command lines rather than argv arrays.
pub fn run_command(command: &str, cwd: Option<&str>) -> Result<Output, String> {
    use std::process::Command;

    let mut process = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        let resolved = resolve(dir)?;
        if !resolved.is_dir() {
            return Err(format!("{} is not a folder.", resolved.display()));
        }
        process.current_dir(resolved);
    }

    #[cfg(windows)]
    {
        // Without this every command flashes a console window on screen.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }

    let output = process
        .output()
        .map_err(|e| format!("Could not run that: {e}"))?;

    Ok(Output {
        stdout: String::from_utf8_lossy(&output.stdout).trim_end().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim_end().to_string(),
        code: output.status.code().unwrap_or(-1),
    })
}

/// Opens a file, folder, application or URL with the system's own handler.
///
/// The same mechanism as double-clicking it, which is why this works for
/// applications the shell knows by name even when no binary is on PATH.
pub fn open_target(target: &str) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("Nothing to open.".into());
    }

    let is_url = target.starts_with("http://")
        || target.starts_with("https://")
        || target.starts_with("mailto:");

    // A path gets resolved first so "Documents" behaves like "~/Documents";
    // anything else is handed over as typed, which is what lets a bare
    // application name work.
    let subject = if is_url {
        target.to_string()
    } else {
        match resolve(target) {
            Ok(path) if path.exists() => path.display().to_string(),
            _ => target.to_string(),
        }
    };

    open_with_system(&subject)?;
    Ok(format!("Opened {subject}"))
}

#[cfg(windows)]
fn open_with_system(subject: &str) -> Result<(), String> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // `start` needs an empty title argument first, or it treats a quoted
    // target as the window title and opens nothing at all.
    let status = Command::new("cmd")
        .args(["/C", "start", "", subject])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("Could not open that: {e}"))?;

    if status.success() {
        return Ok(());
    }
    Err(format!("Windows could not open \"{subject}\"."))
}

#[cfg(target_os = "macos")]
fn open_with_system(subject: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(subject)
        .status()
        .map_err(|e| format!("Could not open that: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err(format!("Could not open \"{subject}\".")) })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_system(subject: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(subject)
        .status()
        .map_err(|e| format!("Could not open that: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err(format!("Could not open \"{subject}\".")) })
}
