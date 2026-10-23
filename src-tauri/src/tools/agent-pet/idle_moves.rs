//! Idle moves the user adds: a folder with `move.json` and `<name>-<n>.png`
//! frames (format in `docs/design/agent-pets/idle-moves.md`). A move is checked
//! before it is copied into the app data folder, and checked again when read,
//! so a damaged copy is skipped rather than shown. Frames reach the pet window
//! as data URLs, so the window needs no file access.

use crate::platform::pet_events::AgentId;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub const CHANGED_EVENT: &str = "agent-pet-idle-moves";
const MAX_FRAMES: usize = 24;
const MAX_FRAME_BYTES: u64 = 1024 * 1024;
const MAX_INFO_BYTES: u64 = 16 * 1024;
const FRAME_SIZE: u32 = 256;
const MAX_LABEL: usize = 40;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveFile {
    format: u32,
    agent: AgentId,
    name: String,
    #[serde(default)]
    label: Option<String>,
    fps: u32,
    loops: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdleMove {
    pub agent: AgentId,
    pub name: String,
    pub label: String,
    pub fps: u32,
    pub loops: u32,
    /// PNG frames in order, as data URLs.
    pub frames: Vec<String>,
}

/// A checked move folder: its fields and its frame files in order.
#[derive(Debug, PartialEq)]
pub struct Checked {
    pub agent: AgentId,
    pub name: String,
    pub label: String,
    pub fps: u32,
    pub loops: u32,
    pub frames: Vec<PathBuf>,
}

fn agent_key(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "claude",
        AgentId::Codex => "codex",
        AgentId::Deepseek => "deepseek",
    }
}

pub fn valid_name(name: &str) -> bool {
    let mut characters = name.chars();
    characters.next().is_some_and(|first| first.is_ascii_lowercase())
        && name.len() <= 24
        && characters.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

/// Width and height from a PNG's header, or why it is not a PNG.
fn png_size(bytes: &[u8]) -> Result<(u32, u32), &'static str> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err("is not a PNG image");
    }
    let number = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Ok((number(16), number(20)))
}

/// Checks a move folder against the format. The error says what to fix.
pub fn check(folder: &Path) -> Result<Checked, String> {
    let info_path = folder.join("move.json");
    let size = fs::metadata(&info_path).map_err(|_| "The folder has no move.json.".to_string())?.len();
    if size > MAX_INFO_BYTES {
        return Err("move.json is too large.".into());
    }
    let text = fs::read_to_string(&info_path).map_err(|error| format!("Could not read move.json: {error}"))?;
    let info: MoveFile = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("move.json does not follow the format: {error}"))?;
    if info.format != 1 {
        return Err("move.json must have \"format\": 1.".into());
    }
    if !valid_name(&info.name) {
        return Err("The move's name must be 1–24 lowercase letters or digits, starting with a letter.".into());
    }
    if !(1..=24).contains(&info.fps) {
        return Err("\"fps\" must be a whole number from 1 to 24.".into());
    }
    if !(1..=10).contains(&info.loops) {
        return Err("\"loops\" must be a whole number from 1 to 10.".into());
    }
    let label = info.label.as_deref().map(str::trim).filter(|label| !label.is_empty()).unwrap_or(&info.name).to_owned();
    if label.chars().count() > MAX_LABEL || label.chars().any(char::is_control) {
        return Err(format!("\"label\" must be at most {MAX_LABEL} characters on one line."));
    }
    let mut frames = Vec::new();
    while frames.len() < MAX_FRAMES {
        let path = folder.join(format!("{}-{}.png", info.name, frames.len() + 1));
        if !path.is_file() {
            break;
        }
        frames.push(path);
    }
    if frames.is_empty() {
        return Err(format!("The folder has no {}-1.png.", info.name));
    }
    // Any other frame of this move means a gap in the numbering, or too many frames.
    let prefix = format!("{}-", info.name);
    let stray = fs::read_dir(folder).map_err(|error| error.to_string())?.flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .find(|file| file.starts_with(&prefix) && file.ends_with(".png") && !frames.iter().any(|frame| frame.file_name().is_some_and(|name| name == file.as_str())));
    if let Some(file) = stray {
        return Err(format!("{file} does not follow the frames before it: number frames from 1 with no gaps, at most {MAX_FRAMES}."));
    }
    for frame in &frames {
        let name = frame.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let bytes = fs::metadata(frame).map(|metadata| metadata.len()).unwrap_or(u64::MAX);
        if bytes > MAX_FRAME_BYTES {
            return Err(format!("{name} is larger than 1 MB."));
        }
        let data = fs::read(frame).map_err(|error| format!("Could not read {name}: {error}"))?;
        let (width, height) = png_size(&data).map_err(|reason| format!("{name} {reason}."))?;
        if (width, height) != (FRAME_SIZE, FRAME_SIZE) {
            return Err(format!("{name} is {width}×{height}; frames must be exactly {FRAME_SIZE}×{FRAME_SIZE}."));
        }
    }
    Ok(Checked { agent: info.agent, name: info.name, label, fps: info.fps, loops: info.loops, frames })
}

