//! Read recorded evidence without evaluating commands or assuming missing context is empty.
use super::model::*;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_EVENTS: usize = 50_000;
const MAX_FILES: usize = 100_000;
const MAX_TEXT: usize = 64 * 1024;
const TOTAL_TEXT: usize = 8 * 1024 * 1024;

pub fn analyze(preview: SessionPreview, records: &[Value], warnings: Vec<String>) -> GeneralChatAnalyze {
    let mut state = Analysis::new(preview, warnings);
    match state.report.session.agent.as_str() {
        "codex" => codex(&mut state, records),
        "claude" => claude(&mut state, records),
        "dsh" => dsh(&mut state, records),
        _ => state.warn("This agent format is unsupported; import a general chat analyze object instead."),
    }
    state.warn("Only recorded context is visible. Missing system prompts, omitted tool outputs, hooks, and unlogged file access cannot be reconstructed; this is not an exact replay of any model context window.");
    state.warn("File activity describes recorded tool requests and literal paths, not proof that every byte was read. Search/list targets do not count as file reads. Failed calls are excluded from file coverage.");
    if state.report.usage.input_tokens.is_none() && state.report.usage.output_tokens.is_none() {
        state.report.usage.basis = "No usable token usage was recorded; missing values are unknown, not zero.".into();
    }
    if state.report.usage_samples.len() > MAX_EVENTS {
        state.report.usage_samples.truncate(MAX_EVENTS);
        state.report.usage_samples_complete = false;
        state.warn("Per-call usage attribution was limited to 50,000 samples; any estimate from these samples is partial.");
    }
    if state.report.usage_samples.iter_mut().fold(false, |changed, sample| sanitize_sample_cache(sample) || changed) {
        state.warn("Some per-call cache buckets contradicted their input total and are shown as unknown; these samples cannot establish a complete price.");
    }
    let samples_match = samples_match_usage(&state.report);
    state.report.usage_samples_complete &= samples_match;
    state.report
}

struct Analysis {
    report: GeneralChatAnalyze,
    effective_cwd: Option<String>,
    calls: HashMap<String, Vec<usize>>,
    text_bytes: usize,
    file_keys: HashSet<(String, String, String)>,
}

impl Analysis {
    fn new(session: SessionPreview, warnings: Vec<String>) -> Self {
        let effective_cwd = session.project.clone();
        Self {
            report: GeneralChatAnalyze {
                schema_version: 1,
                session,
                analyzed_at: now_iso(),
                events: vec![],
                files: vec![],
                usage: SessionUsage::default(),
                usage_samples: vec![],
                usage_samples_complete: true,
                cost: SessionCost {
                    amount: None,
                    currency: "USD".into(),
                    basis: "unknown".into(),
                    detail: "No session cost was recorded. Token counts alone do not establish pricing, subscription charges, or the amount billed.".into(),
                },
                warnings,
            },
            effective_cwd,
            calls: HashMap::new(),
            text_bytes: 0,
            file_keys: HashSet::new(),
        }
    }

    fn warn(&mut self, warning: &str) {
        if !self.report.warnings.iter().any(|value| value == warning) {
            self.report.warnings.push(warning.into());
        }
    }

    fn bounded(&mut self, text: &str) -> String {
        let limit = MAX_TEXT.min(TOTAL_TEXT.saturating_sub(self.text_bytes));
        let value = truncate(text, limit);
        self.text_bytes += value.len();
        if value.len() < text.len() {
            self.warn("Some event text was truncated (64 KiB per field, 8 MiB total). The original local session remains unchanged.");
        }
        value
    }

    #[allow(clippy::too_many_arguments)]
    fn event(&mut self, record: usize, timestamp: Option<String>, kind: &str, name: &str, role: Option<&str>, text: &str, call: Option<&str>, status: &str) -> Option<usize> {
        if self.report.events.len() >= MAX_EVENTS {
            self.warn("The chronological report is limited to 50,000 events; later events and their file activity were omitted.");
            return None;
        }
        let index = self.report.events.len();
        let text = self.bounded(text);
        self.report.events.push(SessionEvent {
            id: format!("event-{}", index + 1),
            order: index + 1,
            timestamp: timestamp.map(|value| truncate(&value, 128)),
            kind: kind.into(),
            name: truncate(name, 512),
            role: role.map(|value| truncate(value, 128)),
            text,
            call_id: call.map(|value| truncate(value, 512)),
            status: status.into(),
            source: format!("parsed record {}", record + 1),
        });
        if let Some(call) = call {
            self.calls.entry(call.into()).or_default().push(index);
        }
        Some(index)
    }

