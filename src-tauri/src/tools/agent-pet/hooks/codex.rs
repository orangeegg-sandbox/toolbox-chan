//! Codex reads hooks from `~/.codex/config.toml` as `[[hooks.<Event>]]` matcher
//! groups with `[[hooks.<Event>.hooks]]` commands. Toolbox-Chan appends one
//! marked block at the end of the file, so the rest of the text (including the
//! `notify` line and other tools' marked blocks) is never rewritten. Codex asks
//! the user to review new hooks; it records approval under `hooks.state`, which
//! Toolbox-Chan only reads.

use super::{EventState, HOOK_TIMEOUT_SECONDS};
use crate::tools::agent_pet::hook_cli::FLAG;
use toml_edit::{DocumentMut, Item, Table};

/// Codex 0.163 hook events and the pet status each one reports.
pub const EVENTS: &[(&str, &str, &str)] = &[
    ("UserPromptSubmit", "user_prompt_submit", "working"),
    ("Stop", "stop", "done"),
    ("PermissionRequest", "permission_request", "needs-you"),
];

const BEGIN: &str = "# >>> Toolbox-Chan pet hooks >>>";
const END: &str = "# <<< Toolbox-Chan pet hooks <<<";

fn posix_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn powershell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

pub fn command(executable: &str, status: &str) -> String {
    format!("{} {FLAG} codex {status}", posix_quote(executable))
}

pub fn command_windows(executable: &str, status: &str) -> String {
    format!("& {} {FLAG} codex {status}", powershell_quote(executable))
}

fn toml_string(text: &str) -> String {
    toml_edit::Value::from(text).to_string().trim().to_owned()
}

fn is_ours(hook: &Table) -> bool {
    let marker = format!("{FLAG} codex ");
    ["command", "command_windows"].iter()
        .any(|key| hook.get(key).and_then(Item::as_str).is_some_and(|command| command.contains(&marker)))
}

pub fn parse(text: Option<&str>) -> Result<DocumentMut, String> {
    text.unwrap_or("").parse::<DocumentMut>()
        .map_err(|error| format!("The Codex config is not valid TOML ({}). Fix the file, then try again.", error.to_string().trim()))
}

/// For each event: the (group, hook) positions of Toolbox-Chan's hooks and their commands.
fn find(document: &DocumentMut, event: &str) -> Vec<(usize, usize, String)> {
    let Some(groups) = document.get("hooks").and_then(|hooks| hooks.get(event)).and_then(Item::as_array_of_tables) else {
        return Vec::new();
    };
    groups.iter().enumerate().flat_map(|(group, table)| {
        table.get("hooks").and_then(Item::as_array_of_tables).into_iter()
            .flat_map(|hooks| hooks.iter().enumerate())
            .filter(|(_, hook)| is_ours(hook))
            .map(move |(index, hook)| (group, index, hook.get("command").and_then(Item::as_str).unwrap_or("").to_owned()))
            .collect::<Vec<_>>()
    }).collect()
}

/// `config_path` is how Codex names this file in its hook review records.
pub fn status(document: &DocumentMut, executable: &str, config_path: &str) -> Vec<EventState> {
    EVENTS.iter().map(|(event, snake, status)| {
        let ours = find(document, event);
        let reviewed = ours.first().map(|(group, index, _)| {
            let key = format!("{config_path}:{snake}:{group}:{index}");
            document.get("hooks").and_then(|hooks| hooks.get("state")).and_then(|state| state.get(&key))
                .and_then(|record| record.get("trusted_hash")).is_some()
        });
        EventState {
            name: (*event).into(),
            status: (*status).into(),
            installed: !ours.is_empty(),
            current: ours.iter().any(|(_, _, command)| *command == self::command(executable, status)),
            reviewed,
        }
    }).collect()
}

fn block(executable: &str) -> String {
    let mut text = format!("{BEGIN}\n# Desktop pet status for Toolbox-Chan. Remove it from Toolbox-Chan's pet settings.\n");
    for (event, _, status) in EVENTS {
        text.push_str(&format!(
            "[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\ncommand_windows = {}\ntimeout = {HOOK_TIMEOUT_SECONDS}\n\n",
            toml_string(&command(executable, status)),
            toml_string(&command_windows(executable, status)),
        ));
    }
    text.push_str(END);
    text.push('\n');
    text
}

