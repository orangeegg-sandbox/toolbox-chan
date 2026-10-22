//! Native side of the agent desktop pet tool: the click-through pet window,
//! the agent hook installer and its `--pet-hook` adapter, and the DSH session
//! watcher. The pets themselves only follow the pet event API.

pub mod dsh_watch;
pub mod hook_cli;
pub mod hooks;
pub mod window;

use tauri::AppHandle;

/// Called from the app's `setup`: opens the pet window and starts the DSH watcher.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    window::create(app)?;
    dsh_watch::start(app);
    Ok(())
}
