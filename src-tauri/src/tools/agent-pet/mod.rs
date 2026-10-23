//! Native side of the agent desktop pet tool: the click-through pet window,
//! the agent hook installer and its `--pet-hook` adapter, the DSH session
//! watcher, the usage-limit watcher and its `--pet-status-line` wrapper, and
//! the idle moves the user adds. The pets themselves only follow the pet event API.

pub mod dsh_watch;
pub mod hook_cli;
pub mod hooks;
pub mod idle_moves;
pub mod limits;
pub mod window;

use tauri::AppHandle;

/// Called from the app's `setup`: opens the pet window and starts the DSH and limit watchers.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    window::create(app)?;
    dsh_watch::start(app);
    limits::start(app);
    Ok(())
}