    fn message(&mut self, record: usize, timestamp: Option<String>, role: &str, content: &Value, label: Option<&str>) {
        let kind = if role == "system" || role == "developer" || label.is_some() { "context" } else { "message" };
        let value = content_text(content);
        if !value.is_empty() {
            self.event(record, timestamp, kind, label.unwrap_or(role), Some(role), &value, None, "observed");
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn call(&mut self, record: usize, timestamp: Option<String>, name: &str, raw: &Value, call: Option<&str>, inferred: bool, depth: usize) {
        let text = raw.as_str().map(str::to_owned).unwrap_or_else(|| raw.to_string());
        let arguments = if let Some(raw) = raw.as_str() {
            match serde_json::from_str::<Value>(raw) {
                Ok(value) => value,
                Err(_) => {
                    if !is_script_tool(name) && !name.ends_with("apply_patch") {
                        self.warn("Some tool arguments were not valid JSON; their raw text is retained and only conservative literal path evidence is extracted.");
                    }
                    Value::Null
                }
            }
        } else { raw.clone() };
        let lower = name.to_ascii_lowercase();
        let kind = if is_mcp(name) { "mcp" } else if is_skill_tool(&lower) { "skill" } else { "tool" };
        let label = if kind == "skill" {
            argument_string(&arguments, &["skill", "name"]).map(|skill| format!("{name}: {skill}")).unwrap_or_else(|| name.into())
        } else { name.into() };
        let Some(index) = self.event(record, timestamp.clone(), kind, &label, Some("assistant"), &text, call, if inferred { "unknown" } else { "observed" }) else { return; };
        let cwd = argument_string(&arguments, &["workdir", "cwd"]).or_else(|| literal_property(&text, "workdir")).or_else(|| self.effective_cwd.clone());
        self.paths(index, &lower, &arguments, &text, cwd.as_deref(), inferred);
        if is_script_tool(name) {
            if depth >= 8 {
                self.warn("Nested orchestration inspection stopped after eight layers; deeper script calls are retained as opaque text.");
                return;
            }
            for (nested_name, nested_args) in nested_calls(&text) {
                self.warn("Calls extracted from orchestration scripts are marked unknown: the script may contain branches or calls that never executed, and their individual results are not reliably attributable.");
                self.call(record, timestamp.clone(), &nested_name, &Value::String(nested_args), None, true, depth + 1);
            }
        }
    }

    fn result(&mut self, record: usize, timestamp: Option<String>, call: &str, output: &Value, error: bool) {
        let text = content_text(output);
        let is_error = error || output.get("isError").and_then(Value::as_bool).unwrap_or(false)
            || output.get("is_error").and_then(Value::as_bool).unwrap_or(false)
            || output.get("exit_code").and_then(Value::as_i64).is_some_and(|code| code != 0)
            || shell_failed(&text);
        if let Some(indices) = self.calls.get(call).cloned() {
            let output = self.bounded(&format!("\n\nResult (parsed record {}):\n{text}", record + 1));
            for (position, index) in indices.iter().enumerate() {
                let event = &mut self.report.events[*index];
                event.status = if is_error { "error" } else { "success" }.into();
                if position == 0 { event.text.push_str(&truncate(&output, (2 * MAX_TEXT).saturating_sub(event.text.len()))); }
            }
            if is_error {
                let ids: HashSet<_> = indices.iter().map(|index| self.report.events[*index].id.clone()).collect();
                self.report.files.retain(|file| !ids.contains(&file.event_id));
            }
        } else {
            self.event(record, timestamp, "tool", "Unmatched tool result", Some("tool"), &text, None, if is_error { "error" } else { "unknown" });
            self.warn("Some tool results have no matching recorded call; the original call may be outside the available log.");
        }
    }

    fn paths(&mut self, index: usize, name: &str, arguments: &Value, raw: &str, cwd: Option<&str>, inferred: bool) {
        let evidence = if inferred { "inferred" } else { "explicit" };
        if name.ends_with("apply_patch") || name == "applypatch" {
            let patch = argument_string(arguments, &["patch", "input"]).unwrap_or_else(|| raw.into());
            for line in patch.lines() {
                for prefix in ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "] {
                    if let Some(path) = line.strip_prefix(prefix) { self.file(index, path, "write", evidence, cwd); }
                }
            }
            return;
        }
        let operation = if name == "str_replace_editor" {
            match string(arguments, "command") { "view" => Some("read"), "create" | "str_replace" | "insert" => Some("write"), _ => None }
        } else if is_read_tool(name) { Some("read") }
            else if is_write_tool(name) { Some("write") }
            else if name.ends_with("list_directory") || name == "ls" || name == "glob" { Some("list") }
            else if name == "grep" || name.ends_with("search_files") || name.ends_with("file_search") { Some("search") }
            else { None };
        if let Some(operation) = operation {
            for key in ["path", "file_path", "filePath", "filepath", "filename", "file", "directory"] {
                if let Some(path) = arguments.get(key).and_then(Value::as_str).map(str::to_owned).or_else(|| if inferred { literal_property(raw, key) } else { None }) {
                    self.file(index, &path, operation, evidence, cwd);
                }
            }
            for key in ["paths", "files"] {
                if let Some(paths) = arguments.get(key).and_then(Value::as_array) {
                    for path in paths.iter().filter_map(Value::as_str) { self.file(index, path, operation, evidence, cwd); }
                }
            }
        }
        if is_shell_tool(name) {
            if let Some(command) = argument_string(arguments, &["cmd", "command", "script"]).or_else(|| literal_property(raw, "cmd")).or_else(|| literal_property(raw, "command")) {
                let (paths, uncertain) = shell_paths(&command, cwd);
                for (path, operation) in paths { self.file(index, &path, operation, "inferred", None); }
                if uncertain {
                    self.warn("Some shell file paths were withheld because their working directory or shell control flow was unresolved. Literal directory changes are inferred only within one call; they do not update the session's recorded working directory.");
                }
            }
        }
    }

    fn file(&mut self, index: usize, path: &str, operation: &str, evidence: &str, cwd: Option<&str>) {
        let Some(path) = concrete_path(path, cwd) else { return; };
        if self.report.files.len() >= MAX_FILES {
            self.warn("File activity was limited to 100,000 entries.");
            return;
        }
        let event = &self.report.events[index];
        let key = (event.id.clone(), path.clone(), operation.into());
        if !self.file_keys.insert(key) { return; }
        self.report.files.push(FileActivity { path: path.clone(), operation: operation.into(), event_id: event.id.clone(), evidence: evidence.into() });
        if operation == "read" && path.replace('\\', "/").rsplit('/').next().is_some_and(|name| name.eq_ignore_ascii_case("SKILL.md")) {
            let event = self.report.events[index].clone();
            let record = event.source.strip_prefix("parsed record ").and_then(|s| s.parse::<usize>().ok()).unwrap_or(1) - 1;
            self.event(record, event.timestamp, "skill", &format!("Read {path}"), Some("assistant"), "A tool requested this SKILL.md file. Catalog mentions alone are not counted as loaded skills.", event.call_id.as_deref(), &event.status);
        }
    }
}

fn codex(state: &mut Analysis, records: &[Value]) {
    let has_messages = records.iter().any(|record| record["type"] == "response_item" && record["payload"]["type"] == "message");
    let mut cumulative = None;
    let mut responses: HashMap<String, AttributedUsage> = HashMap::new();
    let mut cumulative_samples = Vec::new();
    let mut previous_sample = None;
    let mut current_model = None;
    let mut inherited_attribution = false;
    let mut metadata_id = None;
    for (index, record) in records.iter().enumerate() {
        let timestamp = timestamp(record);
        let payload = &record["payload"];
        let kind = string(record, "type");
        if kind == "turn_context" {
            current_model = payload["model"].as_str().map(str::to_owned);
            if let Some(cwd) = payload["cwd"].as_str().filter(|cwd| !cwd.is_empty() && cwd.len() <= 4096) {
                state.effective_cwd = Some(cwd.into());
            }
        }
        if payload.get("turn_id").or_else(|| record.get("turn_id")).and_then(Value::as_str).is_some_and(|id| id.starts_with("external-import")) {
            state.report.usage_samples_complete = false;
            state.warn("This Codex log contains external-import turns. It may be a conversation mirror; original agent tool calls, file activity, context, and detailed usage may be missing.");
        }
        if kind == "session_meta" {
            if let Some(id) = payload["id"].as_str() {
                if metadata_id.is_some_and(|previous| previous != id) {
                    inherited_attribution = true;
                    state.report.usage_samples_complete = false;
                    state.warn("Multiple Codex session identities occur in this log. Fork-inherited history and cumulative token totals may include parent activity; they cannot be attributed exactly to this child session.");
                } else { metadata_id = Some(id); }
            }
            if payload.get("forked_from_id").is_some() || payload.get("parent_session_id").is_some() {
                inherited_attribution = true;
                state.report.usage_samples_complete = false;
                state.warn("This Codex log reports fork ancestry. Recorded cumulative usage may include inherited parent activity; no unsupported subtraction has been applied.");
            }
        }
        if kind == "session_meta" || kind == "turn_context" {
            let mut context = Map::new();
            for key in ["base_instructions", "developer_instructions", "user_instructions", "instructions", "model", "model_provider", "cwd", "approval_policy", "sandbox_policy", "effort"] {
                if let Some(value) = payload.get(key) { context.insert(key.into(), value.clone()); }
            }
            if !context.is_empty() { state.event(index, timestamp.clone(), "context", kind, None, &Value::Object(context).to_string(), None, "observed"); }
        }
        if kind == "compacted" || kind == "compaction" || string(payload, "type") == "context_compacted" {
            state.event(index, timestamp.clone(), "compaction", "Context compaction", None, &content_text(payload), None, "observed");
        }
        if kind == "response_item" {
            match string(payload, "type") {
                "message" => state.message(index, timestamp.clone(), string(payload, "role"), &payload["content"], None),
                "function_call" | "custom_tool_call" => {
                    let raw = payload.get("arguments").or_else(|| payload.get("input")).unwrap_or(&Value::Null);
                    state.call(index, timestamp.clone(), string(payload, "name"), raw, payload["call_id"].as_str(), false, 0);
                }
                "function_call_output" | "custom_tool_call_output" => state.result(index, timestamp.clone(), string(payload, "call_id"), &payload["output"], false),
                "reasoning" => { state.event(index, timestamp.clone(), "context", "Recorded reasoning summary", Some("assistant"), &content_text(&payload["summary"]), None, "observed"); }
                _ => {}
            }
        }
        if kind == "event_msg" && !has_messages {
            match string(payload, "type") {
                "user_message" => state.message(index, timestamp.clone(), "user", &payload["message"], None),
                "agent_message" => state.message(index, timestamp.clone(), "assistant", &payload["message"], None),
                _ => {}
            }
        }
        if string(payload, "type") == "token_count" {
            if let Some(usage) = payload.pointer("/info/total_token_usage").filter(|value| value.is_object()) {
                let normalized = codex_usage(state, usage);
                let sample = attributed_usage(normalized.clone(), codex_cache_write(usage, &normalized), current_model.as_deref(), timestamp.clone(), index, format!("codex-cumulative-{index}")).sample;
                append_cumulative_sample(&mut cumulative_samples, &mut previous_sample, sample);
                update_cumulative(state, &mut cumulative, normalized);
            }
        }
        if kind == "token_usage_record" || string(payload, "type") == "token_usage_record" {
            let data = if payload.is_object() { payload } else { record };
            if let Some(usage) = data.get("thread_token_usage").filter(|value| value.is_object()) {
                let normalized = codex_usage(state, usage);
                let sample = attributed_usage(normalized.clone(), codex_cache_write(usage, &normalized), data["model"].as_str().or(current_model.as_deref()), timestamp.clone(), index, format!("codex-cumulative-{index}")).sample;
                append_cumulative_sample(&mut cumulative_samples, &mut previous_sample, sample);
                update_cumulative(state, &mut cumulative, normalized);
            } else if let Some(usage) = data.get("usage").filter(|value| value.is_object()) {
                let key = data["response_id"].as_str().map(str::to_owned).unwrap_or_else(|| format!("record-{index}"));
                let normalized = codex_usage(state, usage);
                let cache_write = codex_cache_write(usage, &normalized);
                let attributed = attributed_usage(normalized, cache_write, data["model"].as_str().or(current_model.as_deref()), timestamp.clone(), index, format!("codex-response-{key}"));
                responses.insert(key, attributed);
            }
        }
    }
    state.report.usage = if let Some(usage) = cumulative {
        if !responses.is_empty() { state.warn("Codex cumulative usage takes precedence over response samples to avoid double counting; response-only samples cannot be reliably added to a cumulative total."); }
        if inherited_attribution {
            state.report.usage_samples_complete = false;
            for sample in &mut cumulative_samples { sample.model = None; }
        }
        state.report.usage_samples = cumulative_samples;
        usage
    } else {
        state.report.usage_samples = ordered_samples(responses.values());
        sum_usage(responses.values().map(|entry| &entry.usage))
    };
    state.report.usage.basis = "Latest recorded Codex cumulative thread total, or unique response usage when no cumulative total exists. Input includes cached input; output includes reasoning where the provider reports it. These totals do not measure unique context content.".into();
}

fn claude(state: &mut Analysis, records: &[Value]) {
    let mut usages = HashMap::new();
    let mut assistant_ids = HashSet::new();
    let mut cache_writes = false;
    for (index, record) in records.iter().enumerate() {
        if let Some(cwd) = record["cwd"].as_str().filter(|cwd| !cwd.is_empty() && cwd.len() <= 4096) {
            state.effective_cwd = Some(cwd.into());
        }
        let timestamp = timestamp(record);
        let kind = string(record, "type");
        let message = &record["message"];
        if kind == "assistant" {
            assistant_ids.insert(message["id"].as_str().map(str::to_owned).unwrap_or_else(|| format!("record-{index}")));
        }
        if kind == "assistant" || kind == "user" {
            let role = kind;
            if let Some(blocks) = message["content"].as_array() {
                for block in blocks {
                    match string(block, "type") {
                        "tool_use" => state.call(index, timestamp.clone(), string(block, "name"), &block["input"], block["id"].as_str(), false, 0),
                        "tool_result" => state.result(index, timestamp.clone(), string(block, "tool_use_id"), &block["content"], block["is_error"].as_bool().unwrap_or(false)),
                        "text" | "input_text" => state.message(index, timestamp.clone(), role, &block["text"], if record["isMeta"] == true { Some("Injected context") } else { None }),
                        "thinking" => { state.event(index, timestamp.clone(), "context", "Recorded reasoning", Some("assistant"), &content_text(&block["thinking"]), None, "observed"); }
                        _ => {}
                    }
                }
            } else {
                state.message(index, timestamp.clone(), role, &message["content"], if record["isMeta"] == true { Some("Injected context") } else { None });
            }
            if kind == "assistant" && message["usage"].is_object() {
                let usage = &message["usage"];
                cache_writes |= number(usage, "cache_creation_input_tokens").unwrap_or(0) > 0;
                let key = message["id"].as_str().map(str::to_owned).unwrap_or_else(|| format!("record-{index}"));
                let normalized = split_cache_usage(usage, "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "reasoning_tokens");
                let mut attributed = attributed_usage(normalized, number(usage, "cache_creation_input_tokens"), message["model"].as_str(), timestamp.clone(), index, format!("claude-message-{key}"));
                attributed.sample.cached_input_tokens = number(usage, "cache_read_input_tokens");
                usages.insert(key, attributed);
            }
        }
        if kind == "system" {
            let compact = string(record, "subtype").contains("compact");
            state.event(index, timestamp.clone(), if compact { "compaction" } else { "context" }, if compact { "Context compaction" } else { "System record" }, Some("system"), &content_text(record), None, "observed");
        }
        if kind == "summary" {
            state.event(index, timestamp.clone(), "compaction", "Session summary", None, &content_text(&record["summary"]), None, "observed");
        }
        if kind == "attachment" {
            state.event(index, timestamp.clone(), "context", "Recorded attachment", None, &content_text(&record["attachment"]), None, "observed");
        }
        if kind == "cost-state" {
            if let Some(amount) = record["totalCostUSD"].as_f64().filter(|value| value.is_finite() && *value >= 0.0) {
                state.report.cost = SessionCost { amount: Some(amount), currency: "USD".into(), basis: "reported".into(), detail: "Latest Claude Code cost-state totalCostUSD: reported API-equivalent session cost, which may differ from subscription charges or your bill.".into() };
            }
            if record["hasUnknownModelCost"] == true { state.warn("Claude Code reported an unknown model cost; its recorded cost total may be incomplete."); }
        }
    }
    state.report.usage = sum_usage(usages.values().map(|entry| &entry.usage));
    state.report.usage_samples = ordered_samples(usages.values());
    if assistant_ids.iter().any(|id| !usages.contains_key(id)) { state.report.usage_samples_complete = false; }
    state.report.usage.basis = "Sum of latest usage per Claude assistant message ID (repeated snapshots are counted once). Input includes uncached input, cache reads, and cache creation; reasoning tokens are only shown if recorded separately.".into();
    if cache_writes { state.warn("Aggregate input includes cache creation. Per-call samples preserve recorded cache-write tokens, which require the matching cache-write price for a complete estimate."); }
}

fn dsh(state: &mut Analysis, records: &[Value]) {
    let seeded = records.first().and_then(|record| record.get("isSeeded")).and_then(Value::as_bool).unwrap_or(false);
    let boundary = if seeded {
        records.iter().rposition(|record| record["type"] == "session/end-seed" && record["data"]["inherited"] == true)
            .or_else(|| records.iter().position(|record| record["type"] == "session/end-seed"))
    } else { None };
    if seeded { state.warn("This DSH session contains inherited fork history. Inherited events remain visible, but their usage is excluded from this session's totals."); }
    if seeded && boundary.is_none() { state.warn("The seeded DSH session has no end-seed boundary; usage attribution is unknown and token totals are withheld."); }
    let mut total = SessionUsage::default();
    let mut last: Option<(Value, Value, SessionUsage, usize)> = None;
    let mut cache_writes = false;
    let mut current_model = None;
    for (index, record) in records.iter().enumerate() {
        let kind = string(record, "type");
        let data = &record["data"];
        let timestamp = timestamp(record);
        let inherited = seeded && boundary.map_or(true, |cut| index < cut);
        if kind == "request/context" {
            current_model = data["model"].as_str().map(str::to_owned);
        } else if kind == "request/header" {
            current_model = data.pointer("/header/config/model").and_then(Value::as_str).map(str::to_owned);
        }
        match kind {
            "user/message" | "system/message" | "developer/message" | "assistant/message" => {
                let role = kind.split('/').next().unwrap_or("user");
                let source = data.pointer("/source/kind").and_then(Value::as_str)
                    .or_else(|| data.pointer("/message/source/kind").and_then(Value::as_str));
                let context = match source { Some("human" | "user") | None => None, value => value };
                let content = data.pointer("/message/content").or_else(|| data.get("content")).unwrap_or(&Value::Null);
                if source == Some("skill-invocation") {
                    let name = data.pointer("/source/name").and_then(Value::as_str).unwrap_or("Skill invocation");
                    state.event(index, timestamp.clone(), "skill", name, Some(role), &content_text(content), None, "observed");
                } else {
                    state.message(index, timestamp.clone(), role, content, if inherited { Some("Inherited history") } else { context });
                }
                if source == Some("agent-instructions") {
                    let changes = data.pointer("/source/changes").or_else(|| data.pointer("/message/source/changes"));
                    if let Some(changes) = changes.and_then(Value::as_array) {
                        if let Some(event_index) = state.event(index, timestamp.clone(), "context", "Instruction file changes", None, &Value::Array(changes.clone()).to_string(), None, "observed") {
                            let cwd = state.report.session.project.clone();
                            for change in changes {
                                if matches!(string(change, "action"), "set" | "replace") {
                                    if let Some(path) = change["path"].as_str() { state.file(event_index, path, "read", "explicit", cwd.as_deref()); }
                                }
                            }
                        }
                    }
                }
                if record["surfaceOp"]["op"] == "replace" {
                    state.event(index, timestamp.clone(), "compaction", "Context surface replacement", None, &record["surfaceOp"].to_string(), None, "observed");
                }
            }
            "tool/call" => state.call(index, timestamp.clone(), string(data, "name"), &data["arguments"], data["callId"].as_str(), false, 0),
            "tool/result" => state.result(index, timestamp.clone(), string(&data["message"], "toolCallId"), &data["message"]["content"], data["message"]["isError"].as_bool().unwrap_or(false)),
            "request/header" | "request/context" | "instructions/update" | "instructions/changed" => { state.event(index, timestamp.clone(), "context", kind, None, &content_text(data), None, "observed"); }
            "session/end-seed" => { state.event(index, timestamp.clone(), "context", "End of inherited/restored history", None, &content_text(data), None, "observed"); }
            _ if kind.contains("compaction") => { state.event(index, timestamp.clone(), "compaction", kind, None, &content_text(data), None, "observed"); }
            _ if kind.contains("instruction") || kind.contains("context") || kind.contains("skill") => { state.event(index, timestamp.clone(), "context", kind, None, &content_text(data), None, "observed"); }
            _ => {}
        }
        if inherited { continue; }
        if kind == "llm/retry-started" && last.as_ref().is_some_and(|(turn, step, _, _)| *turn == data["turn"] && *step == data["step"]) { last = None; }
        if kind == "assistant/message" || kind == "assistant/attempt" {
            let usage = data.get("usage").filter(|value| value.is_object()).or_else(|| data["stream"].as_array().and_then(|chunks| chunks.iter().rev().find_map(|item| {
                if item["type"] == "chunk" && item["chunk"]["type"] == "usage" { item.pointer("/chunk/usage") } else { None }
            })));
            if let Some(usage) = usage {
                cache_writes |= number(usage, "cacheWriteTokens").unwrap_or(0) > 0;
                let next = split_cache_usage(usage, "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens");
                let replace = last.as_ref().filter(|(turn, step, _, _)| *turn == data["turn"] && *step == data["step"]);
                let sample_index = replace.map(|(_, _, _, sample_index)| *sample_index).unwrap_or(state.report.usage_samples.len());
                let sample_id = replace.map(|(_, _, _, sample_index)| state.report.usage_samples[*sample_index].id.clone()).unwrap_or_else(|| format!("dsh-attempt-{index}"));
                let model = data.pointer("/message/source/model").and_then(Value::as_str).or(current_model.as_deref());
                // DSH's authoritative token-meter projection defines absent optional cache buckets as zero.
                let has_usage = next.input_tokens.is_some() || next.output_tokens.is_some();
                let mut attributed = attributed_usage(next.clone(), has_usage.then(|| number(usage, "cacheWriteTokens").unwrap_or(0)), model, timestamp.clone(), index, sample_id);
                if !has_usage { attributed.sample.cached_input_tokens = None; }
                if let Some((_, _, previous, _)) = replace { subtract_usage(&mut total, previous); }
                if sample_index < state.report.usage_samples.len() { state.report.usage_samples[sample_index] = attributed.sample; }
                else { state.report.usage_samples.push(attributed.sample); }
                add_usage(&mut total, &next);
                last = Some((data["turn"].clone(), data["step"].clone(), next, sample_index));
            } else { state.report.usage_samples_complete = false; }
        }
    }
    state.report.usage = total;
    state.report.usage.basis = "DSH provider usage from assistant messages/attempts, taking the latest sample for each consecutive turn/step slot and counting retry attempts separately. Input includes uncached input, cache reads, and cache writes. Fork-inherited usage is excluded.".into();
    if cache_writes { state.warn("Aggregate input includes cache writes. Per-call samples preserve recorded cache-write tokens, which require the matching cache-write price for a complete estimate."); }
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str { value.get(key).and_then(Value::as_str).unwrap_or("") }
fn number(value: &Value, key: &str) -> Option<u64> { value.get(key).and_then(Value::as_u64) }
fn timestamp(record: &Value) -> Option<String> {
    record.get("timestamp").or_else(|| record.get("time")).and_then(|value| match value {
        Value::String(value) => Some(value.clone()), Value::Number(value) => value.as_u64().and_then(epoch_millis_iso), _ => None,
    })
}
fn truncate(text: &str, limit: usize) -> String {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) { end -= 1; }
    text[..end].into()
}
fn content_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(values) => values.iter().map(content_text).filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n"),
        Value::Object(_) => {
            for key in ["text", "input_text", "output_text"] { if let Some(text) = value.get(key).and_then(Value::as_str) { return text.into(); } }
            if let Some(content) = value.get("content") { return content_text(content); }
            if matches!(string(value, "type"), "image" | "image_url" | "input_image" | "audio") { return format!("[{} content omitted]", string(value, "type")); }
            value.to_string()
        }
        _ => value.to_string(),
    }
}
fn argument_string(value: &Value, keys: &[&str]) -> Option<String> { keys.iter().find_map(|key| value.get(key).and_then(Value::as_str).map(str::to_owned)) }
fn is_mcp(name: &str) -> bool { let name = name.trim_start_matches("functions."); name.starts_with("mcp__") || name.starts_with("mcp.") || name.starts_with("mcp_") }
fn is_skill_tool(name: &str) -> bool { matches!(name, "skill" | "skills" | "load_skill" | "use_skill" | "invoke_skill" | "skills.read") }
fn is_script_tool(name: &str) -> bool { matches!(name, "functions.exec" | "exec" | "multi_tool_use.parallel") }
fn is_shell_tool(name: &str) -> bool { matches!(name, "bash" | "shell" | "exec_command" | "functions.exec_command" | "run_command" | "terminal" | "execute" | "powershell" | "pwsh") }
fn is_read_tool(name: &str) -> bool { matches!(name, "read" | "read_file" | "readfile" | "view" | "view_image" | "read_image" | "functions.view_image" | "functions.read_file") || name.ends_with("__read_file") }
fn is_write_tool(name: &str) -> bool { matches!(name, "write" | "edit" | "multiedit" | "write_file" | "edit_file" | "replace" | "str_replace" | "functions.write_file") || name.ends_with("__write_file") || name.ends_with("__edit_file") }
fn shell_failed(text: &str) -> bool {
    // Recognize native result envelopes, not arbitrary error words in file contents.
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if value["isError"] == true || value["is_error"] == true || value["exit_code"].as_i64().is_some_and(|code| code != 0) { return true; }
    }
    text.lines().any(|line| line.strip_prefix("Process exited with code ").or_else(|| line.strip_prefix("Exit code: ")).and_then(|code| code.trim().parse::<i64>().ok()).is_some_and(|code| code != 0))
}

