//! Agent TODO: a reminder list of plan steps agents left unfinished and things
//! they told the user to do. A background thread reads local chat files, so the
//! list and the pets' badges stay current while the toolbox window is hidden.
//! It never sends anything to the agents. See `src/tools/agent-todo/README.md`.

mod claude;
mod codex;
mod dsh;
mod instructions;
mod rules;
mod scanner;
mod session;
mod store;

use crate::platform::{
    pet_events::{AgentId, PetAction, PetBadge, PetEvent, PetHub},
    tray::MAIN_WINDOW,
};
use scanner::{Roots, ScanState};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use store::{Item, StoreData, AGENTS};
use tauri::{AppHandle, Emitter, Manager, State};

pub const TOOL_ID: &str = "agent-todo";
const CHANGED_EVENT: &str = "agent-todo-changed";
const SCAN_EVERY: Duration = Duration::from_secs(4);

pub struct AgentTodo {
    shared: Arc<Shared>,
}

struct Shared {
    items_path: PathBuf,
    scan_path: PathBuf,
    home: PathBuf,
    roots: Roots,
    data: Mutex<StoreData>,
    scan: Mutex<ScanState>,
    status: Mutex<Status>,
    wake: (Mutex<bool>, Condvar),
    published: Mutex<Option<[u32; 3]>>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    last_scan_at: Option<i64>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    items: Vec<Item>,
    history: Vec<Item>,
    enabled_at: Option<i64>,
    paused: bool,
    last_scan_at: Option<i64>,
    error: Option<String>,
    sources: Vec<Source>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    agent: AgentId,
    folder: String,
    found: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    agent: AgentId,
    #[serde(flatten)]
    status: instructions::RuleStatus,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Each agent's own folder; the same environment variables the agents read can move it.
fn agent_home(agent: AgentId, home: &Path) -> PathBuf {
    let (variable, folder) = match agent {
        AgentId::Claude => ("CLAUDE_CONFIG_DIR", ".claude"),
        AgentId::Codex => ("CODEX_HOME", ".codex"),
        AgentId::Deepseek => ("DSH_HOME", ".dsh"),
    };
    std::env::var_os(variable).filter(|value| !value.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(folder))
}

/// The global instruction file each agent reads at the start of every chat.
fn rule_file(agent: AgentId, home: &Path) -> PathBuf {
    agent_home(agent, home).join(if agent == AgentId::Claude { "CLAUDE.md" } else { "AGENTS.md" })
}

fn roots(home: &Path) -> Roots {
    let codex = agent_home(AgentId::Codex, home);
    Roots {
        claude: agent_home(AgentId::Claude, home).join("projects"),
        codex: codex.join("sessions"),
        codex_index: codex.join("session_index.jsonl"),
        dsh: agent_home(AgentId::Deepseek, home).join("sessions"),
    }
}

/// The badge events that bring the pets up to date: every agent the first time,
/// then only agents whose open-item count changed.
fn badge_events(previous: Option<[u32; 3]>, counts: [u32; 3]) -> Vec<PetEvent> {
    AGENTS.iter().zip(counts).enumerate()
        .filter(|(index, (_, count))| previous.is_none_or(|previous| previous[*index] != *count))
        .map(|(_, (agent, count))| PetEvent {
            source: TOOL_ID.into(),
            agent: Some(*agent),
            session_id: None,
            status: None,
            emote: None,
            note: None,
            badge: Some((count > 0).then(|| PetBadge {
                count: count.min(9999),
                action: Some(PetAction::OpenTool { tool_id: TOOL_ID.into() }),
            })),
        })
        .collect()
}

/// Starts the tool's background scanner. Called once from the app's setup.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let folder = app.path().app_data_dir().map_err(|error| error.to_string())?.join("tools").join(TOOL_ID);
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let items_path = folder.join("items.json");
    let scan_path = folder.join("scan-state.json");
    let mut data: StoreData = store::read_json(&items_path);
    if data.enabled_at.is_none() {
        // First start: only chats active from now on are read.
        data.enabled_at = Some(now());
        store::write_json(&items_path, &data).map_err(|error| error.to_string())?;
    }
    let shared = Arc::new(Shared {
        roots: roots(&home),
        home,
        scan: Mutex::new(store::read_json(&scan_path)),
        data: Mutex::new(data),
        items_path,
        scan_path,
        status: Mutex::default(),
        wake: (Mutex::new(false), Condvar::new()),
        published: Mutex::new(None),
    });
    shared.publish_badges(app);
    app.manage(AgentTodo { shared: shared.clone() });
    let app = app.clone();
    std::thread::Builder::new().name("agent-todo-scanner".into()).spawn(move || loop {
        if !lock(&shared.data).paused {
            shared.scan_once(&app);
        }
        let (woken, signal) = &shared.wake;
        let mut woken = signal.wait_timeout_while(lock(woken), SCAN_EVERY, |woken| !*woken).unwrap_or_else(PoisonError::into_inner).0;
        *woken = false;
    }).map_err(|error| error.to_string())?;
    Ok(())
}

