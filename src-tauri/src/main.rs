// Prevents a console window from flashing up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    conduit_lib::run()
}
