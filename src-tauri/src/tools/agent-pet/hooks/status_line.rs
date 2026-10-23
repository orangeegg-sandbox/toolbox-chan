//! Wraps Claude Code's status line so its usage limits reach the pets (see
//! `limits/status_line.rs`). `statusLine.command` becomes
//! `"<exe>" --pet-status-line <the user's command, encoded>`; removing puts the
//! user's command back. Every other key, including the rest of `statusLine`, is
//! left exactly as it was.

use super::{claude, files};
use crate::tools::agent_pet::limits::status_line::{decode, encode, FLAG};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusLineState {
    pub path: String,
    /// `installed`, `outdated` (points at another copy), `missing`, or `error`.
    pub state: &'static str,
    /// The user's own status line command: the one wrapped, or the one that would be.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrapped: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn command(executable: &str, original: &str) -> String {
    if original.trim().is_empty() {
        format!("\"{executable}\" {FLAG}")
    } else {
        format!("\"{executable}\" {FLAG} {}", encode(original))
    }
}

/// The executable and the user's command inside a wrapper command, or `None` for any other command.
fn unwrap(command: &str) -> Option<(String, String)> {
    let rest = command.trim().strip_prefix('"')?;
    let (executable, rest) = rest.split_once('"')?;
    let encoded = rest.trim_start().strip_prefix(FLAG)?;
    if !encoded.is_empty() && !encoded.starts_with(' ') {
        return None;
    }
    Some((executable.to_owned(), decode(encoded.trim())?))
}

fn current(settings: &Value) -> Result<Option<&str>, String> {
    match settings.get("statusLine") {
        None | Some(Value::Null) => Ok(None),
        Some(line) if line["type"] == json!("command") => line["command"].as_str().map(Some)
            .ok_or_else(|| "The Claude Code \"statusLine\" has no command.".to_string()),
        Some(_) => Err("The Claude Code \"statusLine\" is not a command, so Toolbox-Chan cannot wrap it.".into()),
    }
}

pub fn state(path: &Path, executable: &str) -> StatusLineState {
    let backup = files::backup_path(path);
    let mut state = StatusLineState {
        path: path.display().to_string(),
        state: "missing",
        wrapped: None,
        backup: backup.exists().then(|| backup.display().to_string()),
        error: None,
    };
    let read = files::read(path).and_then(|text| claude::parse(text.as_deref())).and_then(|settings| current(&settings).map(|line| line.map(str::to_owned)));
    match read {
        Err(error) => {
            state.state = "error";
            state.error = Some(error);
        }
        Ok(None) => {}
        Ok(Some(line)) => match unwrap(&line) {
            Some((wrapper, original)) => {
                state.state = if wrapper == executable { "installed" } else { "outdated" };
                state.wrapped = Some(original).filter(|original| !original.trim().is_empty());
            }
            None => state.wrapped = Some(line),
        },
    }
    state
}

/// Wraps the user's status line, or refreshes the wrapper to point at this copy of Toolbox-Chan.
pub fn wrap(settings: &mut Value, executable: &str) -> Result<(), String> {
    let original = match current(settings)? {
        Some(line) => unwrap(line).map(|(_, original)| original).unwrap_or_else(|| line.to_owned()),
        None => String::new(),
    };
    let root = settings.as_object_mut().ok_or("The Claude Code settings file must contain a JSON object.")?;
    let line = root.entry("statusLine").or_insert_with(|| json!({ "type": "command" }));
    if line.is_null() {
        *line = json!({ "type": "command" });
    }
    line["command"] = json!(command(executable, &original));
    Ok(())
}

/// Puts the user's command back, or removes the status line Toolbox-Chan added when there was none.
pub fn unwrap_settings(settings: &mut Value) -> Result<(), String> {
    let Some((_, original)) = current(settings)?.and_then(unwrap) else { return Ok(()) };
    if original.trim().is_empty() {
        settings.as_object_mut().map(|root| root.shift_remove("statusLine"));
    } else {
        settings["statusLine"]["command"] = json!(original);
    }
    Ok(())
}

