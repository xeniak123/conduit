//! API keys, in the operating system's credential store.
//!
//! Keys were previously written to a JSON file next to the settings, in plain
//! text, readable by any process running as the user and by anything that ever
//! syncs that folder. That is fine for a personal build and unacceptable for
//! software other people install.
//!
//! Here they go to the Windows Credential Manager, the macOS Keychain, or the
//! Secret Service on Linux — the same places every professional client stores
//! them. The renderer never receives a key back: it can write one and ask
//! whether one exists, and the provider layer fetches it at call time.

use keyring::Entry;

const SERVICE: &str = "dev.conduit.app";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn set(account: &str, secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return delete(account);
    }
    entry(account)?
        .set_password(secret)
        .map_err(|e| format!("could not save credential: {e}"))
}

pub fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("could not read credential: {e}")),
    }
}

pub fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting something that was never stored is a success, not an error.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not remove credential: {e}")),
    }
}

pub fn has(account: &str) -> bool {
    matches!(get(account), Ok(Some(_)))
}