impl Shared {
    fn scan_once(&self, app: &AppHandle) {
        let enabled_at = lock(&self.data).enabled_at.unwrap_or_else(now);
        let outcome = {
            let mut scan = lock(&self.scan);
            let outcome = scanner::scan(&self.roots, &mut scan, enabled_at);
            if outcome.state_changed {
                if let Err(error) = store::write_json(&self.scan_path, &*scan) {
                    eprintln!("agent-todo: could not save scan progress: {error}");
                }
            }
            outcome
        };
        let changed = {
            let mut data = lock(&self.data);
            let added = data.add(outcome.found);
            let mut retitled = false;
            for (agent, session_id, title) in &outcome.titles {
                retitled |= data.retitle(*agent, session_id, title);
            }
            added > 0 || retitled
        };
        let error = outcome.errors.first().cloned();
        let error_changed = {
            let mut status = lock(&self.status);
            status.last_scan_at = Some(now());
            std::mem::replace(&mut status.error, error.clone()) != error
        };
        if changed {
            self.save_and_announce(app);
        } else if error_changed {
            let _ = app.emit_to(MAIN_WINDOW, CHANGED_EVENT, ());
        }
    }

    fn save_and_announce(&self, app: &AppHandle) {
        if let Err(error) = store::write_json(&self.items_path, &*lock(&self.data)) {
            eprintln!("agent-todo: could not save items: {error}");
            lock(&self.status).error = Some(format!("Could not save items: {error}"));
        }
        self.publish_badges(app);
        let _ = app.emit_to(MAIN_WINDOW, CHANGED_EVENT, ());
    }

    /// Reports open-item counts through the core pet event API. Whether a pet is
    /// listening is the core's business, not this tool's.
    fn publish_badges(&self, app: &AppHandle) {
        let counts = lock(&self.data).counts();
        let mut published = lock(&self.published);
        let Some(hub) = app.try_state::<PetHub>() else { return };
        for event in badge_events(*published, counts) {
            if let Err(error) = hub.publish(app, event) {
                eprintln!("agent-todo: the pet badge was not delivered: {error}");
            }
        }
        *published = Some(counts);
    }

    fn snapshot(&self) -> Snapshot {
        let data = lock(&self.data);
        let status = lock(&self.status).clone();
        let source = |agent: AgentId, folder: &Path| Source { agent, folder: folder.display().to_string(), found: folder.is_dir() };
        Snapshot {
            items: data.items.clone(),
            history: data.history.clone(),
            enabled_at: data.enabled_at,
            paused: data.paused,
            last_scan_at: status.last_scan_at,
            error: status.error,
            sources: vec![
                source(AgentId::Claude, &self.roots.claude),
                source(AgentId::Codex, &self.roots.codex),
                source(AgentId::Deepseek, &self.roots.dsh),
            ],
        }
    }

    fn update(&self, app: &AppHandle, change: impl FnOnce(&mut StoreData) -> bool) -> Snapshot {
        if change(&mut lock(&self.data)) {
            self.save_and_announce(app);
        }
        self.snapshot()
    }

    fn rules(&self) -> Vec<Rule> {
        AGENTS.iter().map(|agent| Rule { agent: *agent, status: instructions::status(&rule_file(*agent, &self.home)) }).collect()
    }
}

#[tauri::command]
pub fn agent_todo_state(todo: State<'_, AgentTodo>) -> Snapshot {
    todo.shared.snapshot()
}