/// Standard base64, for data URLs.
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                text.push(TABLE[((value >> (18 - 6 * index)) & 63) as usize] as char);
            } else {
                text.push('=');
            }
        }
    }
    text
}

fn load(checked: Checked) -> Result<IdleMove, String> {
    let frames = checked.frames.iter()
        .map(|frame| fs::read(frame).map(|bytes| format!("data:image/png;base64,{}", base64(&bytes))).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(IdleMove { agent: checked.agent, name: checked.name, label: checked.label, fps: checked.fps, loops: checked.loops, frames })
}

/// Every stored move that still passes the checks, sorted by agent and name.
pub fn list(root: &Path) -> Vec<IdleMove> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut moves: Vec<IdleMove> = entries.flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| check(&entry.path()).ok())
        .filter_map(|checked| load(checked).ok())
        .collect();
    moves.sort_by(|a, b| (agent_key(a.agent), &a.name).cmp(&(agent_key(b.agent), &b.name)));
    moves
}

/// Copies a checked move into `root/<agent>-<name>/`, replacing an earlier copy of the same move.
pub fn store(root: &Path, source: &Path) -> Result<IdleMove, String> {
    let checked = check(source)?;
    let target = root.join(format!("{}-{}", agent_key(checked.agent), checked.name));
    let temporary = root.join(format!(".adding-{}-{}", agent_key(checked.agent), std::process::id()));
    let _ = fs::remove_dir_all(&temporary);
    let copy = || -> std::io::Result<()> {
        fs::create_dir_all(&temporary)?;
        fs::copy(source.join("move.json"), temporary.join("move.json"))?;
        for frame in &checked.frames {
            fs::copy(frame, temporary.join(frame.file_name().unwrap_or_default()))?;
        }
        if target.exists() {
            fs::remove_dir_all(&target)?;
        }
        fs::rename(&temporary, &target)
    };
    if let Err(error) = copy() {
        let _ = fs::remove_dir_all(&temporary);
        return Err(format!("Could not save the move: {error}"));
    }
    load(check(&target)?)
}

pub fn remove(root: &Path, agent: AgentId, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("That is not an idle move's name.".into());
    }
    let target = root.join(format!("{}-{name}", agent_key(agent)));
    match fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove the move: {error}")),
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("tools").join("agent-pet").join("idle-moves"))
}

#[tauri::command]
pub async fn agent_pet_idle_moves(app: AppHandle) -> Result<Vec<IdleMove>, String> {
    Ok(list(&root(&app)?))
}