/// Adds Toolbox-Chan's hooks at the end of the file. Returns the new text, or `None` when nothing changes.
pub fn install(text: &str, executable: &str) -> Result<Option<String>, String> {
    let document = parse(Some(text))?;
    let current = EVENTS.iter().all(|(event, _, status)| {
        let ours = find(&document, event);
        ours.len() == 1 && ours[0].2 == command(executable, status)
    });
    if current {
        return Ok(None);
    }
    let mut base = remove(text)?.unwrap_or_else(|| text.to_owned());
    if !base.is_empty() && !base.ends_with('\n') {
        base.push('\n');
    }
    if !base.is_empty() {
        base.push('\n');
    }
    base.push_str(&block(executable));
    let result = parse(Some(&base)).map_err(|_| {
        "The Codex config defines hooks in a way Toolbox-Chan cannot add to. Add the hooks by hand.".to_string()
    })?;
    if EVENTS.iter().any(|(event, _, _)| find(&result, event).len() != 1) {
        return Err("The Codex config defines hooks in a way Toolbox-Chan cannot add to. Add the hooks by hand.".into());
    }
    Ok(Some(base))
}

/// Removes Toolbox-Chan's block, or its hooks if the block was edited. Returns `None` when nothing changes.
pub fn remove(text: &str) -> Result<Option<String>, String> {
    parse(Some(text))?;
    let mut result = text.to_owned();
    if let (Some(start), Some(end)) = (result.find(BEGIN), result.find(END)) {
        if start < end {
            let mut end = end + END.len();
            if result[end..].starts_with("\r\n") {
                end += 2;
            } else if result[end..].starts_with('\n') {
                end += 1;
            }
            let mut start = start;
            // Drop the blank line that `install` put in front of the block.
            if result[..start].ends_with("\n\n") {
                start -= 1;
            } else if result[..start].ends_with("\r\n\r\n") {
                start -= 2;
            }
            result.replace_range(start..end, "");
        }
    }
    let mut document = parse(Some(&result))?;
    if EVENTS.iter().any(|(event, _, _)| !find(&document, event).is_empty()) {
        remove_tables(&mut document);
        result = document.to_string();
    }
    Ok((result != text).then_some(result))
}