#[tauri::command]
pub fn agent_todo_remove(app: AppHandle, todo: State<'_, AgentTodo>, ids: Vec<String>) -> Snapshot {
    todo.shared.update(&app, |data| data.remove(&ids, now()))
}

#[tauri::command]
pub fn agent_todo_restore(app: AppHandle, todo: State<'_, AgentTodo>, ids: Vec<String>) -> Snapshot {
    todo.shared.update(&app, |data| data.restore(&ids))
}

#[tauri::command]
pub fn agent_todo_clear_history(app: AppHandle, todo: State<'_, AgentTodo>) -> Snapshot {
    todo.shared.update(&app, StoreData::clear_history)
}

#[tauri::command]
pub fn agent_todo_set_paused(app: AppHandle, todo: State<'_, AgentTodo>, paused: bool) -> Snapshot {
    let snapshot = todo.shared.update(&app, |data| std::mem::replace(&mut data.paused, paused) != paused);
    if !paused {
        let (woken, signal) = &todo.shared.wake;
        *lock(woken) = true;
        signal.notify_one();
    }
    snapshot
}

/// Scans right away, even while paused, and returns the result.
#[tauri::command]
pub async fn agent_todo_scan_now(app: AppHandle, todo: State<'_, AgentTodo>) -> Result<Snapshot, String> {
    let shared = todo.shared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        shared.scan_once(&app);
        shared.snapshot()
    }).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_todo_rules(todo: State<'_, AgentTodo>) -> Vec<Rule> {
    todo.shared.rules()
}

/// Adds the `TODO(user): ...` instruction line to one agent's global instructions.
#[tauri::command]
pub fn agent_todo_add_rule(todo: State<'_, AgentTodo>, agent: AgentId) -> Result<Vec<Rule>, String> {
    instructions::add(&rule_file(agent, &todo.shared.home))?;
    Ok(todo.shared.rules())
}

#[tauri::command]
pub fn agent_todo_remove_rule(todo: State<'_, AgentTodo>, agent: AgentId) -> Result<Vec<Rule>, String> {
    instructions::remove(&rule_file(agent, &todo.shared.home))?;
    Ok(todo.shared.rules())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(events: &[PetEvent]) -> Vec<(Option<AgentId>, Option<u32>)> {
        events.iter().map(|event| (event.agent, event.badge.clone().flatten().map(|badge| badge.count))).collect()
    }

    #[test]
    fn announces_every_agent_once_then_only_changes() {
        let start = badge_events(None, [2, 0, 0]);
        assert_eq!(summary(&start), [(Some(AgentId::Claude), Some(2)), (Some(AgentId::Codex), None), (Some(AgentId::Deepseek), None)]);
        assert_eq!(start[1].badge, Some(None), "a zero count clears the badge");
        for event in &start {
            event.validate().unwrap();
            assert_eq!(event.source, "agent-todo");
        }
        assert_eq!(start[0].badge.clone().flatten().unwrap().action, Some(PetAction::OpenTool { tool_id: "agent-todo".into() }));
        assert!(badge_events(Some([2, 0, 0]), [2, 0, 0]).is_empty());
        assert_eq!(summary(&badge_events(Some([2, 0, 0]), [1, 0, 3])), [(Some(AgentId::Claude), Some(1)), (Some(AgentId::Deepseek), Some(3))]);
        assert_eq!(badge_events(None, [20_000, 0, 0])[0].badge.clone().flatten().unwrap().count, 9999);
    }

    #[test]
    fn finds_each_agents_files_under_the_home_folder() {
        let home = Path::new("C:\\Users\\someone");
        if std::env::var_os("CODEX_HOME").is_none() {
            assert_eq!(roots(home).codex_index, home.join(".codex").join("session_index.jsonl"));
            assert_eq!(rule_file(AgentId::Codex, home), home.join(".codex").join("AGENTS.md"));
        }
        if std::env::var_os("CLAUDE_CONFIG_DIR").is_none() {
            assert_eq!(rule_file(AgentId::Claude, home), home.join(".claude").join("CLAUDE.md"));
        }
        if std::env::var_os("DSH_HOME").is_none() {
            assert_eq!(rule_file(AgentId::Deepseek, home), home.join(".dsh").join("AGENTS.md"));
            assert_eq!(roots(home).dsh, home.join(".dsh").join("sessions"));
        }
    }
}
