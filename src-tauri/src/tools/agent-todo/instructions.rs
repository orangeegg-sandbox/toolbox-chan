//! Adds, shows, and removes the one instruction line that asks an agent to write
//! follow-ups as `TODO(user): ...`. Each file is backed up before a change, and
//! every other line in it is kept exactly as it was.

use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};

pub const LINE: &str = "When you leave a follow-up for the user, write it on its own line as `TODO(user): ...`";
const BACKUP_SUFFIX: &str = ".agent-todo.bak";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuleStatus {
    pub path: String,
    /// The agent's own folder exists, so it is installed and the file may be created.
    pub folder_found: bool,
    pub exists: bool,
    pub present: bool,
}

pub fn status(path: &Path) -> RuleStatus {
    let content = fs::read(path).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    RuleStatus {
        path: path.display().to_string(),
        folder_found: path.parent().is_some_and(Path::is_dir),
        exists: content.is_some(),
        present: content.as_deref().is_some_and(has_line),
    }
}

pub fn backup_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{name}{BACKUP_SUFFIX}"))
}

fn has_line(content: &str) -> bool {
    content.lines().any(|line| line.trim() == LINE)
}

/// The content with the line appended, or `None` when it is already there.
pub fn with_line(content: &str) -> Option<String> {
    if has_line(content) {
        return None;
    }
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut result = content.to_string();
    if !result.is_empty() && !result.ends_with('\n') {
        result.push_str(newline);
    }
    if !result.trim_start_matches('\u{feff}').is_empty() {
        result.push_str(newline);
    }
    result.push_str(LINE);
    result.push_str(newline);
    Some(result)
}

/// The content without the line, or `None` when it is not there. A blank line
/// that only separated the instruction from the text above goes with it.
pub fn without_line(content: &str) -> Option<String> {
    if !has_line(content) {
        return None;
    }
    let mut lines: Vec<&str> = content.split_inclusive('\n').collect();
    while let Some(index) = lines.iter().position(|line| line.trim() == LINE) {
        lines.remove(index);
        let next_is_blank_or_end = lines.get(index).is_none_or(|line| line.trim().is_empty());
        if index > 0 && lines[index - 1].trim().is_empty() && next_is_blank_or_end {
            lines.remove(index - 1);
        }
    }
    Some(lines.concat())
}

/// Adds the line. Returns false when it was already there.
pub fn add(path: &Path) -> Result<bool, String> {
    change(path, with_line)
}

/// Removes the line. Returns false when it was not there.
pub fn remove(path: &Path) -> Result<bool, String> {
    change(path, without_line)
}

fn change(path: &Path, edit: fn(&str) -> Option<String>) -> Result<bool, String> {
    let folder = path.parent().filter(|folder| folder.is_dir())
        .ok_or_else(|| format!("{} was not found. Is the agent installed?", path.parent().unwrap_or(path).display()))?;
    let original = match fs::read(path) {
        Ok(bytes) => Some(String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text, so it was left alone.", path.display()))?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Could not read {}: {error}", path.display())),
    };
    let Some(updated) = edit(original.as_deref().unwrap_or_default()) else { return Ok(false) };
    if original.is_some() {
        fs::copy(path, backup_path(path)).map_err(|error| format!("Could not back up {}: {error}", path.display()))?;
    }
    let temporary = folder.join(format!(".{}.agent-todo.tmp", path.file_name().unwrap_or_default().to_string_lossy()));
    fs::write(&temporary, updated).and_then(|()| fs::rename(&temporary, path))
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("agent-todo-rules-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn adds_and_removes_only_its_line() {
        let original = "# My rules\r\n\r\nUse tabs.\r\n<!-- other-tool:start -->\r\nKeep this.\r\n<!-- other-tool:end -->";
        let added = with_line(original).unwrap();
        assert_eq!(added, format!("{original}\r\n\r\n{LINE}\r\n"));
        assert_eq!(with_line(&added), None, "adding twice changes nothing");
        assert_eq!(without_line(&added).unwrap(), format!("{original}\r\n"));
        assert_eq!(without_line(original), None);

        assert_eq!(with_line("").unwrap(), format!("{LINE}\n"));
        assert_eq!(without_line(&format!("{LINE}\n")).unwrap(), "");
        let middle = format!("Top\n\n{LINE}\n\nBottom\n");
        assert_eq!(without_line(&middle).unwrap(), "Top\n\nBottom\n");
    }

    #[test]
    fn edits_a_copy_and_backs_it_up_first() {
        let folder = temporary_folder("edit");
        let file = folder.join("AGENTS.md");
        fs::write(&file, "Keep me.\n").unwrap();
        assert!(!status(&file).present);
        assert!(add(&file).unwrap());
        assert!(!add(&file).unwrap());
        assert_eq!(fs::read_to_string(backup_path(&file)).unwrap(), "Keep me.\n");
        assert_eq!(status(&file), RuleStatus { path: file.display().to_string(), folder_found: true, exists: true, present: true });
        assert!(remove(&file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "Keep me.\n");
        assert_eq!(fs::read_to_string(backup_path(&file)).unwrap(), format!("Keep me.\n\n{LINE}\n"));
        assert!(!remove(&file).unwrap());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn creates_a_missing_file_but_not_a_missing_agent_folder() {
        let folder = temporary_folder("create");
        let file = folder.join("CLAUDE.md");
        assert!(add(&file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), format!("{LINE}\n"));
        assert!(!backup_path(&file).exists(), "there was nothing to back up");
        let missing = folder.join("not-installed").join("AGENTS.md");
        assert!(add(&missing).is_err());
        assert!(!status(&missing).folder_found);
        fs::write(folder.join("binary.md"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(add(&folder.join("binary.md")).is_err());
        let _ = fs::remove_dir_all(folder);
    }
}
