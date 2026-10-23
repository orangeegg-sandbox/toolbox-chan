//! Installs, shows, and removes the agent hooks that report to the pets. Each
//! hook runs this executable's `--pet-hook` adapter (see `hook_cli.rs`). Files
//! are backed up once before the first edit, edited without touching other
//! hooks, and written atomically. DSH has no hooks, so its "hook" is the
//! session folder watcher in `dsh_watch.rs`.

pub mod claude;
pub mod codex;
mod files;
pub mod status_line;

use super::dsh_watch::{self, DshWatcher};
use crate::platform::pet_events::AgentId;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const HOOK_TIMEOUT_SECONDS: u64 = 5;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventState {
    /// The agent's hook event, such as `Stop`.
    pub name: String,
    /// The pet status the hook reports.
    pub status: String,
    pub installed: bool,
    /// Installed and pointing at this copy of Toolbox-Chan.
    pub current: bool,
    /// Codex only: whether Codex has a review record for this hook.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewed: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHooks {
    pub agent: AgentId,
    /// `hooks` edits the agent's config file; `watcher` watches its session folder.
    pub method: &'static str,
    pub path: String,
    /// `installed`, `outdated` (points at another copy), `partial`, `missing`, or `error`.
    pub state: &'static str,
    pub events: Vec<EventState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksReport {
    /// The executable the hooks run.
    pub executable: String,
    /// A development build; hooks installed from it point at the build folder.
    pub development: bool,
    pub agents: Vec<AgentHooks>,
}

/// Where each agent keeps its settings, relative to a home folder (a temporary one in tests).
pub struct Locations {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub dsh_sessions: PathBuf,
}

impl Locations {
    pub fn in_home(home: &Path) -> Self {
        Self {
            claude: home.join(".claude").join("settings.json"),
            codex: home.join(".codex").join("config.toml"),
            dsh_sessions: dsh_watch::sessions_dir(home),
        }
    }
}

fn summary(events: &[EventState]) -> &'static str {
    if events.iter().all(|event| event.installed && event.current) {
        "installed"
    } else if events.iter().all(|event| event.installed) {
        "outdated"
    } else if events.iter().any(|event| event.installed) {
        "partial"
    } else {
        "missing"
    }
}

fn hooks_entry(agent: AgentId, path: &Path, result: Result<Vec<EventState>, String>) -> AgentHooks {
    let backup = files::backup_path(path);
    let (state, events, error) = match result {
        Ok(events) => (summary(&events), events, None),
        Err(error) => ("error", Vec::new(), Some(error)),
    };
    AgentHooks {
        agent,
        method: "hooks",
        path: path.display().to_string(),
        state,
        events,
        backup: backup.exists().then(|| backup.display().to_string()),
        error,
    }
}

fn claude_status(path: &Path, executable: &str) -> Result<Vec<EventState>, String> {
    let text = files::read(path)?;
    Ok(claude::status(&claude::parse(text.as_deref())?, executable))
}

fn codex_status(path: &Path, executable: &str) -> Result<Vec<EventState>, String> {
    let text = files::read(path)?;
    Ok(codex::status(&codex::parse(text.as_deref())?, executable, &path.display().to_string()))
}

pub fn report(locations: &Locations, executable: &str, development: bool, watching: bool) -> HooksReport {
    HooksReport {
        executable: executable.into(),
        development,
        agents: vec![
            hooks_entry(AgentId::Claude, &locations.claude, claude_status(&locations.claude, executable)),
            hooks_entry(AgentId::Codex, &locations.codex, codex_status(&locations.codex, executable)),
            AgentHooks {
                agent: AgentId::Deepseek,
                method: "watcher",
                path: locations.dsh_sessions.display().to_string(),
                state: if watching { "installed" } else { "missing" },
                events: Vec::new(),
                backup: None,
                error: None,
            },
        ],
    }
}

pub fn install_claude(path: &Path, executable: &str) -> Result<(), String> {
    let original = files::read(path)?;
    let mut settings = claude::parse(original.as_deref())?;
    let before = settings.clone();
    claude::install(&mut settings, executable)?;
    if settings != before {
        files::back_up_once(path)?;
        files::write_atomically(path, &claude::render(&settings, original.as_deref())?)?;
    }
    Ok(())
}

pub fn remove_claude(path: &Path) -> Result<(), String> {
    let Some(original) = files::read(path)? else { return Ok(()) };
    let mut settings = claude::parse(Some(&original))?;
    let before = settings.clone();
    claude::remove(&mut settings)?;
    if settings != before {
        files::back_up_once(path)?;
        files::write_atomically(path, &claude::render(&settings, Some(&original))?)?;
    }
    Ok(())
}

pub fn install_codex(path: &Path, executable: &str) -> Result<(), String> {
    let original = files::read(path)?.unwrap_or_default();
    if let Some(updated) = codex::install(&original, executable)? {
        files::back_up_once(path)?;
        files::write_atomically(path, &updated)?;
    }
    Ok(())
}

pub fn remove_codex(path: &Path) -> Result<(), String> {
    let Some(original) = files::read(path)? else { return Ok(()) };
    if let Some(updated) = codex::remove(&original)? {
        files::back_up_once(path)?;
        files::write_atomically(path, &updated)?;
    }
    Ok(())
}

/// The path hooks call. Forward slashes work in every shell the agents use on Windows.
pub fn executable() -> Result<String, String> {
    let path = std::env::current_exe().map_err(|error| format!("Could not find the Toolbox-Chan executable: {error}"))?;
    let text = path.display().to_string();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned();
    Ok(if cfg!(windows) { text.replace('\\', "/") } else { text })
}

