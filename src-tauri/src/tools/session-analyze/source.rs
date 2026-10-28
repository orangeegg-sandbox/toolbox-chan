//! Bounded local discovery and reading. Catalog previews never invoke the analyzer.
use super::model::{SessionCatalog, SessionPreview, SessionSource};
use ruzstd::decoding::{BlockDecodingStrategy, FrameDecoder};
use serde_json::Value;
use std::{collections::HashMap, fs::{self, File}, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}, time::UNIX_EPOCH};

const HEAD_BYTES: usize = 64 * 1024;
const MAX_STORED: usize = 256 * 1024 * 1024;
const MAX_DECODED: usize = 64 * 1024 * 1024;
const MAX_SESSIONS: usize = 5_000;

#[derive(Clone)]
pub struct SourceRoot { pub agent: String, pub home: PathBuf, pub sessions: PathBuf }

pub fn roots() -> Result<Vec<SourceRoot>, String> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).ok_or("User home folder is unavailable.")?;
    Ok([("codex", "CODEX_HOME", ".codex", "sessions"), ("claude", "CLAUDE_CONFIG_DIR", ".claude", "projects"), ("dsh", "DSH_HOME", ".dsh", "sessions")].into_iter().map(|(agent, variable, default, folder)| {
        let home = std::env::var_os(variable).filter(|value| !value.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(default));
        SourceRoot { agent: agent.into(), sessions: home.join(folder), home }
    }).collect())
}

fn supported(agent: &str, path: &Path) -> bool {
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    match agent {
        "codex" => name.starts_with("rollout-") && name.ends_with(".jsonl"),
        "claude" => name.ends_with(".jsonl"),
        "dsh" => name == "session.v4.jsonl.zstd",
        _ => false,
    }
}

pub(super) fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return true; }
    }
    metadata.file_type().is_symlink()
}

pub fn authorize(roots: &[SourceRoot], agent: &str, path: &str) -> Result<PathBuf, String> {
    let root = roots.iter().find(|root| root.agent == agent).ok_or("Unsupported agent platform.")?;
    let requested = Path::new(path);
    if !requested.is_absolute() || !supported(agent, requested) { return Err("Select a supported local session from the catalog.".into()); }
    let base = fs::canonicalize(&root.sessions).map_err(|error| format!("Session folder is unavailable: {error}"))?;
    let path = fs::canonicalize(requested).map_err(|error| format!("Session file is unavailable: {error}"))?;
    if !path.starts_with(&base) || !path.is_file() { return Err("Session path is outside the selected agent's session folder.".into()); }
    Ok(path)
}

fn bounded_read(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit as u64).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

// ruzstd's first-frame constructor does not enforce its reset window cap. Check
// the serialized window descriptor before constructing the decoder.
fn window_size(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 6 || bytes[..4] != [0x28, 0xb5, 0x2f, 0xfd] { return None; }
    let desc = bytes[4];
    if desc & 0x20 == 0 {
        let wd = bytes[5];
        let base = 1u64 << (10 + (wd >> 3));
        return Some(base + (base / 8) * u64::from(wd & 7));
    }
    let dict = [0, 1, 2, 4][(desc & 3) as usize];
    let size = [1, 2, 4, 8][(desc >> 6) as usize];
    let encoded = bytes.get(5 + dict..5 + dict + size)?;
    let mut value = 0u64;
    for (index, byte) in encoded.iter().enumerate() { value |= u64::from(*byte) << (index * 8); }
    Some(value + if size == 2 { 256 } else { 0 })
}

/// Decode a bounded prefix, including completed lines in an unfinished frame.
/// The bool tells the caller that a limit, incomplete frame, or corrupt tail remains.
fn decode(bytes: &[u8], limit: usize) -> (Vec<u8>, bool) {
    let mut output = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        if rest.len() >= 8 && (0x184D_2A50..=0x184D_2A5F).contains(&u32::from_le_bytes(rest[..4].try_into().unwrap())) {
            let length = 8 + u32::from_le_bytes(rest[4..8].try_into().unwrap()) as usize;
            if length > rest.len() { return (output, true); }
            rest = &rest[length..];
            continue;
        }
        if window_size(rest).is_none_or(|size| size > MAX_DECODED as u64) { return (output, true); }
        let mut decoder = FrameDecoder::new();
        if decoder.reset(&mut rest).is_err() { return (output, true); }
        while !decoder.is_finished() {
            let result = decoder.decode_blocks(&mut rest, BlockDecodingStrategy::UptoBytes(64 * 1024));
            if let Some(chunk) = decoder.collect() {
                let available = limit.saturating_sub(output.len());
                output.extend_from_slice(&chunk[..chunk.len().min(available)]);
                if chunk.len() > available || output.len() >= limit { return (output, true); }
            }
            if result.is_err() { return (output, true); }
        }
    }
    (output, false)
}