struct AttributedUsage {
    usage: SessionUsage,
    sample: UsageSample,
    record: usize,
}

fn samples_match_usage(report: &GeneralChatAnalyze) -> bool {
    let samples = &report.usage_samples;
    if samples.is_empty() || samples.iter().any(|sample| sample.model.is_none() || sample.timestamp.is_none()
        || sample.input_tokens.is_none() || sample.output_tokens.is_none() || sample.cached_input_tokens.is_none() || sample.cache_write_input_tokens.is_none()) {
        return false;
    }
    let sum = |field: fn(&UsageSample) -> Option<u64>| samples.iter().try_fold(0_u64, |total, sample| total.checked_add(field(sample)?));
    sum(|sample| sample.input_tokens) == report.usage.input_tokens
        && sum(|sample| sample.output_tokens) == report.usage.output_tokens
        && sum(|sample| sample.cached_input_tokens) == report.usage.cached_input_tokens
}

fn attributed_usage(usage: SessionUsage, cache_write: Option<u64>, model: Option<&str>, timestamp: Option<String>, record: usize, id: String) -> AttributedUsage {
    let sample = UsageSample {
        id: if id.len() > 512 { format!("usage-record-{record}") } else { id },
        model: model.filter(|value| !value.trim().is_empty() && value.len() <= 512).map(str::to_owned),
        timestamp: timestamp.and_then(|value| sample_timestamp(&value)),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cached_input_tokens: usage.cached_input_tokens,
        cache_write_input_tokens: cache_write,
        source: format!("parsed record {}", record + 1),
    };
    AttributedUsage { usage, sample, record }
}

