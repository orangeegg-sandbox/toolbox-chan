//! Claude Code reads hooks from `~/.claude/settings.json`: `hooks.<Event>` is a
//! list of matcher groups, each with its own list of commands. Toolbox-Chan adds
//! one group per event and recognises its commands by `--pet-hook claude`.
//! Every other key, group, and hook is left exactly as it was.

use super::{EventState, HOOK_TIMEOUT_SECONDS};
use crate::tools::agent_pet::hook_cli::FLAG;
use serde_json::{json, Map, Value};

/// Claude Code hook events and the pet status each one reports.
pub const EVENTS: &[(&str, &str)] = &[("UserPromptSubmit", "working"), ("Stop", "done"), ("Notification", "needs-you")];

pub fn command(executable: &str, status: &str) -> String {
    format!("\"{executable}\" {FLAG} claude {status}")
}

fn is_ours(hook: &Value) -> bool {
    hook["command"].as_str().is_some_and(|command| command.contains(&format!("{FLAG} claude ")))
}

pub fn parse(text: Option<&str>) -> Result<Value, String> {
    match text.map(str::trim) {
        None | Some("") => Ok(Value::Object(Map::new())),
        Some(text) => {
            let value: Value = serde_json::from_str(text)
                .map_err(|error| format!("The Claude Code settings are not valid JSON ({error}). Fix the file, then try again."))?;
            if value.is_object() { Ok(value) } else { Err("The Claude Code settings file must contain a JSON object.".into()) }
        }
    }
}

pub fn render(settings: &Value, original: Option<&str>) -> Result<String, String> {
    let mut text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    if original.is_none_or(|original| original.ends_with('\n')) {
        text.push('\n');
    }
    Ok(text)
}

pub fn status(settings: &Value, executable: &str) -> Vec<EventState> {
    EVENTS.iter().map(|(event, status)| {
        let ours: Vec<&Value> = settings["hooks"][event].as_array().into_iter().flatten()
            .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
            .filter(|hook| is_ours(hook))
            .collect();
        EventState {
            name: (*event).into(),
            status: (*status).into(),
            installed: !ours.is_empty(),
            current: ours.iter().any(|hook| hook["command"].as_str() == Some(command(executable, status).as_str())),
            reviewed: None,
        }
    }).collect()
}

/// Adds (or refreshes) Toolbox-Chan's hook for every event, keeping all other hooks.
pub fn install(settings: &mut Value, executable: &str) -> Result<(), String> {
    let root = settings.as_object_mut().ok_or("The Claude Code settings file must contain a JSON object.")?;
    let hooks = root.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let hooks = hooks.as_object_mut().ok_or("The Claude Code \"hooks\" setting must be an object.")?;
    for (event, status) in EVENTS {
        let wanted = command(executable, status);
        let groups = hooks.entry(*event).or_insert_with(|| Value::Array(Vec::new()));
        let groups = groups.as_array_mut().ok_or_else(|| format!("The Claude Code \"{event}\" hooks must be a list."))?;
        let ours: Vec<&str> = groups.iter()
            .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
            .filter(|hook| is_ours(hook))
            .filter_map(|hook| hook["command"].as_str())
            .collect();
        if ours == [wanted.as_str()] {
            continue;
        }
        remove_from(groups);
        groups.push(json!({ "hooks": [{ "type": "command", "command": wanted, "timeout": HOOK_TIMEOUT_SECONDS }] }));
    }
    Ok(())
}

/// Removes only Toolbox-Chan's hooks, and only the groups and lists that become empty because of it.
pub fn remove(settings: &mut Value) -> Result<(), String> {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return Ok(()) };
    let mut changed = false;
    hooks.retain(|_, groups| {
        let Some(list) = groups.as_array_mut() else { return true };
        if !remove_from(list) {
            return true;
        }
        changed = true;
        !list.is_empty()
    });
    if changed && hooks.is_empty() {
        settings.as_object_mut().map(|root| root.shift_remove("hooks"));
    }
    Ok(())
}

