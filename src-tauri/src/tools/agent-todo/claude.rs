//! Claude Code chats: `~/.claude/projects/<encoded folder>/<session>.jsonl`, one
//! JSON object per line. The desktop app's task list is the
//! `mcp__ccd_turn__update_plan` tool; the terminal uses `TodoWrite`. A turn ends
//! at an assistant message whose `stop_reason` is `end_turn`.

use super::session::{first_line, parse_time, Session, TurnEnd};
use serde::{de::IgnoredAny, Deserialize};
use serde_json::Value;

const UPDATE_PLAN: &str = "mcp__ccd_turn__update_plan";
const WRAP_UP: &str = "mcp__ccd_turn__wrap_up";
const TODO_WRITE: &str = "TodoWrite";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Head {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    cwd: Option<String>,
    session_id: Option<String>,
    timestamp: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
    summary: Option<String>,
}

#[derive(Deserialize)]
struct WithMessage<M> {
    message: M,
}

#[derive(Deserialize)]
struct Assistant<I> {
    id: Option<String>,
    stop_reason: Option<String>,
    #[serde(default = "Vec::new")]
    content: Vec<Block<I>>,
}

#[derive(Deserialize)]
struct Block<I> {
    #[serde(rename = "type", default)]
    kind: String,
    text: Option<String>,
    name: Option<String>,
    input: Option<I>,
}

#[derive(Deserialize)]
struct Prompt {
    content: Value,
}

pub fn feed(session: &mut Session, line: &[u8], ends: &mut Vec<TurnEnd>) {
    let Ok(head) = serde_json::from_slice::<Head>(line) else { return };
    // Side chains are subagents talking to Claude, not to the user.
    if head.is_sidechain {
        return;
    }
    if let Some(cwd) = head.cwd.filter(|cwd| !cwd.is_empty()) {
        session.project = cwd;
    }
    if let Some(id) = head.session_id.filter(|id| !id.is_empty()) {
        session.id = id;
    }
    match head.kind.as_str() {
        "custom-title" | "ai-title" | "summary" => {
            let title = head.custom_title.or(head.ai_title).or(head.summary).unwrap_or_default();
            if !title.trim().is_empty() && (head.kind == "custom-title" || session.title.is_empty()) {
                session.title = title.trim().to_string();
            }
        }
        "user" if session.fallback_title.is_empty() && !head.is_meta => {
            if let Ok(WithMessage { message: Prompt { content: Value::String(text) } }) = serde_json::from_slice(line) {
                // Tags such as <task-notification> are app messages, not the user's prompt.
                if !text.trim_start().starts_with('<') {
                    session.fallback_title = first_line(&text);
                }
            }
        }
        "assistant" => assistant(session, line, parse_time(head.timestamp.as_deref().unwrap_or_default()), ends),
        _ => {}
    }
}

