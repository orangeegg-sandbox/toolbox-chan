//! The hook adapter. Agent hooks run the Toolbox-Chan executable as
//!
//!   little-toolbox.exe --pet-hook <claude|codex|deepseek> <working|done|needs-you|idle>
//!
//! with the agent's hook JSON on stdin. It turns that into one pet event,
//! posts it to the loopback door, and exits before Tauri starts, so it never
//! opens a window or touches the running app's single-instance lock. It prints
//! nothing (some agents add hook output to the chat) and always exits 0 within
//! a few seconds, so a missing or closed Toolbox-Chan never blocks the agent.

use crate::platform::{pet_door, pet_events::PetEvent};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::{Component, Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

pub const FLAG: &str = "--pet-hook";
const AGENTS: &[&str] = &["claude", "codex", "deepseek"];
const STATUSES: &[&str] = &["working", "done", "needs-you", "idle"];
const MAX_INPUT: u64 = 4 * 1024 * 1024;
const INPUT_WAIT: Duration = Duration::from_millis(1500);
const TITLE_TAIL: u64 = 512 * 1024;
const MAX_TITLE: usize = 80;
const MAX_PROMPT_TITLE: usize = 60;
const MAX_NOTE: usize = 200;

/// Runs the adapter when the executable was started with `--pet-hook`; `None` starts the app as usual.
pub fn run_if_requested() -> Option<i32> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some(FLAG) {
        return None;
    }
    let rest: Vec<String> = arguments.collect();
    if let (Some(agent), Some(status)) = (rest.first(), rest.get(1)) {
        if AGENTS.contains(&agent.as_str()) && STATUSES.contains(&status.as_str()) {
            let input = read_input();
            let context = Context { home: home_dir(), cwd: std::env::current_dir().ok() };
            if let Some(event) = build_event(agent, status, &input, &context) {
                let _ = post(&event);
            }
        }
    }
    Some(0)
}

struct Context {
    home: Option<PathBuf>,
    cwd: Option<PathBuf>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Waits briefly for stdin to close; a hook runner that keeps it open must not hang the adapter.
fn read_input() -> Value {
    let (sender, receiver) = mpsc::channel();
    let _ = thread::Builder::new().name("pet-hook-stdin".into()).spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::stdin().take(MAX_INPUT).read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });
    receiver.recv_timeout(INPUT_WAIT).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

fn text<'a>(input: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| input[key].as_str()).map(str::trim).filter(|value| !value.is_empty())
}

/// One line of plain text, at most `max` characters.
fn clean(value: &str, max: usize) -> String {
    let flat: String = value.chars().map(|character| if character.is_control() { ' ' } else { character }).collect();
    let words = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    if words.chars().count() <= max {
        return words;
    }
    let mut short: String = words.chars().take(max.saturating_sub(1)).collect();
    short.truncate(short.trim_end().len());
    short.push('…');
    short
}

/// The project folder's name. Agent worktrees such as `<repo>/.claude/worktrees/<name>` count as the repository.
fn project_name(cwd: &Path) -> Option<String> {
    let parts: Vec<String> = cwd.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let worktree = parts.windows(2).position(|pair| pair[0].eq_ignore_ascii_case(".claude") && pair[1].eq_ignore_ascii_case("worktrees"));
    match worktree {
        Some(index) if index > 0 => parts.get(index - 1).cloned(),
        _ => parts.last().cloned(),
    }
}

