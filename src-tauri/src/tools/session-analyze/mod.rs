//! Read-only, on-demand session analysis. Session text is data and is never executed.
mod coverage;
mod gitignore;
pub mod model;
mod parser;
pub mod pricing;
mod source;

use model::{FileActivity, GeneralChatAnalyze, ProjectCoverage, SessionCatalog};
use std::collections::HashMap;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn session_analyze_scan() -> Result<SessionCatalog, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(source::catalog(&source::roots()?))).await.map_err(|error| format!("Session discovery failed: {error}"))?
}

fn run(source_path: &str, agent: &str) -> Result<GeneralChatAnalyze, String> {
    let roots = source::roots()?;
    let path = source::authorize(&roots, agent, source_path)?;
    let (records, warnings, source_complete) = source::read_session(&path, agent)?;
    let mut preview = source::preview(&path, agent, &records)?;
    if agent == "codex" {
        if let Some(title) = source::codex_titles(&roots).remove(&preview.id) { preview.title = title; }
    }
    // Keep the selected path's spelling stable (canonical Windows paths include \\?\).
    preview.source_path = source_path.to_string();
    let task = source::tower_info(&preview, &mut HashMap::new());
    if task.is_some() { preview.tower = "yes".into(); }
    let mut report = parser::analyze(preview, &records, warnings);
    report.usage_samples_complete &= source_complete;
    if report.cost.amount.is_none() {
        if let Some(amount) = task.as_ref().and_then(|task| task.pointer("/usage/costUsd")).and_then(serde_json::Value::as_f64).filter(|amount| amount.is_finite() && *amount >= 0.0) {
            report.cost.amount = Some(amount);
            report.cost.basis = "reported".into();
            report.cost.detail = "API cost recorded by the matching Tower task. This is not proof of subscription or cash billing.".into();
        }
    }
    // Portable reports must remain importable by this tool; refuse rather than
    // silently dropping more evidence after a parser's own truncation limits.
    if serde_json::to_vec(&report).map_err(|error| error.to_string())?.len() > 20 * 1024 * 1024 {
        return Err("The normalized report exceeds the 20 MiB portable report limit. Analyze a smaller exported session.".into());
    }
    Ok(report)
}

#[tauri::command]
pub async fn session_analyze_run(source_path: String, agent: String) -> Result<GeneralChatAnalyze, String> {
    tauri::async_runtime::spawn_blocking(move || run(&source_path, &agent)).await.map_err(|error| format!("Session analysis failed: {error}"))?
}

#[tauri::command]
pub async fn session_analyze_coverage(app: tauri::AppHandle, project: String, files: Vec<FileActivity>, rescan: Option<bool>, include_dependencies: Option<bool>, respect_gitignore: Option<bool>) -> Result<ProjectCoverage, String> {
    if files.len() > 100_000 || files.iter().any(|file| file.path.len() > 32_768) { return Err("Too many file operations or an oversized path.".into()); }
    let cache = app.path().app_data_dir().map_err(|error| error.to_string())?.join("tools").join("session-analyze").join("projects");
    tauri::async_runtime::spawn_blocking(move || coverage::scan_cached(&cache, &project, &files, rescan.unwrap_or(false), include_dependencies.unwrap_or(false), respect_gitignore.unwrap_or(false))).await.map_err(|error| format!("Project coverage failed: {error}"))?
}

#[tauri::command]
pub async fn session_analyze_export(app: tauri::AppHandle, json: String, name: String) -> Result<bool, String> {
    if json.len() > 20 * 1024 * 1024 { return Err("Report exceeds the 20 MiB export limit.".into()); }
    let report: GeneralChatAnalyze = serde_json::from_str(&json).map_err(|error| format!("Invalid report: {error}"))?;
    if report.schema_version != 1 { return Err("Unsupported report version.".into()); }
    let name = name.chars().filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')).take(140).collect::<String>();
    tauri::async_runtime::spawn_blocking(move || {
        let file = app.dialog().file().add_filter("Session analysis JSON", &["json"]).set_file_name(if name.is_empty() { "session.analysis.json" } else { &name }).blocking_save_file();
        match file {
            Some(file) => {
                let path = file.into_path().map_err(|_| "Select a local file.".to_string())?;
                std::fs::write(path, json).map_err(|error| format!("Could not save analysis: {error}"))?;
                Ok(true)
            }
            None => Ok(false),
        }
    }).await.map_err(|error| format!("The save dialog failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Optional local smoke test prints counts only; no session contents leave the process.
    #[test]
    #[ignore]
    fn replay_local_catalog() {
        let roots = source::roots().unwrap();
        let catalog = source::catalog(&roots);
        assert!(!catalog.sessions.is_empty());
        for agent in ["codex", "claude", "dsh"] {
            let codex_id = std::env::var("SESSION_ANALYZE_SMOKE_CODEX_SESSION").ok();
            let session = catalog.sessions.iter().find(|session| session.agent == agent && (agent != "codex" || codex_id.as_ref().is_none_or(|id| &session.id == id))).unwrap();
            let report = run(&session.source_path, agent).unwrap();
            println!("{agent}: catalog={}, events={}, files={}, input={:?}, cost={:?}", catalog.sessions.iter().filter(|session| session.agent == agent).count(), report.events.len(), report.files.len(), report.usage.input_tokens, report.cost.amount);
            assert!(!report.events.is_empty());
            if let Ok(folder) = std::env::var("SESSION_ANALYZE_SMOKE_OUTPUT") {
                std::fs::create_dir_all(&folder).unwrap();
                std::fs::write(std::path::Path::new(&folder).join(format!("{agent}.json")), serde_json::to_vec(&report).unwrap()).unwrap();
            }
        }
    }
}