fn records(bytes: &[u8], warnings: &mut Vec<String>, max: usize) -> Vec<Value> {
    let mut values = Vec::new();
    let mut invalid = 0;
    for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.iter().all(u8::is_ascii_whitespace)) {
        if values.len() >= max { warnings.push(format!("Only the first {max} records were analyzed.")); break; }
        if line.len() > 4 * 1024 * 1024 { invalid += 1; continue; }
        match serde_json::from_slice::<Value>(line) { Ok(value) if value.is_object() => values.push(value), _ => invalid += 1 }
    }
    if invalid > 0 { warnings.push(format!("Skipped {invalid} invalid, incomplete, or oversized records; the report may be partial.")); }
    values
}

pub fn read_session(path: &Path, agent: &str) -> Result<(Vec<Value>, Vec<String>, bool), String> {
    let size = fs::metadata(path).map_err(|error| error.to_string())?.len();
    let bytes = bounded_read(path, if agent == "dsh" { MAX_STORED } else { MAX_DECODED })?;
    let mut warnings = Vec::new();
    if size > bytes.len() as u64 { warnings.push("The session exceeds the read limit; this report covers a bounded prefix.".into()); }
    let text = if agent == "dsh" {
        let (text, partial) = decode(&bytes, MAX_DECODED);
        if partial { warnings.push("DSH decoding stopped at an incomplete/corrupt frame or the 64 MiB output/window limit.".into()); }
        text
    } else { bytes };
    let records = records(&text, &mut warnings, 100_000);
    if records.is_empty() { return Err("No readable session records found. The format may be unsupported or the file incomplete.".into()); }
    // Every warning produced by this reader represents omitted or damaged input.
    // Carry that fact separately so pricing never has to interpret prose warnings.
    let complete = warnings.is_empty();
    Ok((records, warnings, complete))
}

fn string<'a>(value: &'a Value, field: &str) -> Option<&'a str> { value.get(field).and_then(Value::as_str).filter(|text| !text.is_empty()) }
fn short(text: &str) -> String { text.lines().find(|line| !line.trim().is_empty()).unwrap_or(text).chars().take(180).collect() }
fn text_content(value: &Value) -> String {
    if let Some(text) = value.as_str() { return short(text); }
    value.as_array().into_iter().flatten().find_map(|part| string(part, "text")).map(short).unwrap_or_default()
}

pub fn preview(path: &Path, agent: &str, values: &[Value]) -> Result<SessionPreview, String> {
    let meta = fs::metadata(path).map_err(|error| error.to_string())?;
    let fallback = if agent == "dsh" { path.parent().and_then(Path::file_name) } else { path.file_stem() }.unwrap_or_default().to_string_lossy().into_owned();
    let mut result = SessionPreview { source_path: path.to_string_lossy().into_owned(), id: fallback.clone(), agent: agent.into(), title: String::new(), project: None,
        modified_at: meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |time| time.as_millis().min(i64::MAX as u128) as i64), size_bytes: meta.len(), tower: "unknown".into() };
    let mut identity_seen = false;
    for record in values {
        let kind = string(record, "type").unwrap_or_default();
        let payload = &record["payload"];
        let data = &record["data"];
        match (agent, kind) {
            ("codex", "session_meta") if !identity_seen => {
                if let Some(id) = string(payload, "id") { result.id = id.into(); }
                result.project = string(payload, "cwd").map(str::to_string);
                identity_seen = true;
            }
            ("claude", _) => {
                if !identity_seen { if let Some(id) = string(record, "sessionId") { result.id = id.into(); identity_seen = true; } }
                if result.project.is_none() { result.project = string(record, "cwd").map(str::to_string); }
                if kind == "custom-title" { if let Some(title) = string(record, "customTitle") { result.title = short(title); } }
                if kind == "user" && result.title.is_empty() { result.title = text_content(&record["message"]["content"]); }
            }
            ("dsh", "session") if !identity_seen => {
                if let Some(id) = string(record, "id").or_else(|| string(data, "id")) { result.id = id.into(); }
                result.project = string(record, "cwd").or_else(|| string(data, "cwd")).map(str::to_string);
                identity_seen = true;
            }
            ("dsh", "session/title") => { if let Some(title) = string(data, "title") { result.title = short(title); } }
            ("dsh", "user/message") if result.title.is_empty() && data["source"]["kind"] == "user" => result.title = text_content(&data["content"]),
            ("codex", "response_item") if result.title.is_empty() && payload["role"] == "user" => result.title = text_content(&payload["content"]),
            _ => {},
        }
    }
    if result.title.is_empty() { result.title = fallback; }
    Ok(result)
}

fn read_json(path: &Path) -> Option<Value> { serde_json::from_slice(&bounded_read(path, 256 * 1024).ok()?).ok() }

