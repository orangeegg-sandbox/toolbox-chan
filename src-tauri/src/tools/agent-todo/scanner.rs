//! Finds new and changed chat files and reads only what was added since the last
//! scan. Each file keeps a cursor: how far it was read and what the chat's plan,
//! title, and folder were at that point. Chats older than the tool are skipped.

use super::{
    claude, codex, dsh, rules,
    session::{Session, TurnEnd},
    store::{Found, ItemKind},
};
use crate::platform::pet_events::AgentId;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

/// A file seen for the first time is read from the start only when it is new and
/// smaller than this; otherwise reading starts at its end.
const MAX_FIRST_READ: u64 = 64 << 20;
/// Longer lines are images or tool output, never plans or final messages.
const MAX_LINE: usize = 32 << 20;
const MAX_PER_TURN: usize = 25;

/// Where each agent keeps its chats.
#[derive(Clone, Debug)]
pub struct Roots {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub codex_index: PathBuf,
    pub dsh: PathBuf,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanState {
    pub files: BTreeMap<String, Cursor>,
    pub codex_index: IndexCursor,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexCursor {
    pub offset: u64,
    pub titles: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub agent: AgentId,
    pub offset: u64,
    pub len: u64,
    pub modified: i64,
    #[serde(default)]
    pub session: Session,
}

#[derive(Debug, Default)]
pub struct Outcome {
    pub found: Vec<Found>,
    /// Chats whose title changed: agent, session id, new title.
    pub titles: Vec<(AgentId, String, String)>,
    pub state_changed: bool,
    pub errors: Vec<String>,
}

pub fn scan(roots: &Roots, state: &mut ScanState, enabled_at: i64) -> Outcome {
    let mut outcome = Outcome::default();
    read_codex_index(roots, &mut state.codex_index, &mut outcome);
    let files = discover(roots);
    let present: HashSet<String> = files.iter().map(|(_, path)| key(path)).collect();
    let before = state.files.len();
    state.files.retain(|path, _| present.contains(path));
    outcome.state_changed |= state.files.len() != before;
    for (agent, path) in files {
        if let Err(error) = scan_file(agent, &path, state, enabled_at, &mut outcome) {
            outcome.errors.push(format!("{}: {error}", path.display()));
        }
    }
    outcome
}

fn key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn modified_ms(metadata: &fs::Metadata) -> i64 {
    metadata.modified().ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
}

fn scan_file(agent: AgentId, path: &Path, state: &mut ScanState, enabled_at: i64, outcome: &mut Outcome) -> io::Result<()> {
    let metadata = fs::metadata(path)?;
    let (len, modified) = (metadata.len(), modified_ms(&metadata));
    let cursor = match state.files.entry(key(path)) {
        std::collections::btree_map::Entry::Occupied(entry) => {
            let cursor = entry.into_mut();
            if cursor.len == len && cursor.modified == modified {
                return Ok(());
            }
            if len < cursor.offset {
                // Rewritten from the start: read it again; known items are not added twice.
                cursor.offset = 0;
                cursor.session = Session::default();
            }
            cursor
        }
        std::collections::btree_map::Entry::Vacant(entry) => {
            let mut cursor = Cursor { agent, offset: 0, len: 0, modified: 0, session: Session::default() };
            let fresh = modified >= enabled_at && len <= MAX_FIRST_READ;
            if !fresh {
                // An old chat: start at its end. Codex names the chat on its first line only.
                if agent == AgentId::Codex {
                    read_lines(path, 0, 1, |line| codex::feed(&mut cursor.session, line, &mut Vec::new()))?;
                }
                cursor.offset = if agent == AgentId::Deepseek { dsh_frame_end(path, len)? } else { len };
            }
            entry.insert(cursor)
        }
    };
    let titles = &state.codex_index.titles;
    // Codex names chats in its index; until then, and for the other agents, the chat file does.
    let title_of = |session: &Session| {
        let indexed = (agent == AgentId::Codex).then(|| titles.get(&session.id)).flatten();
        indexed.cloned().unwrap_or_else(|| session.title().to_string())
    };
    let title_before = title_of(&cursor.session);
    let mut ends = Vec::new();
    let session = &mut cursor.session;
    cursor.offset = match agent {
        AgentId::Claude => read_lines(path, cursor.offset, usize::MAX, |line| claude::feed(session, line, &mut ends))?,
        AgentId::Codex => read_lines(path, cursor.offset, usize::MAX, |line| codex::feed(session, line, &mut ends))?,
        AgentId::Deepseek => read_frames(path, cursor.offset, |line| dsh::feed(session, line, &mut ends))?,
    };
    cursor.len = len;
    cursor.modified = modified;
    outcome.state_changed = true;

    let session_id = if cursor.session.id.is_empty() { fallback_id(agent, path) } else { cursor.session.id.clone() };
    let title = title_of(&cursor.session);
    if !title.is_empty() && title != title_before {
        outcome.titles.push((agent, session_id.clone(), title.clone()));
    }
    for end in ends {
        let at = end.at.unwrap_or(modified);
        if at >= enabled_at {
            outcome.found.extend(found_items(agent, &session_id, &cursor.session, &title, end, at));
        }
    }
    Ok(())
}

fn fallback_id(agent: AgentId, path: &Path) -> String {
    let named = if agent == AgentId::Deepseek { path.parent() } else { Some(path) };
    let stem = named.and_then(|path| path.file_stem()).map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    stem.trim_start_matches("session-").to_string()
}

fn found_items(agent: AgentId, session_id: &str, session: &Session, title: &str, end: TurnEnd, at: i64) -> Vec<Found> {
    let steps = end.steps.into_iter().map(|text| (ItemKind::Step, text));
    let follow_ups = rules::follow_ups(&end.message).into_iter().map(|text| (ItemKind::ForYou, text));
    steps.chain(follow_ups).take(MAX_PER_TURN).map(|(kind, text)| Found {
        agent,
        session_id: session_id.to_string(),
        project: session.project.clone(),
        chat_title: title.to_string(),
        text,
        kind,
        found_at: at,
    }).collect()
}

/// Calls `each` for up to `limit` complete lines from `offset` and returns the
/// offset after the last complete line. A line still being written is left for
/// the next scan.
fn read_lines(path: &Path, offset: u64, limit: usize, mut each: impl FnMut(&[u8])) -> io::Result<u64> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::with_capacity(1 << 16, file);
    let mut position = offset;
    let mut line = Vec::new();
    for _ in 0..limit {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 || line.last() != Some(&b'\n') {
            break;
        }
        position += read as u64;
        if line.len() <= MAX_LINE {
            each(&line);
        }
    }
    Ok(position)
}

/// Decodes the complete zstd frames after `offset` and feeds their lines.
fn read_frames(path: &Path, offset: u64, mut each: impl FnMut(&[u8])) -> io::Result<u64> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    let (text, used) = dsh::decode_frames(&data);
    for line in text.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
        each(line);
    }
    Ok(offset + used as u64)
}

