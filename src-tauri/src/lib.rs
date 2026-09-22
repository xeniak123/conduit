mod api;
mod audio;
mod companion;
mod host;
mod inject;
mod pointer;
mod proc;
mod proxy;
mod screen;
mod secrets;

use audio::Audio;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// What the user is trying to do when they hold a hotkey.
///
/// The distinction matters before we have any text: dictation always ends up
/// in the focused field, while a command may open apps or run a shell. Keeping
/// them on separate hotkeys means we never have to *guess* which one was meant.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Speak, get polished text in the field you were already typing in.
    Dictate,
    /// Speak, get actions.
    Command,
}

#[derive(Serialize, Clone)]
struct CaptureEvent {
    mode: Mode,
    focus: inject::FocusTarget,
}

struct AppState {
    audio: Audio,
    companion: companion::Companion,
    procs: proc::Processes,
    api: api::Api,
}

// --- commands ---------------------------------------------------------------

#[tauri::command]
fn start_recording(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.start()
}

/// Returns base64 of a 16 kHz mono WAV, ready to POST to any STT endpoint.
#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> Result<String, String> {
    let wav = state.audio.stop()?;
    Ok(base64::engine::general_purpose::STANDARD.encode(wav))
}

#[tauri::command]
fn focused_app() -> inject::FocusTarget {
    inject::focused()
}

/// Presses paste in the focused app. The caller owns the clipboard dance —
/// it already has the plugin handle, and doing it there keeps save/restore
/// on one side of the boundary.
#[tauri::command]
fn paste_clipboard(text: String) -> Result<(), String> {
    inject::paste(&text, None)
}

#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    inject::type_out(&text)
}

#[tauri::command]
fn press_keys(keys: Vec<String>) -> Result<(), String> {
    inject::press_combo(&keys)
}

// --- computer use ------------------------------------------------------------

