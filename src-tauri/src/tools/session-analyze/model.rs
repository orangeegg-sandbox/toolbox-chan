use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPreview {
    pub source_path: String,
    pub id: String,
    pub agent: String,
    pub title: String,
    pub project: Option<String>,
    pub modified_at: i64,
    pub size_bytes: u64,
    pub tower: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSource {
    pub agent: String,
    pub path: String,
    pub found: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCatalog {
    pub sessions: Vec<SessionPreview>,
    pub sources: Vec<SessionSource>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub id: String,
    pub order: usize,
    pub timestamp: Option<String>,
    pub kind: String,
    pub name: String,
    pub role: Option<String>,
    pub text: String,
    pub call_id: Option<String>,
    pub status: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActivity {
    pub path: String,
    pub operation: String,
    pub event_id: String,
    pub evidence: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub basis: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSample {
    pub id: String,
    pub model: Option<String>,
    pub timestamp: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_input_tokens: Option<u64>,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCost {
    pub amount: Option<f64>,
    pub currency: String,
    pub basis: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralChatAnalyze {
    pub schema_version: u32,
    pub session: SessionPreview,
    pub analyzed_at: String,
    pub events: Vec<SessionEvent>,
    pub files: Vec<FileActivity>,
    pub usage: SessionUsage,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub usage_samples: Vec<UsageSample>,
    #[serde(default)]
    pub usage_samples_complete: bool,
    pub cost: SessionCost,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub path: String,
    pub kind: String,
    pub excluded: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedFileActivity {
    pub path: String,
    pub operation: String,
    pub event_id: String,
    pub evidence: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCoverage {
    pub project: String,
    pub total_files: usize,
    pub read_files: Vec<String>,
    pub written_files: Vec<String>,
    pub untouched_files: Vec<String>,
    pub outside_project: Vec<String>,
    pub unmatched_files: Vec<UnmappedFileActivity>,
    pub entries: Vec<ProjectEntry>,
    pub scanned_at: u64,
    pub cached: bool,
    pub include_dependencies: bool,
    pub respect_gitignore: bool,
    pub ignored_entries: usize,
    pub complete: bool,
    pub basis: String,
    pub warnings: Vec<String>,
}