/// Positive metadata matches only. Absence never proves a chat was not a Tower task.
pub fn tower_info(session: &SessionPreview, cache: &mut HashMap<String, Vec<Value>>) -> Option<Value> {
    let project = session.project.as_ref()?;
    let path = Path::new(project);
    // Project strings originate in transcripts, so do not visit remote shares.
    if !path.is_absolute() || project.starts_with("\\\\") || project.starts_with("//") { return None; }
    let entries = cache.entry(project.clone()).or_insert_with(|| {
        let folder = path.join(".tower/tasks");
        if fs::symlink_metadata(path.join(".tower")).is_ok_and(|meta| linked(&meta)) || fs::symlink_metadata(&folder).is_ok_and(|meta| linked(&meta)) { return Vec::new(); }
        fs::read_dir(folder).into_iter().flatten().take(2_000).filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("T-") && entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| read_json(&entry.path())).collect()
    });
    entries.iter().find(|entry| entry["to"] == session.agent && string(entry, "session").is_some_and(|id| id.trim_start_matches("session-") == session.id.trim_start_matches("session-"))).cloned()
}

pub fn codex_titles(roots: &[SourceRoot]) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    if let Some(root) = roots.iter().find(|root| root.agent == "codex") {
        if let Ok(mut file) = File::open(root.home.join("session_index.jsonl")) {
            let size = file.metadata().map_or(0, |meta| meta.len());
            let _ = file.seek(SeekFrom::Start(size.saturating_sub(8 * 1024 * 1024)));
            let mut bytes = Vec::new();
            let _ = file.take(8 * 1024 * 1024).read_to_end(&mut bytes);
            for value in records(&bytes, &mut Vec::new(), 100_000) {
                if let (Some(id), Some(title)) = (string(&value, "id"), string(&value, "thread_name")) { titles.insert(id.to_string(), short(title)); }
            }
        }
    }
    titles
}