fn sanitize_sample_cache(sample: &mut UsageSample) -> bool {
    let Some(input) = sample.input_tokens else { return false; };
    let invalid = sample.cached_input_tokens.is_some_and(|read| read > input)
        || sample.cache_write_input_tokens.is_some_and(|write| write > input)
        || sample.cached_input_tokens.zip(sample.cache_write_input_tokens).is_some_and(|(read, write)| read.checked_add(write).is_none_or(|cache| cache > input));
    if invalid {
        sample.cached_input_tokens = None;
        sample.cache_write_input_tokens = None;
    }
    invalid
}

fn sample_timestamp(value: &str) -> Option<String> {
    if value.len() > 128 || !value.is_ascii() { return None; }
    if value.bytes().all(|byte| byte.is_ascii_digit()) { return value.parse::<u64>().ok().and_then(epoch_millis_iso); }
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || bytes[13] != b':' || bytes[16] != b':' { return None; }
    let parse = |start: usize, end: usize| -> Option<u32> {
        let part = &value[start..end];
        if !part.bytes().all(|byte| byte.is_ascii_digit()) { return None; }
        part.parse().ok()
    };
    let year = parse(0, 4)?;
    let month = parse(5, 7)?;
    let day = parse(8, 10)?;
    if year == 0 || !(1..=12).contains(&month) || parse(11, 13)? > 23 || parse(14, 16)? > 59 || parse(17, 19)? > 59 { return None; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if day == 0 || day > days[(month - 1) as usize] { return None; }
    let mut zone = 19;
    if bytes[zone] == b'.' {
        zone += 1;
        let start = zone;
        while zone < bytes.len() && bytes[zone].is_ascii_digit() { zone += 1; }
        if start == zone { return None; }
    }
    if bytes.get(zone) == Some(&b'Z') && zone + 1 == bytes.len() { return Some(value.into()); }
    if zone + 6 != bytes.len() || !matches!(bytes[zone], b'+' | b'-') || bytes[zone + 3] != b':' || parse(zone + 1, zone + 3)? > 23 || parse(zone + 4, zone + 6)? > 59 { return None; }
    Some(value.into())
}

fn ordered_samples<'a>(entries: impl Iterator<Item = &'a AttributedUsage>) -> Vec<UsageSample> {
    let mut entries: Vec<_> = entries.collect();
    entries.sort_by_key(|entry| entry.record);
    entries.into_iter().map(|entry| entry.sample.clone()).collect()
}

fn codex_cache_write(raw: &Value, usage: &SessionUsage) -> Option<u64> {
    if usage.input_tokens.is_none() && usage.output_tokens.is_none() { return None; }
    // Native Codex caching is cache-read unless a cache-write bucket is explicitly recorded.
    Some(number(raw, "cache_write_input_tokens").unwrap_or(0))
}

fn append_cumulative_sample(samples: &mut Vec<UsageSample>, previous: &mut Option<UsageSample>, current: UsageSample) {
    let mut delta = current.clone();
    if let Some(previous) = previous.as_ref() {
        let pairs = [
            (previous.input_tokens, current.input_tokens),
            (previous.output_tokens, current.output_tokens),
            (previous.cached_input_tokens, current.cached_input_tokens),
            (previous.cache_write_input_tokens, current.cache_write_input_tokens),
        ];
        if pairs.iter().all(|(before, after)| before == after) { return; }
        if pairs.iter().any(|(before, after)| matches!((before, after), (Some(before), Some(after)) if after < before)) {
            // Aggregate semantics keep the latest epoch after a reset. Its whole
            // accumulated amount cannot safely be attributed to the current call.
            samples.clear();
            delta.model = None;
            delta.timestamp = None;
            delta.source.push_str("; cumulative reset, attribution unknown");
        } else {
            let subtract = |current: Option<u64>, previous: Option<u64>| current.zip(previous).and_then(|(current, previous)| current.checked_sub(previous));
            delta.input_tokens = subtract(current.input_tokens, previous.input_tokens);
            delta.output_tokens = subtract(current.output_tokens, previous.output_tokens);
            delta.cached_input_tokens = subtract(current.cached_input_tokens, previous.cached_input_tokens);
            delta.cache_write_input_tokens = subtract(current.cache_write_input_tokens, previous.cache_write_input_tokens);
            delta.source.push_str("; difference from preceding cumulative usage");
        }
    } else {
        delta.source.push_str("; first recorded cumulative usage");
    }
    samples.push(delta);
    *previous = Some(current);
}

fn codex_usage(state: &mut Analysis, value: &Value) -> SessionUsage {
    if number(value, "total_tokens").is_some_and(|total| total > 0)
        && number(value, "input_tokens") == Some(0)
        && number(value, "output_tokens") == Some(0) {
        state.warn("Codex reported a nonzero total_tokens with zero input/output buckets. These contradictory placeholder buckets are shown as unknown, so they cannot produce a false zero-cost estimate.");
        return SessionUsage::default();
    }
    SessionUsage { input_tokens: number(value, "input_tokens"), output_tokens: number(value, "output_tokens"), cached_input_tokens: number(value, "cached_input_tokens").or_else(|| number(value, "cache_read_input_tokens")), reasoning_tokens: number(value, "reasoning_output_tokens").or_else(|| number(value, "reasoning_tokens")), basis: String::new() }
}
fn update_cumulative(state: &mut Analysis, current: &mut Option<SessionUsage>, next: SessionUsage) {
    if current.as_ref().is_some_and(|previous| {
        [(previous.input_tokens, next.input_tokens), (previous.output_tokens, next.output_tokens)]
            .iter().any(|(before, after)| matches!((before, after), (Some(before), Some(after)) if after < before))
    }) {
        state.report.usage_samples_complete = false;
        state.warn("Codex cumulative usage decreased during this log, suggesting a reset or inherited epoch. The latest reported total is shown; it may omit earlier activity and cannot establish complete session cost.");
    }
    *current = Some(next);
}
fn split_cache_usage(value: &Value, input: &str, output: &str, read: &str, write: &str, reasoning: &str) -> SessionUsage {
    SessionUsage { input_tokens: number(value, input).map(|input| input.saturating_add(number(value, read).unwrap_or(0)).saturating_add(number(value, write).unwrap_or(0))), output_tokens: number(value, output), cached_input_tokens: Some(number(value, read).unwrap_or(0)), reasoning_tokens: number(value, reasoning), basis: String::new() }
}
fn add_value(total: &mut Option<u64>, value: Option<u64>) { if let Some(value) = value { *total = Some(total.unwrap_or(0).saturating_add(value)); } }
fn add_usage(total: &mut SessionUsage, value: &SessionUsage) {
    add_value(&mut total.input_tokens, value.input_tokens); add_value(&mut total.output_tokens, value.output_tokens);
    add_value(&mut total.cached_input_tokens, value.cached_input_tokens); add_value(&mut total.reasoning_tokens, value.reasoning_tokens);
}
fn subtract_usage(total: &mut SessionUsage, value: &SessionUsage) {
    for (total, previous) in [(&mut total.input_tokens, value.input_tokens), (&mut total.output_tokens, value.output_tokens), (&mut total.cached_input_tokens, value.cached_input_tokens), (&mut total.reasoning_tokens, value.reasoning_tokens)] {
        if let (Some(total), Some(previous)) = (total.as_mut(), previous) { *total = total.saturating_sub(previous); }
    }
}
fn sum_usage<'a>(values: impl Iterator<Item = &'a SessionUsage>) -> SessionUsage { let mut total = SessionUsage::default(); for value in values { add_usage(&mut total, value); } total }

fn concrete_path(path: &str, cwd: Option<&str>) -> Option<String> {
    let path = path.trim();
    if path.is_empty() || path.len() > 4096 || path.starts_with('-') || path.contains(['\n', '\r', '\0', '$', '*', '?', '`', '{', '}', '<', '>']) || path.starts_with('(') || path.ends_with(')') || path.contains("://") { return None; }
    let path = path.replace('\\', "/");
    let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':') || path.starts_with('~');
    Some(if absolute { path } else if let Some(cwd) = cwd { format!("{}/{}", cwd.replace('\\', "/").trim_end_matches('/'), path) } else { path })
}

#[derive(Clone, Copy, PartialEq)]
enum ShellSeparator { Sequential, Pipe, And, Conditional }
struct ShellCommand { words: Vec<String>, after: ShellSeparator, ambiguous: bool }

fn shell_name(words: &[String]) -> String {
    words.first().map(|word| word.rsplit(['/', '\\']).next().unwrap_or(word).to_ascii_lowercase()).unwrap_or_default()
}

fn changes_directory(name: &str) -> bool { matches!(name, "cd" | "chdir" | "sl" | "set-location") }

fn opaque_shell_command(name: &str) -> bool {
    matches!(name, "pushd" | "popd" | "push-location" | "pop-location" | "source" | "." | "eval" | "iex" | "invoke-expression" | "call"
        | "if" | "then" | "else" | "elif" | "fi" | "for" | "foreach" | "while" | "until" | "do" | "done" | "case" | "esac" | "switch" | "function" | "try" | "catch" | "finally")
        || (name.len() == 2 && name.as_bytes()[0].is_ascii_alphabetic() && name.ends_with(':'))
}