fn edit(path: &Path, change: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let original = files::read(path)?;
    let mut settings = claude::parse(original.as_deref())?;
    let before = settings.clone();
    change(&mut settings)?;
    if settings != before {
        files::back_up_once(path)?;
        files::write_atomically(path, &claude::render(&settings, original.as_deref())?)?;
    }
    Ok(())
}

pub fn install(path: &Path, executable: &str) -> Result<(), String> {
    edit(path, |settings| wrap(settings, executable))
}

pub fn remove(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    edit(path, unwrap_settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "C:/Apps/Toolbox-Chan/little-toolbox.exe";
    const MINE: &str = "\"C:/Users/PC/AppData/Local/nvm/node.exe\" D:/Personal/agents-studio/dist/cli.js statusline";

    #[test]
    fn wraps_the_users_status_line_and_puts_it_back() {
        let original = json!({ "model": "opus", "statusLine": { "type": "command", "command": MINE, "padding": 0 }, "hooks": {} });
        let mut settings = original.clone();
        wrap(&mut settings, EXE).unwrap();
        let wrapped = settings["statusLine"]["command"].as_str().unwrap().to_owned();
        assert!(wrapped.starts_with(&format!("\"{EXE}\" --pet-status-line ")));
        assert_eq!(unwrap(&wrapped), Some((EXE.to_owned(), MINE.to_owned())));
        assert_eq!(settings["statusLine"]["padding"], json!(0));
        // Wrapping twice does not wrap the wrapper; a new copy only changes the executable.
        wrap(&mut settings, EXE).unwrap();
        assert_eq!(settings["statusLine"]["command"], json!(wrapped));
        wrap(&mut settings, "D:/New/little-toolbox.exe").unwrap();
        assert_eq!(unwrap(settings["statusLine"]["command"].as_str().unwrap()), Some(("D:/New/little-toolbox.exe".into(), MINE.into())));
        unwrap_settings(&mut settings).unwrap();
        assert_eq!(settings, original);
    }

    #[test]
    fn adds_and_removes_a_status_line_when_there_was_none() {
        let mut settings = json!({ "model": "opus" });
        wrap(&mut settings, EXE).unwrap();
        assert_eq!(settings["statusLine"], json!({ "type": "command", "command": format!("\"{EXE}\" --pet-status-line") }));
        unwrap_settings(&mut settings).unwrap();
        assert_eq!(settings, json!({ "model": "opus" }));
    }

    #[test]
    fn leaves_other_status_lines_alone() {
        let mut settings = json!({ "statusLine": { "type": "static", "text": "hi" } });
        assert!(wrap(&mut settings, EXE).is_err());
        let mut foreign = json!({ "statusLine": { "type": "command", "command": MINE } });
        unwrap_settings(&mut foreign).unwrap();
        assert_eq!(foreign["statusLine"]["command"], json!(MINE));
        assert_eq!(unwrap("\"x.exe\" --pet-status-lineXYZ"), None);
    }

    #[test]
    fn reports_and_edits_a_copy_of_the_settings_file() {
        let home = std::env::temp_dir().join(format!("toolbox-chan-status-line-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let path = home.join("settings.json");
        let text = format!("{{\n  \"statusLine\": {{\n    \"type\": \"command\",\n    \"command\": {}\n  }}\n}}\n", json!(MINE));
        std::fs::write(&path, &text).unwrap();
        assert_eq!(state(&path, EXE), StatusLineState { path: path.display().to_string(), state: "missing", wrapped: Some(MINE.into()), backup: None, error: None });
        install(&path, EXE).unwrap();
        let installed = state(&path, EXE);
        assert_eq!((installed.state, installed.wrapped.as_deref()), ("installed", Some(MINE)));
        assert!(installed.backup.is_some());
        assert_eq!(state(&path, "D:/Other/little-toolbox.exe").state, "outdated");
        remove(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        std::fs::write(&path, "{ broken").unwrap();
        assert_eq!(state(&path, EXE).state, "error");
        assert!(install(&path, EXE).is_err());
        assert!(remove(&home.join("missing.json")).is_ok());
        let _ = std::fs::remove_dir_all(home);
    }
}