/// The end of the last complete frame, for an old DSH chat read from its end.
fn dsh_frame_end(path: &Path, len: u64) -> io::Result<u64> {
    if len > MAX_FIRST_READ {
        return Ok(len);
    }
    let (_, used) = dsh::decode_frames(&fs::read(path)?);
    Ok(used as u64)
}

fn read_codex_index(roots: &Roots, index: &mut IndexCursor, outcome: &mut Outcome) {
    let Ok(metadata) = fs::metadata(&roots.codex_index) else { return };
    if metadata.len() == index.offset {
        return;
    }
    if metadata.len() < index.offset {
        index.offset = 0;
    }
    let titles = &mut index.titles;
    let read = read_lines(&roots.codex_index, index.offset, usize::MAX, |line| {
        let Ok(entry) = serde_json::from_slice::<codex::IndexEntry>(line) else { return };
        let name = entry.thread_name.trim();
        if !name.is_empty() && titles.get(&entry.id).map(String::as_str) != Some(name) {
            titles.insert(entry.id.clone(), name.to_string());
            outcome.titles.push((AgentId::Codex, entry.id, name.to_string()));
        }
    });
    match read {
        Ok(offset) => {
            index.offset = offset;
            outcome.state_changed = true;
        }
        Err(error) => outcome.errors.push(format!("{}: {error}", roots.codex_index.display())),
    }
}