/// Resolve portable lexical paths without consulting or changing the filesystem.
fn shell_absolute_path(path: &str, cwd: Option<&str>) -> Option<String> {
    if path.starts_with('~') || path.contains(['%', '!', '[', ']']) { return None; }
    if path.starts_with('\\') && !path.starts_with("\\\\") { return None; } // Windows drive-root-relative path.
    let portable = path.replace('\\', "/");
    if portable.as_bytes().get(1) == Some(&b':') && portable.as_bytes().get(2) != Some(&b'/') { return None; }
    let absolute = portable.starts_with('/') || portable.as_bytes().get(1) == Some(&b':');
    if !absolute && cwd.is_none() { return None; }
    let combined = concrete_path(&portable, cwd)?;
    let (prefix, rest) = if combined.starts_with("//") { ("//".to_string(), &combined[2..]) }
        else if combined.starts_with('/') { ("/".to_string(), &combined[1..]) }
        else if combined.as_bytes().get(1) == Some(&b':') && combined.as_bytes().get(2) == Some(&b'/') { (combined[..3].to_string(), &combined[3..]) }
        else { return None; };
    let mut parts = Vec::new();
    for part in rest.split('/') {
        match part { "" | "." => {}, ".." => { parts.pop()?; }, _ => parts.push(part) }
    }
    Some(format!("{prefix}{}", parts.join("/")))
}

fn directory_argument(words: &[String]) -> Option<&str> {
    let arguments = &words[1..];
    match arguments {
        [path] if !path.starts_with('-') && !path.eq_ignore_ascii_case("/d") => Some(path),
        [flag, path] if matches!(flag.to_ascii_lowercase().as_str(), "/d" | "--" | "-path" | "-literalpath") => Some(path),
        _ => None,
    }
}

/// Literal operands only. Unknown directory changes never fall back to the initial cwd.
fn shell_paths(command: &str, cwd: Option<&str>) -> (Vec<(String, &'static str)>, bool) {
    let commands = shell_commands(command);
    let mut current = cwd.and_then(|cwd| shell_absolute_path(cwd, None));
    let mut result = Vec::new();
    let mut uncertain = false;
    let mut opaque = false;
    let mut allow_unbased = cwd.is_none();
    let mut guarded = false;
    let mut guarded_directory = false;
    let mut index = 0;
    while index < commands.len() {
        let mut end = index;
        while end + 1 < commands.len() && commands[end].after == ShellSeparator::Pipe { end += 1; }
        // Shells differ on whether a directory change in a pipeline affects the caller.
        if end > index && commands[index..=end].iter().any(|part| changes_directory(&shell_name(&part.words))) {
            opaque = true;
            current = None;
            allow_unbased = false;
            uncertain = true;
        }
        for part in &commands[index..=end] {
            let name = shell_name(&part.words);
            if part.ambiguous || opaque_shell_command(&name) {
                opaque = true;
                current = None;
                allow_unbased = false;
                uncertain = true;
            }
            if changes_directory(&name) {
                allow_unbased = false;
                guarded_directory |= guarded || part.after == ShellSeparator::And;
                current = if opaque { None } else { directory_argument(&part.words).and_then(|path| shell_absolute_path(path, current.as_deref())) };
                uncertain |= current.is_none();
            } else {
                for (path, operation) in shell_operands(&part.words) {
                    if let Some(path) = shell_absolute_path(&path, current.as_deref()) { result.push((path, operation)); }
                    else if allow_unbased && !path.starts_with(['/', '\\', '~']) && path.as_bytes().get(1) != Some(&b':') && !path.contains(['%', '!', '[', ']']) {
                        if let Some(path) = concrete_path(&path, None) { result.push((path, operation)); }
                        else { uncertain = true; }
                    }
                    else { uncertain = true; }
                }
            }
            if part.after == ShellSeparator::And { guarded = true; }
            if part.after == ShellSeparator::Conditional {
                opaque = true;
                current = None;
                allow_unbased = false;
                uncertain = true;
            }
            if part.after == ShellSeparator::Sequential {
                // A guarded read knows preceding cd commands succeeded. After a
                // branch rejoins, a skipped cd leaves more than one possible cwd.
                if guarded && guarded_directory { current = None; allow_unbased = false; }
                guarded = false;
                guarded_directory = false;
            }
        }
        index = end + 1;
    }
    (result, uncertain)
}

fn shell_operands(words: &[String]) -> Vec<(String, &'static str)> {
        let mut result = Vec::new();
        let command = shell_name(words);
        let operation = match command.as_str() {
            "cat" | "get-content" | "type" | "head" | "tail" => "read",
            "get-childitem" | "ls" | "dir" | "find" => "list",
            "rg" | "grep" | "select-string" => if words.iter().any(|word| word == "--files") { "list" } else { "search" },
            "set-content" | "add-content" | "out-file" | "tee" => "write",
            _ => return result,
        };
        let mut paths = Vec::new();
        let mut position = 1;
        let mut pattern_seen = operation != "search";
        while position < words.len() {
            let word = &words[position];
            let lower = word.to_ascii_lowercase();
            if word == ">" || word == ">>" {
                if let Some(path) = words.get(position + 1) { result.push((path.clone(), "write")); }
                position += 2;
                continue;
            }
            if matches!(lower.as_str(), "-path" | "-literalpath" | "-filepath") {
                if let Some(path) = words.get(position + 1) { paths.push(path.clone()); }
                position += 2;
                continue;
            }
            if matches!(lower.as_str(), "-pattern" | "-e" | "--regexp") { pattern_seen = true; position += 2; continue; }
            if matches!(lower.as_str(), "-value" | "-encoding" | "-filter" | "-include" | "-exclude" | "-name" | "-iname" | "-type" | "--color" | "--colors")
                || (matches!(word.as_str(), "-n" | "-c") && matches!(command.as_str(), "head" | "tail"))
                || matches!(word.as_str(), "--glob" | "-g" | "--type" | "-t" | "--type-not" | "--max-count" | "-m" | "--context" | "-C" | "--before-context" | "-B" | "--after-context" | "-A") {
                position += 2; continue;
            }
            if word.starts_with('-') { position += 1; continue; }
            if !pattern_seen { pattern_seen = true; } else if operation != "write" || paths.is_empty() { paths.push(word.clone()); }
            position += 1;
        }
        if paths.is_empty() && (operation == "list" || operation == "search") { paths.push(".".into()); }
        for path in paths { result.push((path, operation)); }
    result
}

fn shell_commands(input: &str) -> Vec<ShellCommand> {
    let mut commands = Vec::new();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut ambiguous = false;
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if let Some(mark) = quote {
            if ch == mark {
                if mark == '\'' && chars.peek() == Some(&'\'') { word.push(chars.next().unwrap()); } else { quote = None; }
            } else { word.push(ch); }
        } else if ch == '\'' || ch == '"' { quote = Some(ch); }
        else if ch == '#' && word.is_empty() {
            for next in chars.by_ref() { if next == '\n' { break; } }
            if !words.is_empty() { commands.push(ShellCommand { words: std::mem::take(&mut words), after: ShellSeparator::Sequential, ambiguous }); }
            ambiguous = false;
        }
        else if ch == ';' || ch == '|' || ch == '\n' || ch == '&' {
            if !word.is_empty() { words.push(std::mem::take(&mut word)); }
            let after = if ch == '&' && chars.peek() == Some(&'&') {
                chars.next();
                ShellSeparator::And
            } else if ch == '&' || (ch == '|' && chars.peek() == Some(&'|')) {
                if chars.peek() == Some(&ch) { chars.next(); }
                ShellSeparator::Conditional
            } else if ch == '|' { ShellSeparator::Pipe } else { ShellSeparator::Sequential };
            if !words.is_empty() { commands.push(ShellCommand { words: std::mem::take(&mut words), after, ambiguous }); }
            ambiguous = false;
        } else if ch.is_whitespace() {
            if !word.is_empty() { words.push(std::mem::take(&mut word)); }
        } else {
            ambiguous |= matches!(ch, '(' | ')' | '{' | '}' | '`' | '<') || (ch == '\\' && chars.peek().is_some_and(|next| next.is_whitespace() || matches!(*next, ';' | '|' | '&')));
            word.push(ch);
        }
    }
    if quote.is_none() {
        if !word.is_empty() { words.push(word); }
        if !words.is_empty() { commands.push(ShellCommand { words, after: ShellSeparator::Sequential, ambiguous }); }
    }
    commands
}

/// Scan JS literals without executing orchestration code. Dynamic arguments stay opaque.
fn nested_calls(script: &str) -> Vec<(String, String)> {
    let bytes = script.as_bytes();
    let mut calls = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        if matches!(bytes[offset], b'\'' | b'"' | b'`') { offset = skip_quoted(bytes, offset); continue; }
        if bytes[offset..].starts_with(b"//") { offset += bytes[offset..].iter().position(|byte| *byte == b'\n').unwrap_or(bytes.len() - offset); continue; }
        if bytes[offset..].starts_with(b"/*") { offset += 2; while offset + 1 < bytes.len() && &bytes[offset..offset + 2] != b"*/" { offset += 1; } offset = (offset + 2).min(bytes.len()); continue; }
        if bytes[offset..].starts_with(b"tools.") {
            let start = offset + 6;
            let mut end = start;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') { end += 1; }
            let name = &script[start..end];
            let mut open = end;
            while open < bytes.len() && bytes[open].is_ascii_whitespace() { open += 1; }
            if open < bytes.len() && bytes[open] == b'(' {
                let mut close = open + 1;
                let mut depth = 1;
                while close < bytes.len() && depth > 0 {
                    match bytes[close] {
                        b'\'' | b'"' | b'`' => { close = skip_quoted(bytes, close); continue; }
                        b'(' => depth += 1,
                        b')' => depth -= 1,
                        _ => {}
                    }
                    if depth > 0 { close += 1; }
                }
                if depth == 0 && !name.is_empty() {
                    let raw = script[open + 1..close].trim();
                    let arguments = parse_literal(raw, 0).map(|(value, end)| if raw[end..].trim().is_empty() { value } else { raw.into() }).unwrap_or_else(|| raw.into());
                    calls.push((name.into(), arguments));
                    offset = close + 1;
                    continue;
                }
            }
        }
        offset += 1;
    }
    calls
}

fn skip_quoted(bytes: &[u8], offset: usize) -> usize {
    let mark = bytes[offset];
    let mut index = offset + 1;
    while index < bytes.len() {
        if bytes[index] == b'\\' { index = (index + 2).min(bytes.len()); continue; }
        if bytes[index] == mark { return index + 1; }
        index += 1;
    }
    bytes.len()
}

