//! Getting text *into* whatever the user is actually looking at.
//!
//! Two strategies, because neither works everywhere:
//!   * `paste` — clipboard + Ctrl/Cmd+V. Instant regardless of length, and the
//!     only sane option for a paragraph of dictation. Clobbers the clipboard,
//!     so we put the old contents back.
//!   * `type_out` — synthesised keystrokes. Slower, but survives apps that
//!     block programmatic paste (some terminals, some Electron inputs).

use enigo::{Direction, Enigo, Key, Keyboard, Settings};

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct FocusTarget {
    /// Executable name, e.g. "Code.exe" — what plugins match against.
    pub process: String,
    /// Window title, e.g. "pipeline.ts — conduit".
    pub title: String,
}

#[cfg(target_os = "macos")]
const MODIFIER: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const MODIFIER: Key = Key::Control;

fn enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("input backend unavailable: {e}"))
}

/// Restores the previous clipboard contents after pasting. Best effort: if the
/// user copies something during the ~80 ms window we would overwrite it, which
/// is an acceptable trade for not permanently eating their clipboard.
pub fn paste(text: &str, previous_clipboard: Option<String>) -> Result<(), String> {
    let mut e = enigo()?;

    e.key(MODIFIER, Direction::Press).map_err(err)?;
    e.key(Key::Unicode('v'), Direction::Click).map_err(err)?;
    e.key(MODIFIER, Direction::Release).map_err(err)?;

    if previous_clipboard.is_some() {
        // The paste is asynchronous from the target app's point of view; give it
        // a moment before we swap the clipboard back out from under it.
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
    let _ = text;
    Ok(())
}

pub fn type_out(text: &str) -> Result<(), String> {
    let mut e = enigo()?;
    e.text(text).map_err(err)
}

pub fn press_combo(keys: &[String]) -> Result<(), String> {
    let mut e = enigo()?;
    let mut held = Vec::new();

    for raw in keys {
        let key = parse_key(raw)?;
        if is_modifier(&key) {
            e.key(key, Direction::Press).map_err(err)?;
            held.push(key);
        } else {
            e.key(key, Direction::Click).map_err(err)?;
        }
    }
    for key in held.into_iter().rev() {
        e.key(key, Direction::Release).map_err(err)?;
    }
    Ok(())
}

fn is_modifier(key: &Key) -> bool {
    matches!(key, Key::Control | Key::Alt | Key::Shift | Key::Meta)
}

fn parse_key(raw: &str) -> Result<Key, String> {
    let k = raw.trim().to_ascii_lowercase();
    Ok(match k.as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "cmd" | "meta" | "super" | "win" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        other => {
            let mut chars = other.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return Err(format!("unrecognised key: {raw}")),
            }
        }
    })
}

fn err(e: impl std::fmt::Display) -> String {
    format!("input injection failed: {e}")
}

// --- Which app is in front? ------------------------------------------------
//
// This is what lets Conduit behave differently in a terminal than in a chat
// box, and what plugins bind to. Only Windows is implemented natively so far;
// the other platforms degrade to "unknown", which every caller tolerates.

#[cfg(windows)]
pub fn focused() -> FocusTarget {
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return FocusTarget::default();
        }

        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..len.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return FocusTarget { process: String::new(), title };
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .ok()
            .map(|handle| {
                let mut path = [0u16; MAX_PATH as usize];
                let mut size = path.len() as u32;
                let ok = QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(path.as_mut_ptr()),
                    &mut size,
                )
                .is_ok();
                let _ = CloseHandle(handle);
                if ok {
                    String::from_utf16_lossy(&path[..size as usize])
                        .rsplit(|c| c == '\\' || c == '/')
                        .next()
                        .unwrap_or_default()
                        .to_string()
                } else {
                    String::new()
                }
            })
            .unwrap_or_default();

        FocusTarget { process, title }
    }
}

#[cfg(not(windows))]
pub fn focused() -> FocusTarget {
    FocusTarget::default()
}