fn folders(path: &Path) -> Vec<PathBuf> {
    entries(path).into_iter().filter(|path| path.is_dir()).collect()
}

fn entries(path: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(path) else { return Vec::new() };
    read.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect()
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Every chat file, without reading any of them.
fn discover(roots: &Roots) -> Vec<(AgentId, PathBuf)> {
    let mut files = Vec::new();
    // Claude: one file per chat directly in each project folder; subagents live deeper.
    for project in folders(&roots.claude) {
        files.extend(entries(&project).into_iter()
            .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl") && path.is_file())
            .map(|path| (AgentId::Claude, path)));
    }
    // Codex: sessions/YYYY/MM/DD/rollout-*.jsonl.
    let mut pending = vec![(roots.codex.clone(), 0)];
    while let Some((folder, depth)) = pending.pop() {
        for path in entries(&folder) {
            let name = name_of(&path);
            if path.is_dir() && depth < 4 {
                pending.push((path, depth + 1));
            } else if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                files.push((AgentId::Codex, path));
            }
        }
    }
    // DSH: sessions/<project>/session-<id>/session.v4.jsonl.zstd.
    for project in folders(&roots.dsh) {
        for chat in folders(&project).into_iter().filter(|path| name_of(path).starts_with("session-")) {
            files.extend(entries(&chat).into_iter()
                .filter(|path| {
                    let name = name_of(path);
                    name.starts_with("session.v") && name.ends_with(".jsonl.zstd")
                })
                .map(|path| (AgentId::Deepseek, path)));
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const CLAUDE_ID: &str = "11111111-2222-4333-8444-555555555555";

    struct Tree {
        root: PathBuf,
        roots: Roots,
    }

    impl Tree {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("agent-todo-scan-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            let roots = Roots {
                claude: root.join(".claude/projects"),
                codex: root.join(".codex/sessions"),
                codex_index: root.join(".codex/session_index.jsonl"),
                dsh: root.join(".dsh/sessions"),
            };
            Self { root, roots }
        }

        fn write(&self, path: &Path, bytes: &[u8]) {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }

        fn append(&self, path: &Path, bytes: &[u8]) {
            fs::OpenOptions::new().append(true).open(path).unwrap().write_all(bytes).unwrap();
        }

        fn claude(&self) -> PathBuf {
            self.roots.claude.join("D--Work-demo-app").join(format!("{CLAUDE_ID}.jsonl"))
        }

        fn codex(&self) -> PathBuf {
            self.roots.codex.join("2026/10/22/rollout-2026-10-22T09-00-00-01a00000-0000-7000-8000-000000000001.jsonl")
        }

        fn dsh(&self) -> PathBuf {
            self.roots.dsh.join("--D-Work-demo-site--/session-a0000000-0000-4000-8000-000000000001/session.v4.jsonl.zstd")
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn texts(found: &[Found], agent: AgentId) -> Vec<(ItemKind, String)> {
        found.iter().filter(|item| item.agent == agent).map(|item| (item.kind, item.text.clone())).collect()
    }

    #[test]
    fn reads_new_chats_of_every_agent() {
        let tree = Tree::new("new");
        tree.write(&tree.claude(), include_bytes!("fixtures/claude.jsonl"));
        tree.write(&tree.codex(), include_bytes!("fixtures/codex.jsonl"));
        tree.write(&tree.dsh(), include_bytes!("fixtures/dsh.session.v4.jsonl.zstd"));
        tree.write(&tree.roots.codex_index, br#"{"id":"01a00000-0000-7000-8000-000000000001","thread_name":"Rate limits","updated_at":"2026-10-22T09:00:02Z"}
"#);
        // A subagent chat in its own folder is not a chat with the user.
        tree.write(&tree.claude().with_extension("").join("subagents/agent-a1.jsonl"), include_bytes!("fixtures/claude.jsonl"));
        let mut state = ScanState::default();
        let outcome = scan(&tree.roots, &mut state, 0);
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        use ItemKind::{ForYou, Step};
        assert_eq!(texts(&outcome.found, AgentId::Claude), [
            (Step, "Write the docs".into()),
            (ForYou, "Review the new page".into()),
            (ForYou, "You should restart the dev server.".into()),
            (Step, "Run the browser tests".into()),
            (Step, "Commit the change".into()),
            (Step, "Run the browser tests".into()),
            (Step, "Commit the change".into()),
            (ForYou, "Approve the release".into()),
        ]);
        assert_eq!(texts(&outcome.found, AgentId::Codex), [
            (Step, "Add a limit test".into()),
            (Step, "Update the changelog".into()),
            (ForYou, "Set RATE_LIMIT in production".into()),
            (Step, "Update the changelog".into()),
        ]);
        assert_eq!(texts(&outcome.found, AgentId::Deepseek), [
            (Step, "Write a closing note".into()),
            (ForYou, "Check the dummy chat appears in the TODO list".into()),
            (ForYou, "Try the fixed format line".into()),
            (ForYou, "You should restart the toolbox after this.".into()),
        ]);
        let codex = outcome.found.iter().find(|item| item.agent == AgentId::Codex).unwrap();
        assert_eq!((codex.chat_title.as_str(), codex.project.as_str()), ("Rate limits", "D:\\Work\\demo-api"));
        let claude = outcome.found.iter().find(|item| item.agent == AgentId::Claude).unwrap();
        assert_eq!((claude.session_id.as_str(), claude.chat_title.as_str()), (CLAUDE_ID, "Demo task list"));

        let again = scan(&tree.roots, &mut state, 0);
        assert!(again.found.is_empty() && !again.state_changed, "unchanged files are not read again");
    }

    #[test]
    fn skips_old_chats_but_reads_what_they_add_later() {
        let tree = Tree::new("old");
        tree.write(&tree.claude(), include_bytes!("fixtures/claude.jsonl"));
        tree.write(&tree.codex(), include_bytes!("fixtures/codex.jsonl"));
        tree.write(&tree.dsh(), include_bytes!("fixtures/dsh.session.v4.jsonl.zstd"));
        let enabled_at = modified_ms(&fs::metadata(tree.codex()).unwrap()) + 60_000;
        let mut state = ScanState::default();
        assert!(scan(&tree.roots, &mut state, enabled_at).found.is_empty());

        tree.append(&tree.claude(), concat!(
            r#"{"type":"assistant","isSidechain":false,"cwd":"D:\\Work\\demo-app","sessionId":"11111111-2222-4333-8444-555555555555","timestamp":"2030-01-01T00:00:00.000Z","message":{"id":"m9","content":[{"type":"tool_use","id":"t9","name":"mcp__ccd_turn__update_plan","input":{"items":[{"content":"New step","status":"pending"}]}}],"stop_reason":"tool_use"}}"#, "\n",
            r#"{"type":"assistant","isSidechain":false,"timestamp":"2030-01-01T00:00:01.000Z","message":{"id":"m10","content":[{"type":"text","text":"Please run the seed script."}],"stop_reason":"end_turn"}}"#, "\n",
        ).as_bytes());
        tree.append(&tree.codex(), concat!(
            r#"{"timestamp":"2030-01-01T00:00:00.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"t3","last_agent_message":"TODO(user): Rotate the key"}}"#, "\n",
        ).as_bytes());
        let outcome = scan(&tree.roots, &mut state, enabled_at);
        assert_eq!(texts(&outcome.found, AgentId::Claude), [(ItemKind::Step, "New step".into()), (ItemKind::ForYou, "Please run the seed script.".into())]);
        assert_eq!(texts(&outcome.found, AgentId::Codex), [(ItemKind::ForYou, "Rotate the key".into())],
            "the plan from before is unknown, but the header names the chat");
        let item = outcome.found.iter().find(|item| item.agent == AgentId::Codex).unwrap();
        assert_eq!(item.session_id, "01a00000-0000-7000-8000-000000000001");
        assert!(texts(&outcome.found, AgentId::Deepseek).is_empty());
    }

    #[test]
    fn waits_for_lines_and_frames_still_being_written() {
        let tree = Tree::new("partial");
        let claude = include_str!("fixtures/claude.jsonl").replace("\r\n", "\n");
        let (head, tail) = claude.split_at(claude.len() - 40);
        tree.write(&tree.claude(), head.as_bytes());
        let dsh = include_bytes!("fixtures/dsh.session.v4.jsonl.zstd");
        tree.write(&tree.dsh(), &dsh[..dsh.len() - 10]);
        let mut state = ScanState::default();
        let first = scan(&tree.roots, &mut state, 0);
        assert!(!first.found.iter().any(|item| item.text == "Approve the release"), "the last line is incomplete");
        assert!(texts(&first.found, AgentId::Deepseek).is_empty(), "the turn ends in the incomplete frame");

        tree.append(&tree.claude(), tail.as_bytes());
        tree.append(&tree.dsh(), &dsh[dsh.len() - 10..]);
        let second = scan(&tree.roots, &mut state, 0);
        assert!(second.found.iter().any(|item| item.text == "Approve the release"));
        assert_eq!(texts(&second.found, AgentId::Deepseek).len(), 4);
    }

    /// Reads one real chat file as if it were new and prints counts only, never
    /// chat text: `AGENT_TODO_REPLAY=<file> cargo test replay -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads a real chat file named by AGENT_TODO_REPLAY"]
    fn replay_a_real_chat() {
        let Some(file) = std::env::var_os("AGENT_TODO_REPLAY").map(PathBuf::from) else { return };
        let name = name_of(&file);
        let agent = if name.ends_with(".zstd") { AgentId::Deepseek } else if name.starts_with("rollout-") { AgentId::Codex } else { AgentId::Claude };
        let mut session = Session::default();
        let mut ends = Vec::new();
        let feed = |line: &[u8]| match agent {
            AgentId::Claude => claude::feed(&mut session, line, &mut ends),
            AgentId::Codex => codex::feed(&mut session, line, &mut ends),
            AgentId::Deepseek => dsh::feed(&mut session, line, &mut ends),
        };
        if agent == AgentId::Deepseek { read_frames(&file, 0, feed) } else { read_lines(&file, 0, usize::MAX, feed) }.unwrap();
        let found: Vec<Found> = ends.into_iter().flat_map(|end| {
            let at = end.at.unwrap_or_default();
            found_items(agent, &session.id, &session, "", end, at)
        }).collect();
        let mut store = super::super::store::StoreData::default();
        store.add(found);
        let steps = store.items.iter().filter(|item| item.kind == ItemKind::Step).count();
        println!("replay: titled={} project_known={} items={} steps={} for_you={}",
            !session.title().is_empty(), !session.project.is_empty(), store.items.len(), steps, store.items.len() - steps);
    }

    #[test]
    fn reports_codex_titles_and_forgets_deleted_chats() {
        let tree = Tree::new("titles");
        tree.write(&tree.codex(), include_bytes!("fixtures/codex.jsonl"));
        let mut state = ScanState::default();
        let first = scan(&tree.roots, &mut state, 0);
        assert_eq!(first.found[0].chat_title, "Add rate limits to the demo API", "the first prompt stands in for a title");
        tree.write(&tree.roots.codex_index, b"{\"id\":\"01a00000-0000-7000-8000-000000000001\",\"thread_name\":\"Rate limits\"}\n");
        let second = scan(&tree.roots, &mut state, 0);
        assert_eq!(second.titles, [(AgentId::Codex, "01a00000-0000-7000-8000-000000000001".to_string(), "Rate limits".to_string())]);
        fs::remove_file(tree.codex()).unwrap();
        assert!(scan(&tree.roots, &mut state, 0).state_changed);
        assert!(state.files.is_empty());
    }
}