/// Returns whether anything was removed.
fn remove_from(groups: &mut Vec<Value>) -> bool {
    let mut removed = false;
    groups.retain_mut(|group| {
        let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
        let before = list.len();
        list.retain(|hook| !is_ours(hook));
        if list.len() == before {
            return true;
        }
        removed = true;
        !list.is_empty()
    });
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "C:/Program Files/Toolbox-Chan/little-toolbox.exe";

    fn existing() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [{ "matcher": "Grep|Glob|Bash", "hooks": [{ "type": "command", "command": "C:/cbm/codebase-memory-mcp.exe", "args": ["hook-augment"], "timeout": 5 }] }],
                "SessionStart": [{ "matcher": "startup", "hooks": [{ "type": "command", "command": "C:/cbm/codebase-memory-mcp.exe", "args": ["hook-augment"], "timeout": 5 }] }],
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"node.exe\" cli.js news --from-hook --agent claude", "timeout": 10 }] }]
            },
            "statusLine": { "type": "command", "command": "status.exe" }
        })
    }

    #[test]
    fn installs_next_to_existing_hooks_and_removes_cleanly() {
        let original = existing();
        let mut settings = original.clone();
        install(&mut settings, EXE).unwrap();
        assert!(status(&settings, EXE).iter().all(|event| event.installed && event.current));
        // The existing UserPromptSubmit hook stays first; ours is a new group after it.
        let prompt = settings["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(prompt.len(), 2);
        assert_eq!(prompt[0], original["hooks"]["UserPromptSubmit"][0]);
        assert_eq!(prompt[1]["hooks"][0]["command"], json!(format!("\"{EXE}\" --pet-hook claude working")));
        assert_eq!(settings["hooks"]["Stop"][0]["hooks"][0]["command"], json!(format!("\"{EXE}\" --pet-hook claude done")));
        assert_eq!(settings["hooks"]["Notification"][0]["hooks"][0]["command"], json!(format!("\"{EXE}\" --pet-hook claude needs-you")));
        assert_eq!(settings["hooks"]["PreToolUse"], original["hooks"]["PreToolUse"]);
        assert_eq!(settings["statusLine"], original["statusLine"]);

        let once = settings.clone();
        install(&mut settings, EXE).unwrap();
        assert_eq!(settings, once, "installing twice adds nothing");

        remove(&mut settings).unwrap();
        assert_eq!(settings, original);
        // Key order is part of the user's file; it must survive the round trip.
        assert_eq!(render(&settings, Some("x\n")).unwrap(), render(&original, Some("x\n")).unwrap());
        assert!(status(&settings, EXE).iter().all(|event| !event.installed));
    }

    #[test]
    fn refreshes_a_hook_that_points_at_another_copy() {
        let mut settings = existing();
        install(&mut settings, "D:/old/little-toolbox.exe").unwrap();
        assert!(status(&settings, EXE).iter().all(|event| event.installed && !event.current));
        install(&mut settings, EXE).unwrap();
        assert!(status(&settings, EXE).iter().all(|event| event.installed && event.current));
        assert_eq!(settings["hooks"]["Stop"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn keeps_foreign_hooks_that_share_a_group_with_ours() {
        let mut settings = json!({ "hooks": { "Stop": [{ "hooks": [
            { "type": "command", "command": command(EXE, "done") },
            { "type": "command", "command": "notify-me.exe" }
        ] }] } });
        remove(&mut settings).unwrap();
        assert_eq!(settings, json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "notify-me.exe" }] }] } }));
    }

    #[test]
    fn creates_settings_and_removes_what_it_created() {
        let mut settings = parse(None).unwrap();
        install(&mut settings, EXE).unwrap();
        assert_eq!(settings["hooks"].as_object().unwrap().len(), 3);
        remove(&mut settings).unwrap();
        assert_eq!(settings, json!({}));
    }

    #[test]
    fn refuses_files_it_cannot_edit_safely() {
        assert!(parse(Some("{ \"hooks\": ")).is_err());
        assert!(parse(Some("[1, 2]")).is_err());
        let mut wrong = json!({ "hooks": [] });
        assert!(install(&mut wrong, EXE).is_err());
        let mut wrong = json!({ "hooks": { "Stop": {} } });
        assert!(install(&mut wrong, EXE).is_err());
        assert_eq!(parse(Some("\n  ")).unwrap(), json!({}));
    }
}
