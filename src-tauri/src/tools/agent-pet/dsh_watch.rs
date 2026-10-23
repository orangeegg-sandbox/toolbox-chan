//! DeepSeek Harness has no hooks that Toolbox-Chan can use, so the pet tool
//! watches `~/.dsh/sessions/<project>/session-<id>/` instead. A session file
//! that changes means DSH is working in that chat; a session that has been
//! quiet for a while after working counts as done. This is a guess from file
//! times only: a long tool run without writes can look finished.

use crate::platform::pet_events::{AgentId, PetEvent, PetHub, PetStatus};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "agent-pet.json";
const SCAN_EVERY: Duration = Duration::from_secs(2);
/// How long a working session must stay unchanged before it counts as done.
pub const QUIET: Duration = Duration::from_secs(45);

pub fn sessions_dir(home: &Path) -> PathBuf {
    home.join(".dsh").join("sessions")
}

#[derive(Default)]
pub struct DshWatcher {
    enabled: AtomicBool,
}

impl DshWatcher {
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_enabled(&self, app: &AppHandle, enabled: bool) -> Result<(), String> {
        let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        fs::write(directory.join(SETTINGS_FILE), json!({ "dshWatcher": enabled }).to_string())
            .map_err(|error| format!("Could not save the DSH watcher setting: {error}"))?;
        self.enabled.store(enabled, Ordering::Relaxed);
        Ok(())
    }
}

/// Reads the saved choice and starts the watcher thread.
pub fn start(app: &AppHandle) {
    let saved = app.path().app_config_dir().ok()
        .and_then(|directory| fs::read(directory.join(SETTINGS_FILE)).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|settings| settings["dshWatcher"].as_bool())
        .unwrap_or(false);
    app.state::<DshWatcher>().enabled.store(saved, Ordering::Relaxed);
    let handle = app.clone();
    let _ = thread::Builder::new().name("agent-pet-dsh".into()).spawn(move || watch(handle));
}