fn current(app: &AppHandle) -> Result<HooksReport, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let watching = app.state::<DshWatcher>().enabled();
    Ok(report(&Locations::in_home(&home), &executable()?, cfg!(debug_assertions), watching))
}

fn change(app: &AppHandle, agent: AgentId, install: bool) -> Result<HooksReport, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let locations = Locations::in_home(&home);
    let executable = executable()?;
    match (agent, install) {
        (AgentId::Claude, true) => install_claude(&locations.claude, &executable)?,
        (AgentId::Claude, false) => remove_claude(&locations.claude)?,
        (AgentId::Codex, true) => install_codex(&locations.codex, &executable)?,
        (AgentId::Codex, false) => remove_codex(&locations.codex)?,
        (AgentId::Deepseek, on) => app.state::<DshWatcher>().set_enabled(app, on)?,
    }
    current(app)
}

#[tauri::command]
pub async fn agent_pet_hooks(app: AppHandle) -> Result<HooksReport, String> {
    current(&app)
}

#[tauri::command]
pub async fn agent_pet_install_hooks(app: AppHandle, agent: AgentId) -> Result<HooksReport, String> {
    change(&app, agent, true)
}

#[tauri::command]
pub async fn agent_pet_remove_hooks(app: AppHandle, agent: AgentId) -> Result<HooksReport, String> {
    change(&app, agent, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const EXE: &str = "C:/Apps/Toolbox-Chan/little-toolbox.exe";

    /// A throwaway home folder: these tests never touch the real agent settings.
    fn home(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("toolbox-chan-hooks-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join(".claude")).unwrap();
        fs::create_dir_all(directory.join(".codex")).unwrap();
        directory
    }

    const CLAUDE: &str = "{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"PreToolUse\": [\n      {\n        \"matcher\": \"Grep\",\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"cbm.exe\",\n            \"args\": [\n              \"hook-augment\"\n            ]\n          }\n        ]\n      }\n    ]\n  },\n  \"editorMode\": \"vim\"\n}\n";
    const CODEX: &str = "notify = [ \"computer-use.exe\", \"turn-ended\" ]\n\n[[hooks.SessionStart]]\nmatcher = \"startup\"\n\n[[hooks.SessionStart.hooks]]\ntype = \"command\"\ncommand = \"cbm hook-augment\"\n";

    #[test]
    fn installs_and_removes_against_copies_with_one_backup() {
        let home = home("round-trip");
        let locations = Locations::in_home(&home);
        fs::write(&locations.claude, CLAUDE).unwrap();
        fs::write(&locations.codex, CODEX).unwrap();

        let before = report(&locations, EXE, false, false);
        assert_eq!(before.agents.iter().map(|agent| agent.state).collect::<Vec<_>>(), ["missing", "missing", "missing"]);
        assert!(before.agents.iter().all(|agent| agent.backup.is_none()));

        install_claude(&locations.claude, EXE).unwrap();
        install_codex(&locations.codex, EXE).unwrap();
        let installed = report(&locations, EXE, false, true);
        assert_eq!(installed.agents.iter().map(|agent| agent.state).collect::<Vec<_>>(), ["installed", "installed", "installed"]);
        assert_eq!(fs::read_to_string(files::backup_path(&locations.claude)).unwrap(), CLAUDE);
        assert_eq!(fs::read_to_string(files::backup_path(&locations.codex)).unwrap(), CODEX);
        assert!(fs::read_to_string(&locations.codex).unwrap().starts_with(CODEX));

        // A later edit keeps the first backup.
        install_claude(&locations.claude, "D:/Other/little-toolbox.exe").unwrap();
        assert_eq!(report(&locations, EXE, false, true).agents[0].state, "outdated");
        assert_eq!(fs::read_to_string(files::backup_path(&locations.claude)).unwrap(), CLAUDE);

        remove_claude(&locations.claude).unwrap();
        remove_codex(&locations.codex).unwrap();
        assert_eq!(fs::read_to_string(&locations.claude).unwrap(), CLAUDE);
        assert_eq!(fs::read_to_string(&locations.codex).unwrap(), CODEX);
        let leftovers: Vec<_> = fs::read_dir(home.join(".claude")).unwrap().flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files were left behind: {leftovers:?}");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn creates_missing_files_and_leaves_broken_ones_alone() {
        let home = home("missing-and-broken");
        let locations = Locations::in_home(&home);
        install_claude(&locations.claude, EXE).unwrap();
        install_codex(&locations.codex, EXE).unwrap();
        assert!(!files::backup_path(&locations.claude).exists(), "there was nothing to back up");
        assert_eq!(report(&locations, EXE, false, false).agents[0].state, "installed");

        let broken = "{ \"hooks\": { \"Stop\": [ }";
        fs::write(&locations.claude, broken).unwrap();
        assert!(install_claude(&locations.claude, EXE).is_err());
        assert_eq!(fs::read_to_string(&locations.claude).unwrap(), broken);
        let entry = &report(&locations, EXE, false, false).agents[0];
        assert_eq!(entry.state, "error");
        assert!(entry.error.as_deref().unwrap().contains("not valid JSON"));
        // Removing from files that do not exist is not an error.
        let empty = Locations::in_home(&home.join("nobody"));
        assert!(remove_claude(&empty.claude).is_ok() && remove_codex(&empty.codex).is_ok());
        assert!(!empty.claude.exists());
        let _ = fs::remove_dir_all(home);
    }
}