pub fn catalog(roots: &[SourceRoot]) -> SessionCatalog {
    let mut catalog = SessionCatalog { sessions: Vec::new(), sources: Vec::new(), warnings: Vec::new() };
    let titles = codex_titles(roots);
    let mut task_cache = HashMap::new();
    for root in roots {
        catalog.sources.push(SessionSource { agent: root.agent.clone(), path: root.sessions.to_string_lossy().into_owned(), found: root.sessions.is_dir() });
        let mut pending = vec![(root.sessions.clone(), 0)];
        let mut visited = 0;
        while let Some((folder, depth)) = pending.pop() {
            if fs::symlink_metadata(&folder).is_ok_and(|meta| linked(&meta)) { continue; }
            let entries = match fs::read_dir(&folder) { Ok(entries) => entries, Err(error) => { if root.sessions.exists() && catalog.warnings.len() < 20 { catalog.warnings.push(format!("Cannot list {}: {error}", folder.display())); } continue; } };
            for entry in entries.filter_map(Result::ok) {
                visited += 1;
                if catalog.sessions.len() >= MAX_SESSIONS || visited > 50_000 { pending.clear(); break; }
                let Ok(kind) = entry.file_type() else { continue };
                if kind.is_symlink() || fs::symlink_metadata(entry.path()).is_ok_and(|meta| linked(&meta)) { continue; }
                let path = entry.path();
                if kind.is_dir() && depth < 5 { pending.push((path, depth + 1)); continue; }
                if !kind.is_file() || !supported(&root.agent, &path) { continue; }
                let bytes = match bounded_read(&path, HEAD_BYTES) { Ok(bytes) => bytes, Err(error) => { if catalog.warnings.len() < 20 { catalog.warnings.push(format!("Cannot preview {}: {error}", path.display())); } continue; } };
                let text = if root.agent == "dsh" { decode(&bytes, HEAD_BYTES * 4).0 } else { bytes };
                let values = records(&text, &mut Vec::new(), 100);
                let Ok(mut session) = preview(&path, &root.agent, &values) else { continue };
                if root.agent == "codex" { if let Some(title) = titles.get(&session.id) { session.title = title.clone(); } }
                if root.agent == "dsh" && session.id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
                    let cached = root.home.join("storages/session_projcache/sessions").join(format!("session-{}.json", session.id.trim_start_matches("session-")));
                    if let Some(cache) = read_json(&cached) {
                        if let Some(title) = cache.pointer("/record/rows/title/val").and_then(Value::as_str) { session.title = short(title); }
                        if session.project.is_none() { session.project = cache.pointer("/record/identity/cwd").and_then(Value::as_str).map(str::to_string); }
                    }
                }
                if tower_info(&session, &mut task_cache).is_some() { session.tower = "yes".into(); }
                catalog.sessions.push(session);
            }
        }
        if visited > 50_000 { catalog.warnings.push(format!("{} discovery reached its directory-entry limit.", root.agent)); }
    }
    if catalog.sessions.len() >= MAX_SESSIONS { catalog.warnings.push(format!("Catalog limited to {MAX_SESSIONS} sessions. Some chats are omitted.")); }
    catalog.sessions.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    catalog.warnings.push("Previews use bounded session headers and existing title caches. Missing project/title metadata is resolved during analysis. Tower origin stays unknown without a matching task record.".into());
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn decodes_real_fixture_and_bounds_output() {
        let bytes = include_bytes!("../agent-todo/fixtures/dsh.session.v4.jsonl.zstd");
        let (text, partial) = decode(bytes, MAX_DECODED);
        assert!(!partial);
        assert!(!records(&text, &mut Vec::new(), 100).is_empty());
        let (prefix, partial) = decode(bytes, 30);
        assert!(partial);
        assert_eq!(prefix.len(), 30);
        let (_, partial) = decode(&bytes[..bytes.len() - 2], MAX_DECODED);
        assert!(partial);
    }
    #[test]
    fn skips_corrupt_records_and_preserves_valid_tail() {
        let mut warnings = Vec::new();
        let values = records(b"{\"type\":\"session\"}\n{bad\n{\"type\":\"tool/call\"}", &mut warnings, 100);
        assert_eq!(values.len(), 2);
        assert_eq!(warnings.len(), 1);
    }
    #[test]
    fn full_reader_marks_damaged_sources_incomplete() {
        let path = std::env::temp_dir().join(format!("session-pricing-source-{}.jsonl", std::process::id()));
        fs::write(&path, "{\"type\":\"session\"}\n{bad\n").unwrap();
        let (_, warnings, complete) = read_session(&path, "codex").unwrap();
        assert!(!complete);
        assert!(!warnings.is_empty());
        fs::write(&path, "{\"type\":\"session\"}\n").unwrap();
        assert!(read_session(&path, "codex").unwrap().2);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn authorization_rejects_other_files_and_outside_root() {
        let root = SourceRoot { agent: "codex".into(), home: PathBuf::from("/absent"), sessions: PathBuf::from("/absent/sessions") };
        assert!(authorize(&[root.clone()], "claude", "/elsewhere/file.jsonl").is_err());
        assert!(authorize(&[root.clone()], "codex", "relative/rollout-a.jsonl").is_err());
        assert!(authorize(&[root], "codex", "/elsewhere/secrets.json").is_err());
    }
    #[test]
    fn repeated_parent_metadata_does_not_replace_session_identity() {
        let path_buf = Path::new(env!("CARGO_MANIFEST_DIR")).join(file!());
        let path = path_buf.as_path();
        let records = vec![json!({"type":"session_meta","payload":{"id":"child","cwd":"C:/child"}}), json!({"type":"session_meta","payload":{"id":"parent","cwd":"C:/parent"}})];
        let session = preview(path, "codex", &records).unwrap();
        assert_eq!(session.id, "child");
        assert_eq!(session.project.as_deref(), Some("C:/child"));
    }

    #[test]
    fn catalog_uses_bounded_previews_and_tower_target_identity() {
        let folder = std::env::temp_dir().join(format!("session-catalog-{}", std::process::id()));
        let sessions = folder.join("agent/sessions");
        fs::create_dir_all(&sessions).unwrap();
        let project = folder.join("project");
        fs::create_dir_all(project.join(".tower/tasks")).unwrap();
        let session_path = sessions.join("rollout-example.jsonl");
        let header = json!({"type":"session_meta","payload":{"id":"example","cwd":project.to_string_lossy()}});
        let mut text = format!("{header}\n");
        text.push_str(&" ".repeat(HEAD_BYTES));
        text.push_str("\n{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":\"Do not read this during preview\"}}\n");
        fs::write(&session_path, text).unwrap();
        fs::write(folder.join("agent/session_index.jsonl"), "{\"id\":\"example\",\"thread_name\":\"Renamed chat\"}\n").unwrap();
        fs::write(project.join(".tower/tasks/T-0001.json"), json!({"to":"codex","session":"example","asker_session":"other"}).to_string()).unwrap();
        let roots = vec![SourceRoot { agent: "codex".into(), home: folder.join("agent"), sessions }];
        let result = catalog(&roots);
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].title, "Renamed chat");
        assert_eq!(result.sessions[0].tower, "yes");
        assert!(authorize(&roots, "codex", session_path.to_str().unwrap()).is_ok());
        let outsider = folder.join("rollout-outside.jsonl");
        fs::write(&outsider, "{}\n").unwrap();
        assert!(authorize(&roots, "codex", outsider.to_str().unwrap()).is_err());
        let mut requester = result.sessions[0].clone();
        requester.id = "other".into();
        assert!(tower_info(&requester, &mut HashMap::new()).is_none());
        fs::remove_dir_all(&folder).unwrap();
    }
}