fn parse_literal(input: &str, offset: usize) -> Option<(String, usize)> {
    let bytes = input.as_bytes();
    let mark = *bytes.get(offset)?;
    if mark != b'\'' && mark != b'"' && mark != b'`' { return None; }
    let end = skip_quoted(bytes, offset);
    if end <= offset + 1 || bytes.get(end - 1) != Some(&mark) { return None; }
    let raw = &input[offset..end];
    if mark == b'"' { if let Ok(value) = serde_json::from_str::<String>(raw) { return Some((value, end)); } }
    let inner = &input[offset + 1..end - 1];
    if mark == b'`' && inner.contains("${") { return None; }
    let mut result = String::new();
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' { result.push(ch); continue; }
        match chars.next()? {
            'n' => result.push('\n'), 'r' => result.push('\r'), 't' => result.push('\t'), '\\' => result.push('\\'), '\'' => result.push('\''), '"' => result.push('"'), '`' => result.push('`'), _ => return None,
        }
    }
    Some((result, end))
}

fn literal_property(input: &str, key: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let (candidate, end) = if matches!(bytes[index], b'\'' | b'"' | b'`') {
            let end = skip_quoted(bytes, index);
            (input.get(index + 1..end.saturating_sub(1)).unwrap_or(""), end)
        } else if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let start = index;
            while index < bytes.len() && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_') { index += 1; }
            (&input[start..index], index)
        } else { index += 1; continue; };
        index = end;
        if candidate != key { continue; }
        while index < bytes.len() && bytes[index].is_ascii_whitespace() { index += 1; }
        if bytes.get(index) != Some(&b':') { continue; }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() { index += 1; }
        if let Some((value, end)) = parse_literal(input, index) {
            let tail = input[end..].trim_start();
            if tail.is_empty() || tail.starts_with([',', '}']) { return Some(value); }
        }
    }
    None
}

fn now_iso() -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    epoch_millis_iso(millis).unwrap_or_else(|| "1970-01-01T00:00:00.000Z".into())
}

