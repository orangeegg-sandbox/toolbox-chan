//! Open items, History, and the tool's settings, saved as one JSON file in the
//! tool's own app-data folder. Items stay until the user removes them; removed
//! items move to History and can be restored.

use crate::platform::pet_events::AgentId;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io, path::{Path, PathBuf}};

pub const AGENTS: [AgentId; 3] = [AgentId::Claude, AgentId::Codex, AgentId::Deepseek];
const MAX_TEXT: usize = 500;
const MAX_TITLE: usize = 200;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ItemKind {
    /// A plan step still unfinished when the agent's turn ended.
    Step,
    /// Something the agent told the user to do.
    ForYou,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// Stable for one agent, session, and text, so the same text is stored once.
    pub id: String,
    pub agent: AgentId,
    /// The chat's working folder; empty when unknown.
    pub project: String,
    pub chat_title: String,
    pub text: String,
    pub kind: ItemKind,
    pub found_at: i64,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<i64>,
}

/// What a scan found in one chat; the store turns it into an item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub agent: AgentId,
    pub session_id: String,
    pub project: String,
    pub chat_title: String,
    pub text: String,
    pub kind: ItemKind,
    pub found_at: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct StoreData {
    /// When the tool was first turned on; older chat activity is ignored.
    pub enabled_at: Option<i64>,
    pub paused: bool,
    pub items: Vec<Item>,
    /// Newest removal first.
    pub history: Vec<Item>,
    /// Ids cleared from History, so a cleared item never comes back.
    pub cleared: Vec<String>,
}

pub fn item_id(agent: AgentId, session_id: &str, text: &str) -> String {
    // FNV-1a: stable across builds, unlike the standard library's hasher.
    let key = format!("{}\u{0}{session_id}\u{0}{}", agent_key(agent), normalize(text));
    let hash = key.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3));
    format!("{hash:016x}")
}

pub fn agent_key(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "claude",
        AgentId::Codex => "codex",
        AgentId::Deepseek => "deepseek",
    }
}

fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn clip(text: &str, max: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        return text;
    }
    let mut clipped: String = text.chars().take(max - 1).collect();
    clipped.push('…');
    clipped
}

impl StoreData {
    /// Adds new items and returns how many were added. Text already stored for a
    /// session, removed to History, or cleared from History is skipped.
    pub fn add(&mut self, found: impl IntoIterator<Item = Found>) -> usize {
        let mut known: HashSet<String> = self.items.iter().chain(&self.history).map(|item| item.id.clone()).collect();
        known.extend(self.cleared.iter().cloned());
        let mut added = 0;
        for found in found {
            let text = clip(&found.text, MAX_TEXT);
            if text.is_empty() {
                continue;
            }
            let id = item_id(found.agent, &found.session_id, &text);
            if !known.insert(id.clone()) {
                continue;
            }
            self.items.push(Item {
                id,
                agent: found.agent,
                project: found.project,
                chat_title: clip(&found.chat_title, MAX_TITLE),
                text,
                kind: found.kind,
                found_at: found.found_at,
                session_id: found.session_id,
                removed_at: None,
            });
            added += 1;
        }
        added
    }

    /// Chat titles often arrive after the first items, so later titles fill them in.
    pub fn retitle(&mut self, agent: AgentId, session_id: &str, title: &str) -> bool {
        let title = clip(title, MAX_TITLE);
        let mut changed = false;
        for item in self.items.iter_mut().chain(self.history.iter_mut()) {
            if item.agent == agent && item.session_id == session_id && !title.is_empty() && item.chat_title != title {
                item.chat_title = title.clone();
                changed = true;
            }
        }
        changed
    }

    pub fn remove(&mut self, ids: &[String], now: i64) -> bool {
        let (removed, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.items).into_iter().partition(|item| ids.contains(&item.id));
        self.items = kept;
        let changed = !removed.is_empty();
        for mut item in removed.into_iter().rev() {
            item.removed_at = Some(now);
            self.history.insert(0, item);
        }
        changed
    }

    pub fn restore(&mut self, ids: &[String]) -> bool {
        let (restored, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.history).into_iter().partition(|item| ids.contains(&item.id));
        self.history = kept;
        let changed = !restored.is_empty();
        for mut item in restored {
            item.removed_at = None;
            self.items.push(item);
        }
        self.items.sort_by_key(|item| item.found_at);
        changed
    }