/// Fallback for a block that Codex or the user rewrote: drop only Toolbox-Chan's hook tables.
fn remove_tables(document: &mut DocumentMut) {
    let Some(hooks) = document.get_mut("hooks").and_then(Item::as_table_mut) else { return };
    for (event, _, _) in EVENTS {
        let Some(groups) = hooks.get_mut(event).and_then(Item::as_array_of_tables_mut) else { continue };
        for group in groups.iter_mut() {
            if let Some(list) = group.get_mut("hooks").and_then(Item::as_array_of_tables_mut) {
                list.retain(|hook| !is_ours(hook));
            }
        }
        groups.retain(|group| group.get("hooks").and_then(Item::as_array_of_tables).is_none_or(|list| !list.is_empty()));
        if groups.is_empty() {
            hooks.remove(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "C:/Users/Me/AppData/Local/Toolbox-Chan/little-toolbox.exe";
    const PATH: &str = "C:\\Users\\Me\\.codex\\config.toml";

    const EXISTING: &str = r#"model = "gpt-5.5"
notify = [ "C:\\Codex\\codex-computer-use.exe", "turn-ended" ]

[mcp_servers.memory]
command = "C:/cbm/codebase-memory-mcp.exe"
# >>> codebase-memory-mcp SessionStart >>>
[[hooks.SessionStart]]
matcher = "startup|resume|clear|compact"

[[hooks.SessionStart.hooks]]
type = "command"
command = "'C:/cbm/codebase-memory-mcp.exe' hook-augment"
command_windows = "& 'C:/cbm/codebase-memory-mcp.exe' hook-augment"
timeout = 5

[[hooks.SubagentStart]]
matcher = "*"

[[hooks.SubagentStart.hooks]]
type = "command"
command = "'C:/cbm/codebase-memory-mcp.exe' hook-augment"
timeout = 5

[hooks.state.'C:\Users\Me\.codex\config.toml:session_start:0:0']
trusted_hash = "sha256:e265"

[tui]
screen_reader_detection_done = true
# <<< codebase-memory-mcp SessionStart <<<
"#;

    #[test]
    fn appends_one_block_and_removes_it_exactly() {
        let installed = install(EXISTING, EXE).unwrap().unwrap();
        assert!(installed.starts_with(EXISTING), "the existing text is untouched");
        let document = parse(Some(&installed)).unwrap();
        assert!(status(&document, EXE, PATH).iter().all(|event| event.installed && event.current && event.reviewed == Some(false)));
        // Existing hooks and the notify line keep their values.
        assert_eq!(document["notify"].as_array().unwrap().len(), 2);
        assert_eq!(document["hooks"]["SessionStart"].as_array_of_tables().unwrap().len(), 1);
        assert_eq!(document["hooks"]["Stop"][0]["hooks"][0]["command_windows"].as_str(),
            Some("& 'C:/Users/Me/AppData/Local/Toolbox-Chan/little-toolbox.exe' --pet-hook codex done"));
        assert_eq!(install(&installed, EXE).unwrap(), None, "installing twice changes nothing");
        assert_eq!(remove(&installed).unwrap().as_deref(), Some(EXISTING));
        assert_eq!(remove(EXISTING).unwrap(), None);
    }

    #[test]
    fn reads_codex_review_records_for_its_own_hooks() {
        let installed = install(EXISTING, EXE).unwrap().unwrap();
        let reviewed = format!("{installed}\n[hooks.state.'{PATH}:stop:0:0']\ntrusted_hash = \"sha256:abc\"\n");
        let document = parse(Some(&reviewed)).unwrap();
        let states = status(&document, EXE, PATH);
        assert_eq!(states.iter().map(|event| event.reviewed).collect::<Vec<_>>(), [Some(false), Some(true), Some(false)]);
    }

    #[test]
    fn counts_its_group_after_existing_groups_of_the_same_event() {
        let existing = format!("{EXISTING}\n[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"say-done\"\n");
        let installed = install(&existing, EXE).unwrap().unwrap();
        let document = parse(Some(&installed)).unwrap();
        assert_eq!(find(&document, "Stop").iter().map(|(group, hook, _)| (*group, *hook)).collect::<Vec<_>>(), [(1, 0)]);
        assert_eq!(remove(&installed).unwrap().as_deref(), Some(existing.as_str()));
    }

    #[test]
    fn replaces_hooks_that_point_at_another_copy() {
        let old = install(EXISTING, "D:/old/little-toolbox.exe").unwrap().unwrap();
        assert!(status(&parse(Some(&old)).unwrap(), EXE, PATH).iter().all(|event| event.installed && !event.current));
        let new = install(&old, EXE).unwrap().unwrap();
        assert_eq!(new.matches(BEGIN).count(), 1);
        assert!(status(&parse(Some(&new)).unwrap(), EXE, PATH).iter().all(|event| event.current));
    }

    #[test]
    fn removes_hooks_from_a_rewritten_block() {
        let installed = install(EXISTING, EXE).unwrap().unwrap();
        let rewritten = installed.replace(BEGIN, "").replace(END, "");
        let removed = remove(&rewritten).unwrap().unwrap();
        let document = parse(Some(&removed)).unwrap();
        assert!(EVENTS.iter().all(|(event, _, _)| document["hooks"].get(event).is_none()));
        assert_eq!(document["hooks"]["SessionStart"].as_array_of_tables().unwrap().len(), 1);
        assert!(removed.contains("notify = [ \"C:\\\\Codex\\\\codex-computer-use.exe\", \"turn-ended\" ]"));
    }

    #[test]
    fn handles_empty_files_and_refuses_broken_ones() {
        let created = install("", EXE).unwrap().unwrap();
        assert!(created.starts_with(BEGIN));
        assert_eq!(remove(&created).unwrap().as_deref(), Some(""));
        assert!(install("model = ", EXE).is_err());
        assert!(install("hooks = 3\n", EXE).is_err());
        assert!(install("[hooks]\nStop = \"x\"\n", EXE).is_err());
    }

    #[test]
    fn quotes_paths_for_both_shells() {
        assert_eq!(command("C:/It's/app.exe", "done"), "'C:/It'\\''s/app.exe' --pet-hook codex done");
        assert_eq!(command_windows("C:/It's/app.exe", "done"), "& 'C:/It''s/app.exe' --pet-hook codex done");
    }
}