fn epoch_millis_iso(millis: u64) -> Option<String> {
    // Match the portable contract's four-digit year range; DSH event times are epoch milliseconds.
    if millis > 253_402_300_799_999 { return None; }
    let seconds = millis / 1000;
    // Gregorian civil date from days since Unix epoch, with no platform timezone dependency.
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = days / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    Some(format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", seconds / 3600 % 24, seconds / 60 % 60, seconds % 60, millis % 1000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn preview(agent: &str) -> SessionPreview {
        SessionPreview { source_path: "fixture.jsonl".into(), id: "session-1".into(), agent: agent.into(), title: "Fixture".into(), project: Some("D:/project".into()), modified_at: 0, size_bytes: 0, tower: "unknown".into() }
    }

    #[test]
    fn codex_counts_latest_cumulative_usage_and_actual_skill_reads() {
        let records = vec![
            json!({"type":"session_meta","payload":{"id":"original","base_instructions":{"text":"Available skills: imaginary/SKILL.md"}}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"Get-Content -LiteralPath skills/example/SKILL.md; rg --files src\"}","call_id":"c1"}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"Exit code: 0\nOutput: skill instructions"}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"cached_input_tokens":20}}}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":140,"output_tokens":20,"cached_input_tokens":30}}}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":140,"output_tokens":20,"cached_input_tokens":30}}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.usage.input_tokens, Some(140));
        assert_eq!(report.usage.output_tokens, Some(20));
        assert_eq!(report.events.iter().filter(|event| event.kind == "skill").count(), 1);
        assert!(report.events.iter().filter(|event| event.call_id.as_deref() == Some("c1")).all(|event| event.status == "success"));
        assert!(report.files.iter().any(|file| file.path == "D:/project/skills/example/SKILL.md" && file.operation == "read"));
        assert!(report.files.iter().any(|file| file.path == "D:/project/src" && file.operation == "list"));
        assert_eq!(report.cost.amount, None);
    }

    #[test]
    fn orchestration_is_not_evaluated_and_only_literal_paths_are_inferred() {
        let script = "const ignored = 'tools.mcp__fake__read({path: \"no\"})'; await tools.exec_command({cmd: 'cat src/main.rs', workdir: 'D:/repo'}); await tools.mcp__real__search({query: 'hello'}); await tools.apply_patch('*** Begin Patch\\n*** Update File: src/main.rs\\n*** End Patch');";
        let report = analyze(preview("codex"), &[json!({"type":"response_item","payload":{"type":"function_call","name":"functions.exec","arguments":script,"call_id":"outer"}})], vec![]);
        assert_eq!(report.events.iter().filter(|event| event.kind == "mcp").count(), 1);
        assert!(report.events.iter().filter(|event| event.kind == "mcp").all(|event| event.status == "unknown"));
        assert!(report.files.iter().any(|file| file.path == "D:/repo/src/main.rs" && file.evidence == "inferred"));
        assert!(report.files.iter().any(|file| file.operation == "write"));
        assert!(concrete_path("$file", None).is_none());
        assert!(literal_property("{cmd: 'cat ' + variable}", "cmd").is_none());
    }

    #[test]
    fn claude_replaces_repeated_message_usage_and_handles_failed_and_malformed_tools() {
        let records = vec![
            json!({"type":"assistant","message":{"id":"same","content":[{"type":"tool_use","id":"read","name":"Read","input":{"file_path":"missing.rs"}}],"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}),
            json!({"type":"assistant","message":{"id":"same","content":[{"type":"text","text":"Done"}],"usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read","content":"not found","is_error":true}]}}),
            json!({"type":"assistant","message":{"id":"two","content":[{"type":"tool_use","id":"bad","name":"Read","input":"{broken"}]}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"missing-call","content":"orphan"}]}}),
            json!({"type":"cost-state","totalCostUSD":0.12,"hasUnknownModelCost":true}),
        ];
        let report = analyze(preview("claude"), &records, vec![]);
        assert_eq!(report.usage.input_tokens, Some(17));
        assert_eq!(report.usage.output_tokens, Some(3));
        assert_eq!(report.usage.cached_input_tokens, Some(5));
        assert_eq!(report.cost.amount, Some(0.12));
        assert!(report.files.is_empty());
        assert!(report.events.iter().any(|event| event.call_id.as_deref() == Some("read") && event.status == "error"));
        assert!(report.warnings.iter().any(|warning| warning.contains("not valid JSON")));
        assert!(report.warnings.iter().any(|warning| warning.contains("no matching")));
    }

    #[test]
    fn dsh_handles_cache_buckets_retry_attempts_seed_and_context_sources() {
        let records = vec![
            json!({"version":4,"id":"fork","isSeeded":true}),
            json!({"type":"assistant/message","data":{"turn":0,"step":0,"message":{"content":"inherited"},"usage":{"inputTokens":900,"outputTokens":900}}}),
            json!({"type":"session/end-seed","data":{"inherited":true}}),
            json!({"type":"user/message","data":{"source":{"kind":"skill-catalog"},"message":{"content":"Available skill: example"}}}),
            json!({"type":"tool/call","data":{"name":"skill","arguments":"{\"name\":\"example\"}","callId":"skill-1"}}),
            json!({"type":"assistant/attempt","data":{"turn":1,"step":0,"stream":[{"type":"chunk","chunk":{"type":"usage","usage":{"inputTokens":10,"outputTokens":2,"cacheReadTokens":5,"cacheWriteTokens":3}}}]}}),
            json!({"type":"assistant/message","data":{"turn":1,"step":0,"message":{"content":"hello"},"usage":{"inputTokens":10,"outputTokens":4,"cacheReadTokens":5,"cacheWriteTokens":3}}}),
            json!({"type":"llm/retry-started","data":{"turn":1,"step":0}}),
            json!({"type":"assistant/message","data":{"turn":1,"step":0,"message":{"content":"retry"},"usage":{"inputTokens":2,"outputTokens":1}}}),
        ];
        let report = analyze(preview("dsh"), &records, vec![]);
        assert_eq!(report.usage.input_tokens, Some(20));
        assert_eq!(report.usage.output_tokens, Some(5));
        assert_eq!(report.usage.cached_input_tokens, Some(5));
        assert_eq!(report.events.iter().filter(|event| event.kind == "skill").count(), 1);
        assert!(report.events.iter().any(|event| event.kind == "context" && event.name == "skill-catalog"));
    }

    #[test]
    fn newer_codex_totals_do_not_double_count_and_empty_usage_stays_unknown() {
        let records = vec![
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":2}}}}),
            json!({"type":"token_usage_record","payload":{"response_id":"a","usage":{"input_tokens":20,"output_tokens":3},"thread_token_usage":{"input_tokens":30,"output_tokens":5}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.usage.input_tokens, Some(30));
        assert_eq!(report.usage.output_tokens, Some(5));
        assert!(analyze(preview("dsh"), &[], vec![]).usage.input_tokens.is_none());
        assert!(report.analyzed_at.ends_with('Z'));
    }

    #[test]
    fn dsh_preserves_human_messages_and_records_instruction_file_injections() {
        let records = vec![
            json!({"type":"user/message","data":{"source":{"kind":"user"},"content":[{"type":"text","text":"Please help"}]}}),
            json!({"type":"user/message","data":{"source":{"kind":"agent-instructions","changes":[{"action":"set","path":"AGENTS.md"},{"action":"remove","path":"old.md"}]},"content":[{"type":"text","text":"Instructions"}]}}),
            json!({"type":"tool/call","data":{"name":"pwsh","arguments":"{\"command\":\"Get-Content src/main.rs\"}","callId":"ps"}}),
            json!({"type":"tool/call","data":{"name":"read_image","arguments":"{\"file_path\":\"image.png\"}","callId":"image"}}),
            json!({"type":"tool/call","data":{"name":"str_replace_editor","arguments":"{\"command\":\"view\",\"path\":\"config.json\"}","callId":"view"}}),
        ];
        let report = analyze(preview("dsh"), &records, vec![]);
        assert_eq!(report.events[0].kind, "message");
        for suffix in ["AGENTS.md", "src/main.rs", "image.png", "config.json"] {
            assert!(report.files.iter().any(|file| file.path.ends_with(suffix) && file.operation == "read"));
        }
        assert!(!report.files.iter().any(|file| file.path.ends_with("old.md")));
    }

    #[test]
    fn shell_path_roles_do_not_treat_write_contents_or_patterns_as_read_paths() {
        assert_eq!(shell_paths("Set-Content output.txt 'some contents'", Some("/project")).0, vec![("/project/output.txt".into(), "write")]);
        assert_eq!(shell_paths("cat input.txt > output.txt", Some("/project")).0, vec![("/project/output.txt".into(), "write"), ("/project/input.txt".into(), "read")]);
        assert_eq!(shell_paths("rg -n --color never -g '*.rs' 'needle' src", Some("/project")).0, vec![("/project/src".into(), "search")]);
        assert_eq!(shell_paths("head -n 20 src/main.rs", Some("/project")).0, vec![("/project/src/main.rs".into(), "read")]);
    }

    #[test]
    fn shell_reads_after_literal_cd_use_the_directory_at_that_point_in_the_call() {
        let records = vec![
            json!({"type":"assistant","cwd":"/project","message":{"content":[{"type":"tool_use","id":"inspect","name":"Bash","input":{"command":"cd /project/Assets/App/Scripts; head -30 Core/UI/Browser/Selection.cs; grep -rln \"Selection\" --include=*.cs . | head"}}]}}),
            json!({"type":"user","cwd":"/project/Assets/App/Scripts","message":{"content":[{"type":"tool_result","tool_use_id":"inspect","content":"fixture code\n./Core/UI/Browser/Selection.cs","is_error":false}]}}),
        ];
        let report = analyze(preview("claude"), &records, vec![]);
        assert!(report.files.iter().any(|file| file.path == "/project/Assets/App/Scripts/Core/UI/Browser/Selection.cs" && file.operation == "read" && file.evidence == "inferred"));
        assert!(report.files.iter().any(|file| file.path == "/project/Assets/App/Scripts" && file.operation == "search"));
        assert!(!report.files.iter().any(|file| file.path == "/project/Core/UI/Browser/Selection.cs"));
        assert_eq!(report.events[0].status, "success");
    }

    #[test]
    fn shell_directory_tracking_normalizes_chained_relative_and_quoted_paths() {
        let (paths, uncertain) = shell_paths("cd Assets; cd 'App Scripts'; head one.cs; cd ../Scripts; cat two.cs > out.txt", Some("/project"));
        assert_eq!(paths, vec![("/project/Assets/App Scripts/one.cs".into(), "read"), ("/project/Assets/Scripts/out.txt".into(), "write"), ("/project/Assets/Scripts/two.cs".into(), "read")]);
        assert!(!uncertain);
    }

    #[test]
    fn shell_directory_tracking_supports_windows_and_powershell_literal_forms() {
        let (paths, uncertain) = shell_paths(r#"CD /d D:\work\scripts; TYPE component.cs; Set-Location -LiteralPath 'D:\work\other files'; Get-Content other.cs; sl ..; chdir child; cat final.txt"#, Some("C:/project"));
        assert_eq!(paths, vec![("D:/work/scripts/component.cs".into(), "read"), ("D:/work/other files/other.cs".into(), "read"), ("D:/work/child/final.txt".into(), "read")]);
        assert!(!uncertain);
    }

    #[test]
    fn unresolved_shell_directories_withhold_relative_paths_but_keep_absolute_evidence() {
        for target in ["$ROOT", "%ROOT%", "~", "-", "/d", "C:relative", r"\drive-relative"] {
            let (paths, uncertain) = shell_paths(&format!("cd {target}; cat relative.txt; cat /known/absolute.txt"), Some("/project"));
            assert_eq!(paths, vec![("/known/absolute.txt".into(), "read")], "{target}");
            assert!(uncertain, "{target}");
        }
        let (paths, uncertain) = shell_paths("cd $ROOT; cd /known; cat recovered.txt", Some("/project"));
        assert_eq!(paths, vec![("/known/recovered.txt".into(), "read")]);
        assert!(uncertain);
    }

    #[test]
    fn conditional_pipeline_and_grouped_directory_changes_do_not_assert_relative_paths() {
        for command in [
            "cd child || cat relative.txt", "cd first && cd second; cat relative.txt",
            "(cd child; cat nested.txt); cat after.txt", "cd child | cat piped.txt; cat after.txt",
            "if test -d child; then cd child; cat nested.txt; fi; cat after.txt",
            "pushd child; cat relative.txt", "source setup.sh; cat relative.txt",
        ] {
            let (paths, uncertain) = shell_paths(command, Some("/project"));
            assert!(paths.is_empty(), "{command}: {paths:?}");
            assert!(uncertain, "{command}");
        }
    }

    #[test]
    fn guarded_shell_chains_resolve_paths_but_withhold_paths_after_a_directory_branch_merges() {
        let (paths, uncertain) = shell_paths("cd Assets && cd Scripts && cat guarded.cs; cat ambiguous.cs; cd /known; cat restored.cs", Some("/project"));
        assert_eq!(paths, vec![("/project/Assets/Scripts/guarded.cs".into(), "read"), ("/known/restored.cs".into(), "read")]);
        assert!(uncertain);
        let (paths, uncertain) = shell_paths("cd 'D:/app scripts' && type source.cs", Some("D:/project"));
        assert_eq!(paths, vec![("D:/app scripts/source.cs".into(), "read")]);
        assert!(!uncertain);
    }

    #[test]
    fn missing_initial_cwd_preserves_relative_operands_without_falling_back_after_dynamic_cd() {
        let (paths, uncertain) = shell_paths("cat initial.txt; cd $ROOT; cat ambiguous.txt; cat /known/absolute.txt", None);
        assert_eq!(paths, vec![("initial.txt".into(), "read"), ("/known/absolute.txt".into(), "read")]);
        assert!(uncertain);
    }

    #[test]
    fn shell_workdir_override_and_guessed_changes_are_local_to_one_call() {
        let records = vec![
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":{"cmd":"cd child; cat first.txt","workdir":"D:/override"},"call_id":"first"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":{"cmd":"cat second.txt"},"call_id":"second"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":{"cmd":"cd $ROOT; cat unknown.txt"},"call_id":"unknown"}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), ["D:/override/child/first.txt", "D:/project/second.txt"]);
        assert!(report.warnings.iter().any(|warning| warning.contains("working directory or shell control flow was unresolved")));
    }

    #[test]
    fn nested_scripts_are_bounded_and_cumulative_resets_are_disclosed() {
        let mut script = "tools.exec_command({cmd:'cat file.txt'})".to_owned();
        for _ in 0..12 { script = format!("tools.exec({})", serde_json::to_string(&script).unwrap()); }
        let records = vec![
            json!({"type":"response_item","payload":{"type":"function_call","name":"functions.exec","arguments":script}}),
            json!({"type":"session_meta","payload":{"id":"child"}}),
            json!({"type":"session_meta","payload":{"id":"parent"}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":20}}}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":2}}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert!(report.events.len() <= 9);
        assert!(report.files.is_empty());
        assert!(report.warnings.iter().any(|warning| warning.contains("eight layers")));
        assert!(report.warnings.iter().any(|warning| warning.contains("cumulative usage decreased")));
        assert!(report.warnings.iter().any(|warning| warning.contains("Multiple Codex session identities")));
        assert_eq!(report.usage.input_tokens, Some(10));
    }

    #[test]
    fn recorded_working_directory_changes_affect_paths_without_changing_project_grouping() {
        let records = vec![
            json!({"type":"turn_context","payload":{"cwd":"D:/first"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"cat first.txt\"}","call_id":"first"}}),
            json!({"type":"turn_context","payload":{"cwd":"D:/second"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"cat second.txt\"}","call_id":"second"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"cat explicit.txt\",\"workdir\":\"D:/override\"}","call_id":"explicit"}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.session.project.as_deref(), Some("D:/project"));
        for path in ["D:/first/first.txt", "D:/second/second.txt", "D:/override/explicit.txt"] {
            assert!(report.files.iter().any(|file| file.path == path));
        }
        let records = vec![
            json!({"type":"assistant","cwd":"D:/first","message":{"content":[{"type":"tool_use","id":"first","name":"Read","input":{"file_path":"first.txt"}}]}}),
            json!({"type":"assistant","cwd":"D:/second","message":{"content":[{"type":"tool_use","id":"second","name":"Read","input":{"file_path":"second.txt"}}]}}),
            json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"third","name":"Read","input":{"file_path":"third.txt"}}]}}),
        ];
        let report = analyze(preview("claude"), &records, vec![]);
        assert_eq!(report.session.project.as_deref(), Some("D:/project"));
        for path in ["D:/first/first.txt", "D:/second/second.txt", "D:/second/third.txt"] {
            assert!(report.files.iter().any(|file| file.path == path));
        }
    }

    #[test]
    fn external_import_placeholder_usage_is_unknown_instead_of_zero() {
        let records = vec![
            json!({"type":"turn_context","payload":{"turn_id":"external-import-123","cwd":"D:/project"}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":0,"output_tokens":0,"cached_input_tokens":0,"reasoning_output_tokens":0,"total_tokens":101834}}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert!(report.usage.input_tokens.is_none());
        assert!(report.usage.output_tokens.is_none());
        assert!(report.usage.cached_input_tokens.is_none());
        assert!(report.usage.reasoning_tokens.is_none());
        assert!(report.warnings.iter().any(|warning| warning.contains("external-import")));
        assert!(report.warnings.iter().any(|warning| warning.contains("contradictory placeholder")));
        let zero = analyze(preview("codex"), &[json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}})], vec![]);
        assert_eq!(zero.usage.input_tokens, Some(0));
        assert_eq!(zero.usage.output_tokens, Some(0));
    }

    #[test]
    fn codex_usage_samples_deduplicate_cumulative_records_and_preserve_model_changes() {
        let records = vec![
            json!({"type":"turn_context","payload":{"model":"gpt-a"}}),
            json!({"timestamp":"2026-10-27T00:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":20,"cached_input_tokens":40}}}}),
            json!({"timestamp":"2026-10-27T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":20,"cached_input_tokens":40}}}}),
            json!({"type":"turn_context","payload":{"model":"gpt-b"}}),
            json!({"timestamp":"2026-10-27T01:00:00Z","type":"token_usage_record","payload":{"thread_token_usage":{"input_tokens":175,"output_tokens":35,"cached_input_tokens":50}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.usage_samples.len(), 2);
        assert_eq!(report.usage_samples[0].model.as_deref(), Some("gpt-a"));
        assert_eq!(report.usage_samples[0].timestamp.as_deref(), Some("2026-10-27T00:00:00Z"));
        assert_eq!(report.usage_samples[1].model.as_deref(), Some("gpt-b"));
        assert_eq!(report.usage_samples[1].timestamp.as_deref(), Some("2026-10-27T01:00:00Z"));
        assert_eq!(report.usage_samples[1].input_tokens, Some(75));
        assert_eq!(report.usage_samples[1].cached_input_tokens, Some(10));
        assert!(report.usage_samples.iter().all(|sample| sample.cache_write_input_tokens == Some(0)));
        assert!(report.usage_samples_complete);
        assert_sample_totals(&report);
    }

    #[test]
    fn claude_usage_samples_replace_message_snapshots_and_keep_cache_writes_separate() {
        let records = vec![
            json!({"timestamp":"2026-10-27T00:00:00Z","type":"assistant","message":{"id":"a","model":"claude-a","content":[],"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}),
            json!({"timestamp":"2026-10-27T00:00:10Z","type":"assistant","message":{"id":"a","model":"claude-a","content":[],"usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}),
            json!({"timestamp":"2026-10-27T01:00:00Z","type":"assistant","message":{"id":"b","model":"claude-b","content":[],"usage":{"input_tokens":10,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":3}}}),
        ];
        let report = analyze(preview("claude"), &records, vec![]);
        assert_eq!(report.usage_samples.len(), 2);
        assert_eq!(report.usage_samples[0].model.as_deref(), Some("claude-a"));
        assert_eq!(report.usage_samples[0].timestamp.as_deref(), Some("2026-10-27T00:00:10Z"));
        assert_eq!(report.usage_samples[0].input_tokens, Some(17));
        assert_eq!(report.usage_samples[0].output_tokens, Some(4));
        assert_eq!(report.usage_samples[0].cache_write_input_tokens, Some(2));
        assert_eq!(report.usage_samples[1].model.as_deref(), Some("claude-b"));
        assert_eq!(report.usage_samples[1].cache_write_input_tokens, Some(3));
        assert!(report.usage_samples_complete);
        assert_sample_totals(&report);
        let missing = analyze(preview("claude"), &[json!({"type":"assistant","message":{"id":"missing","usage":{"input_tokens":10,"output_tokens":1}}})], vec![]);
        assert!(missing.usage_samples[0].model.is_none());
        assert!(missing.usage_samples[0].timestamp.is_none());
        assert!(missing.usage_samples[0].cache_write_input_tokens.is_none());
        assert!(!missing.usage_samples_complete);
    }

    #[test]
    fn dsh_usage_samples_replace_attempts_but_preserve_retries_and_schema_cache_defaults() {
        let records = vec![
            json!({"type":"request/context","data":{"model":"deepseek-a"}}),
            json!({"time":100,"type":"assistant/attempt","data":{"turn":1,"step":0,"stream":[{"type":"chunk","chunk":{"type":"usage","usage":{"inputTokens":10,"outputTokens":2,"cacheReadTokens":5,"cacheWriteTokens":2}}}]}}),
            json!({"time":200,"type":"assistant/message","data":{"turn":1,"step":0,"message":{"source":{"model":"deepseek-a"},"content":"first"},"usage":{"inputTokens":10,"outputTokens":4,"cacheReadTokens":5,"cacheWriteTokens":2}}}),
            json!({"type":"llm/retry-started","data":{"turn":1,"step":0}}),
            json!({"type":"request/header","data":{"header":{"config":{"model":"deepseek-b"}}}}),
            json!({"time":300,"type":"assistant/attempt","data":{"turn":1,"step":0,"stream":[{"type":"chunk","chunk":{"type":"usage","usage":{"inputTokens":5,"outputTokens":1}}}]}}),
        ];
        let report = analyze(preview("dsh"), &records, vec![]);
        assert_eq!(report.usage_samples.len(), 2);
        assert_eq!(report.usage_samples[0].model.as_deref(), Some("deepseek-a"));
        assert_eq!(report.usage_samples[0].timestamp.as_deref(), Some("1970-01-01T00:00:00.200Z"));
        assert_eq!(report.usage_samples[0].input_tokens, Some(17));
        assert_eq!(report.usage_samples[0].cache_write_input_tokens, Some(2));
        assert_eq!(report.usage_samples[1].model.as_deref(), Some("deepseek-b"));
        assert_eq!(report.usage_samples[1].timestamp.as_deref(), Some("1970-01-01T00:00:00.300Z"));
        assert_eq!(report.usage_samples[1].cached_input_tokens, Some(0));
        assert_eq!(report.usage_samples[1].cache_write_input_tokens, Some(0));
        assert!(report.usage_samples_complete);
        assert_sample_totals(&report);
    }

    #[test]
    fn old_reports_deserialize_without_usage_samples() {
        let report = analyze(preview("codex"), &[], vec![]);
        let mut json = serde_json::to_value(report).unwrap();
        json.as_object_mut().unwrap().remove("usageSamples");
        json.as_object_mut().unwrap().remove("usageSamplesComplete");
        let report: GeneralChatAnalyze = serde_json::from_value(json).unwrap();
        assert!(report.usage_samples.is_empty());
        assert!(!report.usage_samples_complete);
    }

    #[test]
    fn codex_response_samples_keep_latest_usage_per_response_id() {
        let records = vec![
            json!({"timestamp":"2026-10-27T00:00:00Z","type":"token_usage_record","payload":{"response_id":"a","model":"gpt-a","usage":{"input_tokens":10,"output_tokens":1,"cached_input_tokens":3}}}),
            json!({"timestamp":"2026-10-27T00:00:05Z","type":"token_usage_record","payload":{"response_id":"a","model":"gpt-a","usage":{"input_tokens":10,"output_tokens":4,"cached_input_tokens":3}}}),
            json!({"timestamp":"2026-10-27T01:00:00Z","type":"token_usage_record","payload":{"response_id":"b","model":"gpt-b","usage":{"input_tokens":20,"output_tokens":6,"cached_input_tokens":5}}}),
        ];
        let report = analyze(preview("codex"), &records, vec![]);
        assert_eq!(report.usage_samples.len(), 2);
        assert_eq!(report.usage_samples[0].timestamp.as_deref(), Some("2026-10-27T00:00:05Z"));
        assert_eq!(report.usage_samples[0].output_tokens, Some(4));
        assert_eq!(report.usage_samples[1].model.as_deref(), Some("gpt-b"));
        assert_sample_totals(&report);
        assert!(report.usage_samples_complete);
    }

    #[test]
    fn missing_settlement_usage_marks_otherwise_matching_samples_incomplete() {
        let dsh_records = vec![
            json!({"time":100,"type":"assistant/message","data":{"turn":1,"step":0,"message":{"source":{"model":"deepseek-a"}},"usage":{"inputTokens":10,"outputTokens":2}}}),
            json!({"time":200,"type":"assistant/attempt","data":{"turn":1,"step":1,"stream":[]}}),
        ];
        let report = analyze(preview("dsh"), &dsh_records, vec![]);
        assert_sample_totals(&report);
        assert!(!report.usage_samples_complete);
        let claude_records = vec![
            json!({"timestamp":"2026-10-27T00:00:00Z","type":"assistant","message":{"id":"a","model":"claude-a","usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}),
            json!({"timestamp":"2026-10-27T01:00:00Z","type":"assistant","message":{"id":"b","model":"claude-a","content":[{"type":"text","text":"Usage missing"}]}}),
        ];
        let report = analyze(preview("claude"), &claude_records, vec![]);
        assert_sample_totals(&report);
        assert!(!report.usage_samples_complete);
    }

    #[test]
    fn provider_timestamps_normalize_to_portable_iso_samples_on_all_platforms() {
        let cases = [
            ("codex", json!({"timestamp":1793059200123_u64,"type":"token_usage_record","payload":{"response_id":"a","model":"gpt-a","usage":{"input_tokens":10,"output_tokens":2,"cached_input_tokens":0}}})),
            ("claude", json!({"timestamp":"2026-10-27T00:00:00.123Z","type":"assistant","message":{"id":"a","model":"claude-a","usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}})),
            ("dsh", json!({"time":1793059200123_u64,"type":"assistant/message","data":{"turn":1,"step":0,"message":{"source":{"model":"deepseek-a"}},"usage":{"inputTokens":10,"outputTokens":2}}})),
        ];
        for (agent, record) in cases {
            let report = analyze(preview(agent), &[record], vec![]);
            assert_eq!(report.usage_samples[0].timestamp.as_deref(), Some("2026-10-27T00:00:00.123Z"));
            assert!(report.usage_samples_complete);
            let restored: GeneralChatAnalyze = serde_json::from_str(&serde_json::to_string(&report).unwrap()).unwrap();
            assert_eq!(restored.usage_samples[0].timestamp, report.usage_samples[0].timestamp);
        }
        assert_eq!(epoch_millis_iso(1_709_210_096_789).as_deref(), Some("2024-02-29T12:34:56.789Z"));
        assert_eq!(epoch_millis_iso(253_402_300_799_999).as_deref(), Some("9999-12-31T23:59:59.999Z"));
        assert!(epoch_millis_iso(253_402_300_800_000).is_none());
    }

    #[test]
    fn invalid_sample_timestamps_models_and_cache_subsets_become_unknown() {
        for invalid in ["2026-10-27", "2026-10-27T02:00:00", "2026-02-30T02:00:00Z", "2026-10-27T24:00:00Z", "0000-01-01T00:00:00Z", "2026-10-27T02:00:00.Z", "2026-10-27T02:00:00+24:00"] {
            assert!(sample_timestamp(invalid).is_none(), "{invalid}");
        }
        assert_eq!(sample_timestamp("2026-10-27T10:00:00+08:00").as_deref(), Some("2026-10-27T10:00:00+08:00"));
        let records = vec![json!({"timestamp":"invalid","type":"token_usage_record","payload":{"response_id":"a","model":"x".repeat(513),"usage":{"input_tokens":10,"output_tokens":2,"cached_input_tokens":20}}})];
        let report = analyze(preview("codex"), &records, vec![]);
        let sample = &report.usage_samples[0];
        assert!(sample.timestamp.is_none());
        assert!(sample.model.is_none());
        assert!(sample.cached_input_tokens.is_none());
        assert!(sample.cache_write_input_tokens.is_none());
        assert!(!report.usage_samples_complete);
        assert_eq!(report.usage.cached_input_tokens, Some(20));
    }

    fn assert_sample_totals(report: &GeneralChatAnalyze) {
        assert_eq!(Some(report.usage_samples.iter().map(|sample| sample.input_tokens.unwrap()).sum::<u64>()), report.usage.input_tokens);
        assert_eq!(Some(report.usage_samples.iter().map(|sample| sample.output_tokens.unwrap()).sum::<u64>()), report.usage.output_tokens);
        assert_eq!(Some(report.usage_samples.iter().map(|sample| sample.cached_input_tokens.unwrap()).sum::<u64>()), report.usage.cached_input_tokens);
    }
}