#[tauri::command]
async fn capture_screen() -> Result<screen::Capture, String> {
    // Capture is blocking and can take ~50 ms on a large display; keeping it
    // off the main thread stops the UI from stuttering mid-run.
    tauri::async_runtime::spawn_blocking(|| screen::capture_primary().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn pointer_move(x: i32, y: i32) -> Result<(), String> {
    pointer::glide_to(x, y)
}

#[tauri::command]
fn pointer_click(kind: pointer::ClickKind) -> Result<(), String> {
    pointer::click(kind)
}

#[tauri::command]
fn pointer_scroll(amount: i32, horizontal: bool) -> Result<(), String> {
    pointer::scroll(amount, horizontal)
}

#[tauri::command]
fn pointer_drag(x: i32, y: i32) -> Result<(), String> {
    pointer::drag(x, y)
}

#[tauri::command]
fn pointer_position() -> Result<(i32, i32), String> {
    pointer::position()
}

/// Shows, moves, or hides the agent's cursor overlay.
///
/// The overlay is the honesty mechanism for computer use: whenever the machine
/// is driving the pointer, there is an unmistakable marker on screen saying so.
#[tauri::command]
fn agent_cursor(app: AppHandle, x: Option<i32>, y: Option<i32>) -> Result<(), String> {
    let Some(win) = app.get_webview_window("cursor") else {
        return Ok(());
    };

    match (x, y) {
        (Some(x), Some(y)) => {
            win.set_position(tauri::PhysicalPosition::new(x - 20, y - 20))
                .map_err(|e| e.to_string())?;
            win.show().map_err(|e| e.to_string())?;
        }
        _ => win.hide().map_err(|e| e.to_string())?,
    }
    Ok(())
}

// --- filesystem, processes, opening ---------------------------------------
//
// First-party rather than plugin-backed. The plugins gate on a capability
// allowlist that denied every one of these at runtime; Conduit's own
// permission profile is the gate the user can see and change.

#[tauri::command]
async fn fs_read(path: String, limit: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || host::read_file(&path, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_write(path: String, contents: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || host::write_file(&path, &contents))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_list(path: String) -> Result<Vec<host::Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || host::list_dir(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_mkdir(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || host::make_dir(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_remove(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || host::remove_path(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    host::exists(&path)
}

/// Runs a command line. Blocking work goes to the pool so a slow build does
/// not freeze the interface that is showing its progress.
#[tauri::command]
async fn run_command(command: String, cwd: Option<String>) -> Result<host::Output, String> {
    tauri::async_runtime::spawn_blocking(move || host::run_command(&command, cwd.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_target(target: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || host::open_target(&target))
        .await
        .map_err(|e| e.to_string())?
}

// --- credentials --------------------------------------------------------------
//
// Deliberately one-way: the renderer can store a key and ask whether one is
// present, but cannot read it back. A webview bug, a rogue dependency, or a
// devtools session therefore cannot exfiltrate a key that is already saved.

#[tauri::command]
fn secret_set(account: String, secret: String) -> Result<(), String> {
    secrets::set(&account, &secret)
}

#[tauri::command]
fn secret_has(account: String) -> bool {
    secrets::has(&account)
}

#[tauri::command]
fn secret_delete(account: String) -> Result<(), String> {
    secrets::delete(&account)
}

#[tauri::command]
async fn proxy_send(request: proxy::ProxyRequest) -> Result<proxy::ProxyResponse, String> {
    proxy::send(request).await
}

#[tauri::command]
async fn proxy_stream(
    app: AppHandle,
    id: String,
    request: proxy::ProxyRequest,
) -> Result<(), String> {
    proxy::stream(app, id, request).await
}

#[tauri::command]
async fn proxy_transcribe(
    url: String,
    account: String,
    model: String,
    language: Option<String>,
    wav_base64: String,
) -> Result<proxy::ProxyResponse, String> {
    proxy::transcribe(url, account, model, language, wav_base64).await
}

/// Shows or hides the quick-capture window.
///
/// Focus is taken deliberately: unlike the HUD, this one is typed into, so it
/// has to become the active window — and give focus back when it closes, which
/// the platform does for us once it hides.
#[tauri::command]
fn toggle_quick(app: AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window("quick") else {
        return Ok(());
    };

    if win.is_visible().unwrap_or(false) {
        win.hide().map_err(|e| e.to_string())?;
    } else {
        let _ = win.center();
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        let _ = app.emit("conduit://quick-open", ());
    }
    Ok(())
}

#[tauri::command]
fn hide_quick(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quick") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resizes the quick window to fit its content, so results do not scroll
/// inside a fixed box the way a web page would.
#[tauri::command]
fn resize_quick(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quick") {
        win.set_size(tauri::LogicalSize::new(640.0, height.clamp(96.0, 560.0)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Shows or hides the cursor companion.
///
/// Called when the main window goes away, when it comes back, and whenever the
/// agent starts or stops doing something — the companion is the whole of
/// Conduit's presence while the window is not on screen, so it has to be
/// correct at those exact moments rather than on a timer.
#[tauri::command]
fn set_companion(app: AppHandle, visible: bool, state: State<'_, AppState>) -> Result<(), String> {
    let Some(win) = app.get_webview_window("companion") else {
        return Ok(());
    };

    if visible {
        if let Ok(size) = win.outer_size() {
            state.companion.resize(size.width as f64, size.height as f64);
        }
        // Position first, then show: showing first flashes the window at its
        // previous spot, which on first use is the corner of the screen.
        state.companion.place(&win);
        state.companion.start(app.clone());
        win.show().map_err(|e| e.to_string())?;
    } else {
        state.companion.stop();
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Shows or hides the desktop pet. Its position is its own business: the pet
/// window walks itself around and remembers where it was left.
#[tauri::command]
fn set_pet(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(win) = app.get_webview_window("pet") else {
        return Ok(());
    };
    if visible {
        win.show().map_err(|e| e.to_string())?;
        let _ = app.emit("conduit://pet-shown", ());
    } else {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resizes the companion's window to whatever its content currently needs.
///
/// The window has to be at least as big as the pet, the bead and any caption
/// combined, and no bigger — every extra pixel is a transparent rectangle
/// sitting over another application, and on some compositors that is not free.
#[tauri::command]
fn resize_companion(
    app: AppHandle,
    width: f64,
    height: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let w = width.clamp(120.0, 900.0);
    let h = height.clamp(80.0, 620.0);
    if let Some(win) = app.get_webview_window("companion") {
        let scale = win.scale_factor().unwrap_or(1.0);
        win.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        state.companion.resize(w * scale, h * scale);
    }
    Ok(())
}

// --- child processes, downloads, machine ------------------------------------

#[tauri::command]
fn proc_spawn(
    app: AppHandle,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    state.procs.spawn(app, &id, &program, &args, cwd.as_deref(), &env)
}

#[tauri::command]
fn proc_write(id: String, line: String, state: State<'_, AppState>) -> Result<(), String> {
    state.procs.write(&id, &line)
}

#[tauri::command]
fn proc_kill(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.procs.kill(&id)
}

#[tauri::command]
fn proc_running(id: String, state: State<'_, AppState>) -> bool {
    state.procs.is_running(&id)
}

#[tauri::command]
async fn download_file(
    app: AppHandle,
    id: String,
    url: String,
    dest: String,
    hf_token: Option<bool>,
) -> Result<String, String> {
    proc::download(app, id, url, dest, hf_token.unwrap_or(false)).await
}

#[tauri::command]
async fn agent_which(program: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || proc::which(&program)).await.ok().flatten()
}

#[tauri::command]
async fn agent_launch(
    program: String,
    args: Vec<String>,
    env: std::collections::HashMap<String, String>,
    cwd: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || proc::launch_agent(&program, &args, &env, cwd.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn unzip_file(archive: String, dest: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || proc::unzip(&archive, &dest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn find_file(root: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || proc::find_file(&root, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn file_sha256(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || proc::sha256(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn machine_info() -> proc::Machine {
    proc::machine()
}

#[tauri::command]
async fn gpu_info() -> Result<proc::Gpu, String> {
    tauri::async_runtime::spawn_blocking(proc::gpu).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn api_start(app: AppHandle, config: api::Config, state: State<'_, AppState>) -> Result<u16, String> {
    state.api.start(app, config)
}

#[tauri::command]
fn api_stop(state: State<'_, AppState>) {
    state.api.stop();
}

#[tauri::command]
fn api_port(state: State<'_, AppState>) -> Option<u16> {
    state.api.port()
}

#[tauri::command]
fn lan_addresses() -> Vec<String> {
    api::lan_addresses()
}

#[tauri::command]
fn download_cancel(id: String) {
    proc::cancel_download(&id);
}

/// Where extensions and downloaded models live, as an absolute path the web
/// layer can hand straight back to the filesystem commands.
#[tauri::command]
fn data_dir() -> Result<String, String> {
    host::data_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Re-binds the two capture hotkeys at runtime, so changing them in Settings
/// takes effect without a restart.
#[tauri::command]
fn set_hotkeys(app: AppHandle, dictate: String, command: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    register(&app, &dictate, Mode::Dictate)?;
    register(&app, &command, Mode::Command)?;
    // unregister_all drops *every* binding, including quick capture. Re-bind
    // it here or changing a capture key silently disables Ctrl+Alt+K.
    register_quick(&app)?;
    Ok(())
}

/// Binds Ctrl+Alt+K. Extracted so both startup and re-binding use one path.
fn register_quick(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(default_shortcut(Code::KeyK), move |_, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = toggle_quick(handle.clone());
            }
        })
        .map_err(|e| e.to_string())
}

fn register(app: &AppHandle, accelerator: &str, mode: Mode) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("'{accelerator}' is not a valid shortcut"))?;

    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            // Push-to-talk: capture runs for exactly as long as the key is held.
            let name = match event.state() {
                ShortcutState::Pressed => "conduit://capture-start",
                ShortcutState::Released => "conduit://capture-stop",
            };
            let payload = CaptureEvent { mode, focus: inject::focused() };
            let _ = handle.emit(name, payload);
        })
        .map_err(|e| e.to_string())
}

fn default_shortcut(code: Code) -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), code)
}

// --- setup ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // A real application remembers where you left its window. A webview
        // that reopens centred at a default size every launch is one of the
        // clearest tells that you are looking at a page, not a program.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            focused_app,
            paste_clipboard,
            type_text,
            press_keys,
            open_settings,
            set_hotkeys,
            capture_screen,
            pointer_move,
            pointer_click,
            pointer_scroll,
            pointer_drag,
            pointer_position,
            agent_cursor,
            set_companion,
            set_pet,
            resize_companion,
            proc_spawn,
            proc_write,
            proc_kill,
            proc_running,
            download_file,
            unzip_file,
            find_file,
            file_sha256,
            machine_info,
            gpu_info,
            download_cancel,
            api_start,
            api_stop,
            api_port,
            lan_addresses,
            data_dir,
            toggle_quick,
            hide_quick,
            resize_quick,
            secret_set,
            secret_has,
            secret_delete,
            fs_read,
            fs_write,
            fs_list,
            fs_mkdir,
            fs_remove,
            fs_exists,
            run_command,
            open_target,
            proxy_send,
            agent_which,
            agent_launch,
            proxy_stream,
            proxy_transcribe,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // The recorder needs a handle to stream microphone levels to the
            // HUD, so it is constructed here rather than in `manage` above.
            let meter_handle = handle.clone();
            app.manage(AppState {
                audio: Audio::spawn(move |level| {
                    let _ = meter_handle.emit("conduit://level", level);
                }),
                companion: companion::Companion::new(),
                procs: proc::Processes::new(),
                api: api::Api::new(),
            });

            // The companion must never intercept a click: it floats over other
            // applications, and swallowing a click there would be worse than
            // not existing.
            if let Some(c) = app.get_webview_window("companion") {
                let _ = c.set_ignore_cursor_events(true);
            }

            // The cursor overlay must never intercept a click, or it would
            // block the very UI the agent is trying to operate.
            if let Some(cursor) = app.get_webview_window("cursor") {
                let _ = cursor.set_ignore_cursor_events(true);
            }

            // The tray menu is the whole app for anyone who never opens the
            // window: ask something, change a setting, stop it. Shortcut hints
            // are included because a tray menu is where people go to *find*
            // them the first time.
            let open = MenuItem::with_id(app, "open", "Open Conduit", true, None::<&str>)?;
            let ask = MenuItem::with_id(app, "ask", "Quick ask	Ctrl+Alt+K", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Conduit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &ask, &settings, &sep, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Conduit — hold Ctrl+Alt+Space to speak")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "ask" => {
                        let _ = toggle_quick(app.clone());
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("conduit://open-settings", ());
                        }
                    }
                    "quit" => {
                        // Stop anything Conduit started — an MCP server or a local
                        // speech runtime outliving the app would keep a port and
                        // a chunk of memory with no window left to release them.
                        if let Some(state) = app.try_state::<AppState>() {
                            state.procs.kill_all();
                        }
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;

            // Defaults; Settings overrides them via set_hotkeys.
            let gs = handle.global_shortcut();
            let dictate = default_shortcut(Code::KeyD);
            let command = default_shortcut(Code::Space);

            if let Err(e) = register_quick(&handle) {
                log::error!("could not bind the quick-capture shortcut: {e}");
            }
            register(&handle, &dictate.to_string(), Mode::Dictate)
                .and_then(|_| register(&handle, &command.to_string(), Mode::Command))
                .unwrap_or_else(|e| log::error!("could not bind default hotkeys: {e}"));
            let _ = gs;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Quick capture is summoned, used, and gone. Losing focus means
            // the user's attention moved on, so the window should too.
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "quick" {
                    let _ = window.hide();
                }
            }

            // Closing the settings window must not kill the agent — it lives in
            // the tray. Only the tray's Quit actually exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("conduit://window-hidden", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Conduit");
}