fn assistant(session: &mut Session, line: &[u8], at: Option<i64>, ends: &mut Vec<TurnEnd>) {
    // Tool inputs can be large; read them only on lines that change the plan.
    let Ok(WithMessage { message }) = serde_json::from_slice::<WithMessage<Assistant<IgnoredAny>>>(line) else { return };
    let id = message.id.unwrap_or_default();
    let plans = message.content.iter().any(|block| matches!(block.name.as_deref(), Some(UPDATE_PLAN | WRAP_UP | TODO_WRITE)));
    let inputs: Vec<Option<Value>> = if plans {
        serde_json::from_slice::<WithMessage<Assistant<Value>>>(line)
            .map(|line| line.message.content.into_iter().map(|block| block.input).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    for (index, block) in message.content.iter().enumerate() {
        match block.kind.as_str() {
            "text" => {
                let text = block.text.as_deref().unwrap_or_default();
                if session.final_id == id && !session.final_text.is_empty() {
                    session.final_text.push_str("\n\n");
                    session.final_text.push_str(text);
                } else {
                    session.final_id.clone_from(&id);
                    session.final_text = text.to_string();
                }
            }
            "tool_use" => {
                // Text before a tool call is a progress note, not the final message.
                session.final_id.clone_from(&id);
                session.final_text.clear();
                let input = inputs.get(index).and_then(Option::as_ref);
                match (block.name.as_deref(), input) {
                    (Some(UPDATE_PLAN), Some(input)) => update_plan(session, input),
                    (Some(TODO_WRITE), Some(input)) => todo_write(session, input),
                    // Wrapping up checks off the step in progress; steps never started stay open.
                    (Some(WRAP_UP), _) => session.complete_in_progress(),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    if matches!(message.stop_reason.as_deref(), Some("end_turn" | "stop_sequence")) {
        let text = if session.final_id == id { session.final_text.clone() } else { String::new() };
        ends.extend(session.end_turn(at, Some(&text)));
    }
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn todo_write(session: &mut Session, input: &Value) {
    if let Some(todos) = input.get("todos").and_then(Value::as_array) {
        session.set_plan(todos.iter().map(|todo| (text(todo, "content"), text(todo, "status"))));
    }
}

/// `items` replaces the plan; `done` (1-based) completes steps; `advance` completes
/// the step in progress and starts the next pending one; `start` starts a step.
fn update_plan(session: &mut Session, input: &Value) {
    if let Some(items) = input.get("items").and_then(Value::as_array) {
        session.set_plan(items.iter().map(|item| {
            let status = text(item, "status");
            (text(item, "content"), if status.is_empty() { "pending".into() } else { status })
        }));
    }
    let plan = &mut session.plan;
    let step = |number: &Value| number.as_u64().and_then(|n| usize::try_from(n).ok()).filter(|n| (1..=plan.len()).contains(n));
    let done: Vec<usize> = input.get("done").and_then(Value::as_array).into_iter().flatten().filter_map(step).collect();
    let start = input.get("start").and_then(step);
    for number in done {
        plan[number - 1].status = "completed".into();
    }
    if input.get("advance").and_then(Value::as_bool) == Some(true) {
        let current = plan.iter().position(|step| step.status == "in_progress");
        if let Some(index) = current {
            plan[index].status = "completed".into();
        }
        let from = current.map_or(0, |index| index + 1);
        if let Some(next) = plan.iter_mut().skip(from).find(|step| step.status == "pending") {
            next.status = "in_progress".into();
        }
    }
    if let Some(number) = start {
        plan[number - 1].status = "in_progress".into();
    }
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
        let (session, ends) = run(include_str!("fixtures/claude.jsonl"));
        assert_eq!(session.id, "11111111-2222-4333-8444-555555555555");
        assert_eq!(session.project, "D:\\Work\\demo-app");
        assert_eq!(session.title, "Demo task list");
        assert_eq!(session.fallback_title, "Add a settings page to the demo app");
        // Turn 1 wraps up with its last step never started; turn 2 ends while waiting.
        assert_eq!(ends.len(), 3, "the thinking line and the text line of the last reply both end the turn");
        assert_eq!(ends[0].steps, ["Write the docs"]);
        assert_eq!(ends[0].at, parse_time("2026-10-22T08:00:30.000Z"));
        assert!(ends[0].message.starts_with("The settings page is in."));
        assert_eq!(ends[1].steps, ["Run the browser tests", "Commit the change"]);
        assert_eq!(ends[1].message, "");
        assert_eq!(ends[2].message, "The browser tests are still running.\n\nTODO(user): Approve the release");
    }

    #[test]
    fn follows_update_plan_operations() {
        let mut session = Session::default();
        update_plan(&mut session, &serde_json::json!({ "items": [
            { "content": "A", "status": "in_progress" }, { "content": "B", "status": "pending" },
            { "content": "C", "status": "pending" }, { "content": "D" }
        ] }));
        update_plan(&mut session, &serde_json::json!({ "advance": true }));
        assert_eq!(session.end_turn(None, None).unwrap().steps, ["B", "C", "D"]);
        update_plan(&mut session, &serde_json::json!({ "done": [2, 9], "start": 4 }));
        assert_eq!(session.plan.iter().map(|step| step.status.as_str()).collect::<Vec<_>>(), ["completed", "completed", "pending", "in_progress"]);
        todo_write(&mut session, &serde_json::json!({ "todos": [{ "content": "E", "status": "completed", "activeForm": "Doing E" }] }));
        assert!(session.end_turn(None, None).unwrap().steps.is_empty());
    }

    #[test]
    fn ignores_side_chains_and_damaged_lines() {
        let (session, ends) = run(concat!(
            r#"{"type":"assistant","isSidechain":true,"message":{"id":"m","stop_reason":"end_turn","content":[{"type":"text","text":"You should not see this."}]}}"#,
            "\n{not json\n"
        ));
        assert!(ends.is_empty());
        assert_eq!(session, Session::default());
    }
}