fn build_event(agent: &str, status: &str, input: &Value, context: &Context) -> Option<Value> {
    // Claude also notifies when a finished chat has waited a minute for the next prompt; that is not a question.
    if agent == "claude" && status == "needs-you" {
        let idle = input["notification_type"].as_str() == Some("idle_prompt")
            || input["message"].as_str().is_some_and(|message| message.to_lowercase().contains("waiting for your input"));
        if idle {
            return None;
        }
    }
    let session = text(input, &["session_id", "sessionId", "thread_id", "conversation_id"]).map(|id| clean(id, 200));
    let project = text(input, &["cwd"]).map(PathBuf::from).or_else(|| context.cwd.clone())
        .and_then(|cwd| project_name(&cwd))
        .map(|name| clean(&name, MAX_TITLE));
    let title = match agent {
        "claude" => text(input, &["transcript_path"]).and_then(|path| claude_title(Path::new(path))),
        "codex" => session.as_deref().zip(context.home.as_deref()).and_then(|(id, home)| codex_title(home, id)),
        _ => None,
    }
    .or_else(|| (status == "working").then(|| text(input, &["prompt"])).flatten().map(|prompt| {
        clean(prompt.lines().find(|line| !line.trim().is_empty()).unwrap_or(""), MAX_PROMPT_TITLE)
    }))
    .map(|title| clean(&title, MAX_TITLE))
    .filter(|title| !title.is_empty());
    let note = match (project, title) {
        (Some(project), Some(title)) => Some(format!("{project} · {title}")),
        (project, title) => project.or(title),
    }
    .map(|note| clean(&note, MAX_NOTE))
    .filter(|note| !note.is_empty());

    let mut event = json!({ "source": "hook", "agent": agent, "status": status });
    if let Some(session) = session.filter(|session| !session.is_empty()) {
        event["sessionId"] = json!(session);
    }
    if let Some(note) = note {
        event["note"] = json!(note);
    }
    // Use the app's own rules, so the door never has to reject what this adapter sends.
    PetEvent::parse(event.to_string().as_bytes()).ok()?;
    Some(event)
}

fn read_range(path: &Path, from_end: Option<u64>, length: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = from_end.map(|tail| size.saturating_sub(tail)).unwrap_or(0);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(length).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // A tail read usually starts inside a line; skip that partial line.
    Some(if start > 0 { text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default() } else { text })
}

/// Claude Code stores the chat title in its transcript as `custom-title`, `ai-title`, or `summary` lines.
fn claude_title(transcript: &Path) -> Option<String> {
    let find = |text: &str| text.lines().rev().find_map(|line| {
        if !line.contains("title\"") && !line.contains("\"summary\"") {
            return None;
        }
        let value: Value = serde_json::from_str(line).ok()?;
        match value["type"].as_str()? {
            "custom-title" => value["customTitle"].as_str(),
            "ai-title" => value["aiTitle"].as_str().or(value["title"].as_str()),
            "summary" => value["summary"].as_str(),
            _ => None,
        }
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
    });
    read_range(transcript, Some(TITLE_TAIL), TITLE_TAIL).as_deref().and_then(find)
        .or_else(|| read_range(transcript, None, TITLE_TAIL).as_deref().and_then(find))
}

/// Codex keeps chat names in `~/.codex/session_index.jsonl`; the latest line for a session wins.
fn codex_title(home: &Path, session: &str) -> Option<String> {
    let index = home.join(".codex").join("session_index.jsonl");
    let text = read_range(&index, Some(1024 * 1024), 1024 * 1024)?;
    text.lines().rev().find_map(|line| {
        if !line.contains(session) {
            return None;
        }
        let value: Value = serde_json::from_str(line).ok()?;
        let id = text_field(&value, &["id", "session_id", "thread_id"])?;
        (id == session).then(|| text_field(&value, &["thread_name", "name", "title"]).map(str::to_owned)).flatten()
    })
}

fn text_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| value[key].as_str()).filter(|value| !value.trim().is_empty())
}

