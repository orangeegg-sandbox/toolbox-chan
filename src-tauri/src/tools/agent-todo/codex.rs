//! Codex chats: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, one JSON object per
//! line with a `type` and a `payload`. Plans are `update_plan` function calls; a
//! turn ends with a `task_complete` event (its `last_agent_message` is the final
//! message) or `turn_aborted`. Chat titles live in `~/.codex/session_index.jsonl`.

use super::session::{first_line, parse_time, Session, TurnEnd};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type", default)]
    kind: String,
    timestamp: Option<String>,
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type", default)]
    kind: String,
    id: Option<String>,
    cwd: Option<String>,
    thread_source: Option<String>,
    source: Option<Value>,
    name: Option<String>,
    arguments: Option<String>,
    turn_id: Option<String>,
    last_agent_message: Option<String>,
    message: Option<Value>,
    plan: Option<Value>,
}

#[derive(Deserialize)]
struct Prompt {
    payload: PromptPayload,
}

#[derive(Deserialize)]
struct PromptPayload {
    role: Option<String>,
    #[serde(default)]
    content: Vec<PromptPart>,
}

#[derive(Deserialize)]
struct PromptPart {
    text: Option<String>,
}

/// The user's own words: Codex also sends AGENTS.md and app context as user messages.
fn prompt_text(text: &str) -> Option<&str> {
    let trimmed = text.trim_start();
    (!trimmed.is_empty() && !trimmed.starts_with('<') && !trimmed.starts_with("# AGENTS.md")).then_some(trimmed)
}

/// One line of `session_index.jsonl`: the latest line for an id wins.
#[derive(Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub thread_name: String,
}

pub fn feed(session: &mut Session, line: &[u8], ends: &mut Vec<TurnEnd>) {
    let Ok(Line { kind, timestamp, payload: Some(payload) }) = serde_json::from_slice::<Line>(line) else { return };
    match (kind.as_str(), payload.kind.as_str()) {
        // The first meta line is this chat's own; later ones repeat a parent's.
        ("session_meta", _) if session.id.is_empty() => {
            session.id = payload.id.unwrap_or_default();
            session.project = payload.cwd.unwrap_or_default();
            let spawned = payload.source.as_ref().and_then(|source| source.get("subagent")).is_some();
            session.skip = payload.thread_source.as_deref() == Some("subagent") || spawned;
        }
        ("turn_context", _) => {
            if let Some(cwd) = payload.cwd.filter(|cwd| !cwd.is_empty()) {
                session.project = cwd;
            }
        }
        ("response_item", "function_call") if payload.name.as_deref() == Some("update_plan") => {
            if let Some(arguments) = payload.arguments.and_then(|arguments| serde_json::from_str::<Value>(&arguments).ok()) {
                set_plan(session, arguments.get("plan"));
            }
        }
        ("event_msg", "plan_update") => set_plan(session, payload.plan.as_ref()),
        ("event_msg", "user_message") if session.fallback_title.is_empty() => {
            if let Some(text) = payload.message.as_ref().and_then(Value::as_str).and_then(prompt_text) {
                session.fallback_title = first_line(text);
            }
        }
        ("response_item", "message") if session.fallback_title.is_empty() => {
            let Ok(Prompt { payload: PromptPayload { role: Some(role), content } }) = serde_json::from_slice::<Prompt>(line) else { return };
            if role == "user" {
                if let Some(text) = content.iter().filter_map(|part| part.text.as_deref()).find_map(prompt_text) {
                    session.fallback_title = first_line(text);
                }
            }
        }
        // Chats imported from other agents replay their turns; they are not Codex's.
        ("event_msg", "task_complete" | "turn_aborted")
            if !payload.turn_id.as_deref().unwrap_or_default().starts_with("external-import") =>
        {
            let at = parse_time(timestamp.as_deref().unwrap_or_default());
            ends.extend(session.end_turn(at, payload.last_agent_message.as_deref()));
        }
        _ => {}
    }
}

fn set_plan(session: &mut Session, plan: Option<&Value>) {
    let Some(plan) = plan.and_then(Value::as_array) else { return };
    let field = |step: &Value, key: &str| step.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    session.set_plan(plan.iter().map(|step| (field(step, "step"), field(step, "status"))));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(source: &str) -> (Session, Vec<TurnEnd>) {
        let mut session = Session::default();
        let mut ends = Vec::new();
        for line in source.lines() {
            feed(&mut session, line.as_bytes(), &mut ends);
        }
        (session, ends)
    }

    #[test]
    fn reads_the_fixture_chat() {
        let (session, ends) = run(include_str!("fixtures/codex.jsonl"));
        assert_eq!(session.id, "01a00000-0000-7000-8000-000000000001");
        assert_eq!(session.project, "D:\\Work\\demo-api");
        assert!(!session.skip);
        assert_eq!(session.fallback_title, "Add rate limits to the demo API");
        assert_eq!(ends.len(), 2);
        assert_eq!(ends[0].steps, ["Add a limit test", "Update the changelog"]);
        assert_eq!(ends[0].at, parse_time("2026-10-22T09:00:40.000Z"));
        assert!(ends[0].message.contains("TODO(user): Set RATE_LIMIT in production"));
        assert_eq!(ends[1].steps, ["Update the changelog"], "an aborted turn still ends with its open steps");
        assert_eq!(ends[1].message, "");
    }

    #[test]
    fn skips_subagents_and_imported_turns() {
        let subagent = r#"{"timestamp":"2026-10-22T09:00:00.000Z","type":"session_meta","payload":{"id":"child","cwd":"D:\\Work","source":{"subagent":{"thread_spawn":{"depth":1}}},"thread_source":"subagent"}}"#;
        let complete = r#"{"timestamp":"2026-10-22T09:00:09.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","last_agent_message":"You should merge it."}}"#;
        let (session, ends) = run(&format!("{subagent}\n{complete}"));
        assert!(session.skip);
        assert!(ends.is_empty());

        let imported = r#"{"timestamp":"2026-10-22T09:00:09.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"external-import-turn-1","last_agent_message":"You should merge it."}}"#;
        assert!(run(imported).1.is_empty());
    }

    #[test]
    fn titles_a_chat_by_its_first_prompt_until_codex_names_it() {
        let lines = [
            r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"You are Codex."}]}}"#,
            r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\n\n<INSTRUCTIONS>Use tabs.</INSTRUCTIONS>"}]}}"##,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>windows</environment_context>"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the login page\nIt loops."}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Second prompt"}]}}"#,
        ];
        assert_eq!(run(&lines.join("\n")).0.fallback_title, "Fix the login page");
    }

    #[test]
    fn reads_index_entries() {
        let entry: IndexEntry = serde_json::from_str(r#"{"id":"a","thread_name":"Fix login","updated_at":"2026-10-22T02:51:45Z"}"#).unwrap();
        assert_eq!((entry.id.as_str(), entry.thread_name.as_str()), ("a", "Fix login"));
    }
}