/// Asks for a move folder, then checks and stores it. `None` when the user cancels.
#[tauri::command]
pub async fn agent_pet_import_idle_move(app: AppHandle) -> Result<Option<IdleMove>, String> {
    let picker = app.clone();
    let folder = tauri::async_runtime::spawn_blocking(move || picker.dialog().file().set_title("Choose an idle move folder").blocking_pick_folder())
        .await
        .map_err(|_| "The folder dialog could not be opened.".to_string())?;
    let Some(folder) = folder else { return Ok(None) };
    let folder = folder.into_path().map_err(|_| "Please choose a folder on this computer.".to_string())?;
    let root = root(&app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let stored = store(&root, &folder)?;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(Some(stored))
}

#[tauri::command]
pub async fn agent_pet_remove_idle_move(app: AppHandle, agent: AgentId, name: String) -> Result<(), String> {
    remove(&root(&app)?, agent, &name)?;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("toolbox-chan-idle-moves-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    /// A PNG header claiming the given size; enough for the checks, which read only the header.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    fn write_move(folder: &Path, info: &str, frames: &[(&str, Vec<u8>)]) {
        fs::create_dir_all(folder).unwrap();
        fs::write(folder.join("move.json"), info).unwrap();
        for (name, bytes) in frames {
            fs::write(folder.join(name), bytes).unwrap();
        }
    }

    const INFO: &str = r#"{ "format": 1, "agent": "codex", "name": "wave", "label": "Wave", "fps": 6, "loops": 2 }"#;

    #[test]
    fn stores_lists_and_removes_a_valid_move() {
        let base = scratch("valid");
        let source = base.join("source");
        write_move(&source, INFO, &[("wave-1.png", png(256, 256)), ("wave-2.png", png(256, 256)), ("notes.txt", b"hi".to_vec())]);
        let root = base.join("store");
        fs::create_dir_all(&root).unwrap();
        let stored = store(&root, &source).unwrap();
        assert_eq!((stored.agent, stored.name.as_str(), stored.label.as_str(), stored.fps, stored.loops), (AgentId::Codex, "wave", "Wave", 6, 2));
        assert_eq!(stored.frames.len(), 2);
        assert!(stored.frames[0].starts_with("data:image/png;base64,iVBORw0KGgo"));
        assert!(!root.join("codex-wave").join("notes.txt").exists(), "only the move's own files are copied");
        // Adding it again replaces the copy.
        write_move(&source, INFO, &[("wave-3.png", png(256, 256))]);
        store(&root, &source).unwrap();
        assert_eq!(list(&root).iter().map(|found| found.frames.len()).collect::<Vec<_>>(), [3]);
        remove(&root, AgentId::Codex, "wave").unwrap();
        assert!(list(&root).is_empty());
        assert!(remove(&root, AgentId::Codex, "../evil").is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_folders_that_break_the_format() {
        let base = scratch("broken");
        let cases: [(&str, &str, Vec<(&str, Vec<u8>)>, &str); 8] = [
            ("no-info", "", vec![], "no move.json"),
            ("bad-json", "{", vec![], "does not follow the format"),
            ("format", r#"{ "format": 2, "agent": "codex", "name": "wave", "fps": 6, "loops": 1 }"#, vec![], "format"),
            ("agent", r#"{ "format": 1, "agent": "gemini", "name": "wave", "fps": 6, "loops": 1 }"#, vec![], "does not follow the format"),
            ("name", r#"{ "format": 1, "agent": "codex", "name": "Wave Hi", "fps": 6, "loops": 1 }"#, vec![], "lowercase"),
            ("gap", INFO, vec![("wave-1.png", png(256, 256)), ("wave-3.png", png(256, 256))], "wave-3.png does not follow"),
            ("size", INFO, vec![("wave-1.png", png(512, 512))], "512×512"),
            ("not-png", INFO, vec![("wave-1.png", b"GIF89a....................".to_vec())], "not a PNG"),
        ];
        for (name, info, frames, reason) in cases {
            let folder = base.join(name);
            fs::create_dir_all(&folder).unwrap();
            if !info.is_empty() {
                write_move(&folder, info, &frames);
            }
            let error = check(&folder).unwrap_err();
            assert!(error.contains(reason), "{name}: {error}");
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn encodes_base64_like_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