fn watch(app: AppHandle) {
    let Ok(home) = app.path().home_dir() else { return };
    let root = sessions_dir(&home);
    let mut tracker: Option<Tracker> = None;
    loop {
        thread::sleep(SCAN_EVERY);
        if !app.state::<DshWatcher>().enabled() {
            // Start fresh when it is turned on again, so old changes are not reported.
            tracker = None;
            continue;
        }
        let sessions = scan(&root);
        let tracker = tracker.get_or_insert_with(Tracker::default);
        for change in tracker.observe(Instant::now(), sessions) {
            let event = PetEvent {
                source: "hook".into(),
                agent: Some(AgentId::Deepseek),
                session_id: Some(change.session),
                status: Some(change.status),
                emote: None,
                note: Some(change.project).filter(|project| !project.is_empty()),
                badge: None,
            };
            let _ = app.state::<PetHub>().publish(&app, event);
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: String,
    pub project: String,
    pub modified: SystemTime,
}

#[derive(Debug, PartialEq)]
pub struct Change {
    pub session: String,
    pub project: String,
    pub status: PetStatus,
}

struct Tracked {
    modified: SystemTime,
    working_since_change: Option<Instant>,
}

/// Turns repeated scans into working and done changes. The first scan only records what exists.
#[derive(Default)]
pub struct Tracker {
    primed: bool,
    sessions: HashMap<String, Tracked>,
}

impl Tracker {
    pub fn observe(&mut self, now: Instant, scan: Vec<Session>) -> Vec<Change> {
        let mut changes = Vec::new();
        let mut next = HashMap::new();
        for session in scan {
            let (mut tracked, changed) = match self.sessions.remove(&session.id) {
                Some(tracked) => {
                    let changed = session.modified > tracked.modified;
                    (tracked, changed)
                }
                // A session folder that appears after the first scan is a new chat.
                None => (Tracked { modified: session.modified, working_since_change: None }, self.primed),
            };
            if changed {
                if tracked.working_since_change.is_none() {
                    changes.push(Change { session: session.id.clone(), project: session.project.clone(), status: PetStatus::Working });
                }
                tracked.working_since_change = Some(now);
            } else if tracked.working_since_change.is_some_and(|since| now.duration_since(since) >= QUIET) {
                changes.push(Change { session: session.id.clone(), project: session.project.clone(), status: PetStatus::Done });
                tracked.working_since_change = None;
            }
            tracked.modified = tracked.modified.max(session.modified);
            next.insert(session.id, tracked);
        }
        self.sessions = next;
        self.primed = true;
        changes
    }
}

/// Lists every `session-<id>` folder with the newest change time of the files in it.
fn scan(root: &Path) -> Vec<Session> {
    let mut sessions = Vec::new();
    let Ok(projects) = fs::read_dir(root) else { return sessions };
    for project in projects.flatten() {
        let project_path = project.path();
        if !project_path.is_dir() {
            continue;
        }
        let name = project_name(&project.file_name().to_string_lossy(), |path| path.is_dir());
        let Ok(entries) = fs::read_dir(&project_path) else { continue };
        for entry in entries.flatten() {
            let folder = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = folder.strip_prefix("session-").filter(|id| !id.is_empty()) else { continue };
            let modified = fs::read_dir(entry.path()).into_iter().flatten().flatten()
                .filter_map(|file| file.metadata().ok().filter(|metadata| metadata.is_file())?.modified().ok())
                .max();
            if let Some(modified) = modified {
                sessions.push(Session { id: id.to_owned(), project: name.clone(), modified });
            }
        }
    }
    sessions
}

/// DSH names project folders after their path with separators replaced, such as
/// `--D-Personal-agents-studio--`. Dashes are ambiguous, so the real folder is
/// looked up one level at a time, preferring the longest name that exists.
pub fn project_name(folder: &str, exists: impl Fn(&Path) -> bool) -> String {
    let trimmed = folder.trim_matches('-');
    let parts: Vec<&str> = trimmed.split('-').filter(|part| !part.is_empty()).collect();
    let fallback = parts.last().copied().unwrap_or(trimmed).to_owned();
    let Some(first) = parts.first() else { return fallback };
    let (mut current, mut index) = if first.len() == 1 && first.chars().all(|letter| letter.is_ascii_alphabetic()) {
        (PathBuf::from(format!("{first}:\\")), 1)
    } else {
        (PathBuf::from("/"), 0)
    };
    let mut name = None;
    while index < parts.len() {
        let next = (index + 1..=parts.len()).rev().find(|end| exists(&current.join(parts[index..*end].join("-"))));
        let Some(end) = next else {
            // The rest no longer exists on disk; keep its last word.
            return name.map(|_| parts[index..].join("-")).unwrap_or(fallback);
        };
        current = current.join(parts[index..end].join("-"));
        name = Some(parts[index..end].join("-"));
        index = end;
    }
    name.unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seconds: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000 + seconds)
    }

    fn session(id: &str, modified: SystemTime) -> Session {
        Session { id: id.into(), project: "playground".into(), modified }
    }

    #[test]
    fn reports_working_on_change_and_done_after_a_quiet_period() {
        let start = Instant::now();
        let mut tracker = Tracker::default();
        assert_eq!(tracker.observe(start, vec![session("a", at(0)), session("b", at(0))]), vec![], "the first scan only records");
        assert_eq!(tracker.observe(start + Duration::from_secs(2), vec![session("a", at(0)), session("b", at(0))]), vec![]);

        let changes = tracker.observe(start + Duration::from_secs(4), vec![session("a", at(4)), session("b", at(0))]);
        assert_eq!(changes, vec![Change { session: "a".into(), project: "playground".into(), status: PetStatus::Working }]);
        // More writes while working report nothing new.
        assert_eq!(tracker.observe(start + Duration::from_secs(20), vec![session("a", at(20)), session("b", at(0))]), vec![]);
        assert_eq!(tracker.observe(start + Duration::from_secs(60), vec![session("a", at(20)), session("b", at(0))]), vec![]);
        let changes = tracker.observe(start + Duration::from_secs(66), vec![session("a", at(20)), session("b", at(0))]);
        assert_eq!(changes, vec![Change { session: "a".into(), project: "playground".into(), status: PetStatus::Done }]);
        assert_eq!(tracker.observe(start + Duration::from_secs(200), vec![session("a", at(20)), session("b", at(0))]), vec![]);
    }

    #[test]
    fn treats_a_session_folder_created_later_as_a_new_chat() {
        let start = Instant::now();
        let mut tracker = Tracker::default();
        tracker.observe(start, vec![session("a", at(0))]);
        let changes = tracker.observe(start + Duration::from_secs(2), vec![session("a", at(0)), session("new", at(2))]);
        assert_eq!(changes, vec![Change { session: "new".into(), project: "playground".into(), status: PetStatus::Working }]);
    }

    #[cfg(windows)]
    #[test]
    fn decodes_project_folders_against_the_disk() {
        let existing = ["D:\\Personal", "D:\\Personal\\agents-studio", "D:\\Personal\\playground", "C:\\Users", "C:\\Users\\PC"];
        let exists = |path: &Path| existing.iter().any(|known| Path::new(known) == path);
        assert_eq!(project_name("--D-Personal-agents-studio--", exists), "agents-studio");
        assert_eq!(project_name("--D-Personal-playground--", exists), "playground");
        assert_eq!(project_name("--C-Users-PC--", exists), "PC");
        // A folder that was moved or deleted keeps the tail of its name.
        assert_eq!(project_name("--D-Personal-gone-project--", exists), "gone-project");
        assert_eq!(project_name("--E-unknown--", exists), "unknown");
        assert_eq!(project_name("----", exists), "");
    }
}