fn post(event: &Value) -> std::io::Result<()> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, pet_door::PORT));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    stream.set_read_timeout(Some(Duration::from_millis(1500)))?;
    let body = event.to_string();
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        pet_door::PATH, pet_door::PORT, body.len(),
    );
    stream.write_all(request.as_bytes())?;
    stream.flush()?;
    let mut response = [0u8; 64];
    let _ = stream.read(&mut response);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("toolbox-chan-pet-hook-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn context() -> Context {
        Context { home: None, cwd: Some(PathBuf::from("C:/Work/fallback")) }
    }

    #[test]
    fn turns_a_claude_prompt_into_a_working_event() {
        let directory = scratch("claude");
        let transcript = directory.join("chat.jsonl");
        std::fs::write(&transcript, concat!(
            "{\"type\":\"user\",\"message\":\"hello\"}\n",
            "{\"type\":\"custom-title\",\"customTitle\":\"Old title\",\"sessionId\":\"s1\"}\n",
            "{\"type\":\"assistant\",\"message\":\"hi\"}\n",
            "{\"type\":\"custom-title\",\"customTitle\":\"Add the pet\",\"sessionId\":\"s1\"}\n",
        )).unwrap();
        let input = json!({
            "session_id": "s1",
            "cwd": "D:/Personal/CustomOfflineTool/.claude/worktrees/exciting-rubin",
            "transcript_path": transcript.to_string_lossy(),
            "hook_event_name": "UserPromptSubmit",
            "prompt": "Build the pet"
        });
        assert_eq!(build_event("claude", "working", &input, &context()), Some(json!({
            "source": "hook", "agent": "claude", "status": "working", "sessionId": "s1",
            "note": "CustomOfflineTool · Add the pet"
        })));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn falls_back_to_the_prompt_and_the_working_folder() {
        let input = json!({ "session_id": "abc", "prompt": "\n  Fix the tray icon\nwith more detail" });
        let event = build_event("claude", "working", &input, &context()).unwrap();
        assert_eq!(event["note"], json!("fallback · Fix the tray icon"));
        // The prompt only names a chat that is starting.
        let event = build_event("claude", "done", &input, &context()).unwrap();
        assert_eq!(event["note"], json!("fallback"));
    }

    #[test]
    fn skips_claude_idle_reminders_but_reports_permission_prompts() {
        let idle = json!({ "session_id": "s", "notification_type": "idle_prompt", "message": "Claude is waiting for your input" });
        assert_eq!(build_event("claude", "needs-you", &idle, &context()), None);
        let older = json!({ "session_id": "s", "message": "Claude is waiting for your input" });
        assert_eq!(build_event("claude", "needs-you", &older, &context()), None);
        let permission = json!({ "session_id": "s", "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash" });
        assert_eq!(build_event("claude", "needs-you", &permission, &context()).unwrap()["status"], json!("needs-you"));
    }

    #[test]
    fn names_codex_chats_from_its_session_index() {
        let home = scratch("codex");
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(home.join(".codex").join("session_index.jsonl"), concat!(
            "{\"id\":\"t-1\",\"thread_name\":\"First name\"}\n",
            "{\"id\":\"t-2\",\"thread_name\":\"Other chat\"}\n",
            "{\"id\":\"t-1\",\"thread_name\":\"Renamed chat\"}\n",
        )).unwrap();
        let context = Context { home: Some(home.clone()), cwd: None };
        let input = json!({ "session_id": "t-1", "cwd": "/home/me/projects/api", "hook_event_name": "Stop" });
        assert_eq!(build_event("codex", "done", &input, &context), Some(json!({
            "source": "hook", "agent": "codex", "status": "done", "sessionId": "t-1", "note": "api · Renamed chat"
        })));
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn survives_missing_or_strange_input() {
        let context = Context { home: None, cwd: None };
        assert_eq!(build_event("deepseek", "idle", &Value::Null, &context), Some(json!({ "source": "hook", "agent": "deepseek", "status": "idle" })));
        let long = json!({ "session_id": "x".repeat(500), "cwd": "/a/b", "prompt": "line\u{0007}with bell" });
        let event = build_event("codex", "working", &long, &context).unwrap();
        assert_eq!(event["sessionId"].as_str().unwrap().chars().count(), 200);
        assert_eq!(event["note"], json!("b · line with bell"));
        assert!(claude_title(Path::new("C:/does/not/exist.jsonl")).is_none());
    }

    #[test]
    fn shortens_long_text_on_a_word_boundary_or_with_an_ellipsis() {
        assert_eq!(clean("  several   spaces\tand\ttabs ", 100), "several spaces and tabs");
        assert_eq!(clean("abcdefghij", 5), "abcd…");
        assert_eq!(project_name(Path::new("C:/Repo/.claude/worktrees/feature")), Some("Repo".into()));
        assert_eq!(project_name(Path::new("/srv/app")), Some("app".into()));
    }
}