    pub fn clear_history(&mut self) -> bool {
        let cleared: Vec<String> = self.history.drain(..).map(|item| item.id).collect();
        let changed = !cleared.is_empty();
        self.cleared.extend(cleared);
        changed
    }

    /// Open items per agent, in `AGENTS` order.
    pub fn counts(&self) -> [u32; 3] {
        let mut counts = [0; 3];
        for item in &self.items {
            if let Some(index) = AGENTS.iter().position(|agent| *agent == item.agent) {
                counts[index] += 1;
            }
        }
        counts
    }
}

/// Writes through a temporary file and a rename, so a crash never leaves half a file.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec(value).map_err(io::Error::other)?)?;
    fs::rename(&temporary, path)
}

/// Reads a saved file. A damaged file is kept aside instead of being overwritten.
pub fn read_json<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    let Ok(bytes) = fs::read(path) else { return T::default() };
    match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("agent-todo: {} is damaged ({error}); starting fresh and keeping a copy.", path.display());
            let _ = fs::rename(path, damaged_copy(path));
            T::default()
        }
    }
}

fn damaged_copy(path: &Path) -> PathBuf {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{name}.damaged"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(text: &str, session: &str) -> Found {
        Found {
            agent: AgentId::Claude,
            session_id: session.into(),
            project: "D:\\Work\\app".into(),
            chat_title: "Title".into(),
            text: text.into(),
            kind: ItemKind::Step,
            found_at: 10,
        }
    }

    #[test]
    fn stores_the_same_text_from_one_session_once() {
        let mut store = StoreData::default();
        assert_eq!(store.add([found("Run the tests", "a"), found("run  the tests", "a"), found("Run the tests", "b")]), 2);
        assert_eq!(store.add([found("Run the tests", "a")]), 0);
        assert_eq!(store.counts(), [2, 0, 0]);
    }

    #[test]
    fn removed_items_go_to_history_and_come_back() {
        let mut store = StoreData::default();
        store.add([found("One", "a"), Found { found_at: 20, ..found("Two", "a") }]);
        let id = store.items[0].id.clone();
        assert!(store.remove(std::slice::from_ref(&id), 99));
        assert_eq!(store.items.len(), 1);
        assert_eq!(store.history[0].removed_at, Some(99));
        assert_eq!(store.add([found("One", "a")]), 0, "a removed item is not found again");
        assert!(store.restore(std::slice::from_ref(&id)));
        assert_eq!(store.items.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), ["One", "Two"]);
        assert_eq!(store.items[0].removed_at, None);
    }

    #[test]
    fn cleared_history_is_never_found_again() {
        let mut store = StoreData::default();
        store.add([found("One", "a")]);
        let ids = vec![store.items[0].id.clone()];
        store.remove(&ids, 1);
        assert!(store.clear_history());
        assert!(store.history.is_empty());
        assert_eq!(store.add([found("One", "a")]), 0);
    }

    #[test]
    fn later_titles_fill_in_and_long_text_is_clipped() {
        let mut store = StoreData::default();
        store.add([found(&"x".repeat(900), "a")]);
        assert_eq!(store.items[0].text.chars().count(), MAX_TEXT);
        assert!(store.retitle(AgentId::Claude, "a", "Better title"));
        assert!(!store.retitle(AgentId::Claude, "a", "Better title"));
        assert_eq!(store.items[0].chat_title, "Better title");
    }

    #[test]
    fn saves_and_reads_back_and_keeps_a_damaged_file_aside() {
        let folder = std::env::temp_dir().join(format!("agent-todo-store-{}", std::process::id()));
        let path = folder.join("items.json");
        let mut store = StoreData { enabled_at: Some(5), ..Default::default() };
        store.add([found("One", "a")]);
        write_json(&path, &store).unwrap();
        assert_eq!(read_json::<StoreData>(&path), store);
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(read_json::<StoreData>(&path), StoreData::default());
        assert!(folder.join("items.json.damaged").exists());
        let _ = fs::remove_dir_all(folder);
    }
}
