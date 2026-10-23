//! Finds usage-limit resets and tells the pets with `notice: "limit-reset"`.
//! Only records the agents already keep are read:
//!
//! - Codex writes `rate_limits` (window length, `used_percent`, `resets_at`) into
//!   its session files under `~/.codex/sessions/`.
//! - Claude Code gives its limits only to its status line. The `--pet-status-line`
//!   wrapper (`status_line.rs`) saves them to a small file in the app data folder.
//! - The Claude desktop app keeps `plan-usage-history.json`, a sample of the
//!   5-hour and weekly use every 15 minutes, but no reset times.
//!
//! A window resets when the time passes its last known `resets_at` (on time,
//! even with no new samples) or when its used percentage drops (a sudden early
//! reset, seen with the next sample). The first sample of a window only records
//! it, so starting the app never announces old resets.

pub mod status_line;

use crate::platform::pet_events::{AgentId, PetEvent, PetHub, PetMessage, PetNotice};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const SCAN_EVERY: Duration = Duration::from_secs(10);
const SOURCE: &str = "limits";
/// A drop smaller than this (in percentage points) is rounding between sources, not a reset.
const DROP: f64 = 1.0;
const CODEX_TAIL: u64 = 512 * 1024;
/// Codex session days to look through for the newest file.
const CODEX_DAYS: usize = 7;

/// One reading of one usage window.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub agent: AgentId,
    /// `5-hour`, `weekly`, or `<n>-hour`.
    pub window: String,
    pub used: f64,
    /// Unix seconds.
    pub resets_at: Option<i64>,
    /// When the reading was taken, in Unix milliseconds.
    pub at: i64,
}

#[derive(Clone, Copy, Debug)]
struct WindowState {
    used: f64,
    resets_at: Option<i64>,
    at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reset {
    pub agent: AgentId,
    pub window: String,
}

/// Turns samples and the passing of time into resets.
#[derive(Default)]
pub struct Tracker {
    windows: HashMap<(AgentId, String), WindowState>,
}

impl Tracker {
    /// Applies samples (older readings than the one already seen are ignored) and returns resets they show.
    pub fn observe(&mut self, samples: Vec<Sample>, now_ms: i64) -> Vec<Reset> {
        let mut resets = Vec::new();
        for sample in samples {
            let key = (sample.agent, sample.window.clone());
            match self.windows.get_mut(&key) {
                None => {
                    // A reset time already past means the window started fresh while nobody watched.
                    let stale = sample.resets_at.is_some_and(|at| at * 1000 <= now_ms);
                    self.windows.insert(key, WindowState {
                        used: if stale { 0.0 } else { sample.used },
                        resets_at: if stale { None } else { sample.resets_at },
                        at: sample.at,
                    });
                }
                Some(state) if sample.at > state.at => {
                    let dropped = state.used - sample.used >= DROP;
                    if dropped {
                        resets.push(Reset { agent: sample.agent, window: sample.window.clone() });
                    }
                    state.used = sample.used;
                    state.resets_at = sample.resets_at.or(if dropped { None } else { state.resets_at });
                    state.at = sample.at;
                }
                Some(_) => {}
            }
        }
        resets
    }

    /// Resets due by the clock: a used window whose reset time has passed.
    pub fn tick(&mut self, now_ms: i64) -> Vec<Reset> {
        let mut resets = Vec::new();
        for ((agent, window), state) in &mut self.windows {
            if state.resets_at.is_some_and(|at| at * 1000 <= now_ms) {
                if state.used >= DROP {
                    resets.push(Reset { agent: *agent, window: window.clone() });
                }
                state.used = 0.0;
                state.resets_at = None;
            }
        }
        resets.sort_by_key(|reset| (reset.agent as u8, reset.window.clone()));
        resets
    }
}

fn agent_name(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "Claude Code",
        AgentId::Codex => "Codex",
        AgentId::Deepseek => "DSH",
    }
}

/// One pet event per agent, naming the window that reset (or all of them).
pub fn reset_events(resets: &[Reset]) -> Vec<PetEvent> {
    let mut by_agent: Vec<(AgentId, Vec<&str>)> = Vec::new();
    for reset in resets {
        match by_agent.iter_mut().find(|(agent, _)| *agent == reset.agent) {
            Some((_, windows)) => windows.push(&reset.window),
            None => by_agent.push((reset.agent, vec![&reset.window])),
        }
    }
    by_agent.into_iter().map(|(agent, windows)| {
        let text = if windows.len() == 1 {
            format!("{}'s {} limit is reset", agent_name(agent), windows[0])
        } else {
            format!("{}'s {} limits are reset", agent_name(agent), windows.join(" and "))
        };
        PetEvent {
            source: SOURCE.into(),
            agent: Some(agent),
            session_id: None,
            status: None,
            emote: None,
            note: None,
            badge: None,
            message: Some(PetMessage { text, action: None }),
            notice: Some(PetNotice::LimitReset),
        }
    }).collect()
}

pub fn window_name(minutes: i64) -> String {
    match minutes {
        300 => "5-hour".into(),
        10080 => "weekly".into(),
        minutes if minutes % 1440 == 0 => format!("{}-day", minutes / 1440),
        minutes => format!("{}-hour", (minutes as f64 / 60.0).round()),
    }
}

fn millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or(0)
}

fn modified(path: &Path) -> Option<i64> {
    fs::metadata(path).and_then(|metadata| metadata.modified()).ok().map(millis)
}

fn read_tail(path: &Path, tail: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(tail);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(tail).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Some(if start > 0 { text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default() } else { text })
}

/// Codex's newest session file: the folders are `YYYY/MM/DD`, so names sort by date.
pub fn newest_codex_session(sessions: &Path) -> Option<PathBuf> {
    let sorted = |folder: &Path| -> Vec<PathBuf> {
        let mut entries: Vec<PathBuf> = fs::read_dir(folder).into_iter().flatten().flatten().map(|entry| entry.path()).collect();
        entries.sort();
        entries.reverse();
        entries
    };
    let mut days = Vec::new();
    'search: for year in sorted(sessions).into_iter().filter(|path| path.is_dir()) {
        for month in sorted(&year).into_iter().filter(|path| path.is_dir()) {
            for day in sorted(&month).into_iter().filter(|path| path.is_dir()) {
                days.push(day);
                if days.len() >= CODEX_DAYS {
                    break 'search;
                }
            }
        }
    }
    days.iter()
        .flat_map(|day| sorted(day))
        .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
        .filter_map(|path| modified(&path).map(|time| (time, path)))
        .max_by_key(|(time, _)| *time)
        .map(|(_, path)| path)
}

/// The latest `rate_limits` in a Codex session file's tail.
pub fn codex_samples(text: &str, at: i64) -> Vec<Sample> {
    let Some(limits) = text.lines().rev()
        .filter(|line| line.contains("\"rate_limits\""))
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
        .map(|line| line["payload"]["rate_limits"].clone())
    else {
        return Vec::new();
    };
    ["primary", "secondary"].iter().filter_map(|key| {
        let window = &limits[key];
        let used = window["used_percent"].as_f64()?;
        let minutes = window["window_minutes"].as_i64()?;
        Some(Sample { agent: AgentId::Codex, window: window_name(minutes), used, resets_at: window["resets_at"].as_i64(), at })
    }).collect()
}

/// The Claude desktop app's newest usage sample: `fh` is the 5-hour window, `sd` the weekly one.
pub fn claude_app_samples(text: &str) -> Vec<Sample> {
    let Ok(history) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    let Some(latest) = history["samples"].as_array().and_then(|samples| samples.iter().max_by_key(|sample| sample["t"].as_i64().unwrap_or(0))) else {
        return Vec::new();
    };
    let at = latest["t"].as_i64().unwrap_or(0);
    [("fh", "5-hour"), ("sd", "weekly")].iter()
        .filter_map(|(key, window)| latest["u"][key].as_f64().map(|used| Sample { agent: AgentId::Claude, window: (*window).into(), used, resets_at: None, at }))
        .collect()
}

/// Where the Claude desktop app keeps its usage history, newest install first.
fn claude_app_history() -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        files.extend(fs::read_dir(PathBuf::from(local).join("Claude-Data")).into_iter().flatten().flatten()
            .map(|entry| entry.path().join("plan-usage-history.json")));
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        files.push(PathBuf::from(roaming).join("Claude").join("plan-usage-history.json"));
    }
    files
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub agent: AgentId,
    pub name: String,
    pub path: String,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seen_at: Option<i64>,
}

/// What the watcher reads, for the settings page.
#[derive(Default)]
pub struct LimitWatcher {
    sources: Mutex<Vec<SourceState>>,
}

impl LimitWatcher {
    pub fn sources(&self) -> Vec<SourceState> {
        self.sources.lock().map(|sources| sources.clone()).unwrap_or_default()
    }
}

/// Re-reads a source only when its file changed.
#[derive(Default)]
struct Seen(HashMap<PathBuf, i64>);

impl Seen {
    fn changed(&mut self, path: &Path) -> Option<i64> {
        let time = modified(path)?;
        (self.0.insert(path.to_path_buf(), time) != Some(time)).then_some(time)
    }
}

pub fn start(app: &AppHandle) {
    let handle = app.clone();
    let _ = thread::Builder::new().name("agent-pet-limits".into()).spawn(move || watch(handle));
}

fn watch(app: AppHandle) {
    let Ok(home) = app.path().home_dir() else { return };
    let codex_root = home.join(".codex").join("sessions");
    let status_file = status_line::limits_file();
    let mut tracker = Tracker::default();
    let mut seen = Seen::default();
    loop {
        let now = millis(SystemTime::now());
        let mut samples = Vec::new();
        let mut sources = Vec::new();

        let codex = newest_codex_session(&codex_root);
        if let Some(path) = &codex {
            if let Some(time) = seen.changed(path) {
                samples.extend(read_tail(path, CODEX_TAIL).map(|text| codex_samples(&text, time)).unwrap_or_default());
            }
        }
        sources.push(SourceState {
            agent: AgentId::Codex, name: "session files".into(), path: codex_root.display().to_string(),
            found: codex.is_some(), seen_at: codex.as_deref().and_then(modified),
        });

        if let Some(path) = &status_file {
            if seen.changed(path).is_some() {
                samples.extend(fs::read_to_string(path).ok().map(|text| status_line::read_samples(&text)).unwrap_or_default());
            }
            sources.push(SourceState {
                agent: AgentId::Claude, name: "status line".into(), path: path.display().to_string(),
                found: path.is_file(), seen_at: modified(path),
            });
        }

        let history = claude_app_history().into_iter().filter(|path| path.is_file()).max_by_key(|path| modified(path).unwrap_or(0));
        if let Some(path) = &history {
            if seen.changed(path).is_some() {
                samples.extend(fs::read_to_string(path).ok().map(|text| claude_app_samples(&text)).unwrap_or_default());
            }
        }
        sources.push(SourceState {
            agent: AgentId::Claude, name: "desktop app usage history".into(),
            path: history.as_deref().map(|path| path.display().to_string()).unwrap_or_else(|| "%LOCALAPPDATA%\\Claude-Data".into()),
            found: history.is_some(), seen_at: history.as_deref().and_then(modified),
        });

        let mut resets = tracker.observe(samples, now);
        resets.extend(tracker.tick(now));
        for event in reset_events(&resets) {
            let _ = app.state::<PetHub>().publish(&app, event);
        }
        if let Ok(mut state) = app.state::<LimitWatcher>().sources.lock() {
            *state = sources;
        }
        thread::sleep(SCAN_EVERY);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitsReport {
    pub status_line: super::hooks::status_line::StatusLineState,
    pub sources: Vec<SourceState>,
}

fn report(app: &AppHandle) -> Result<LimitsReport, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let path = super::hooks::Locations::in_home(&home).claude;
    Ok(LimitsReport {
        status_line: super::hooks::status_line::state(&path, &super::hooks::executable()?),
        sources: app.state::<LimitWatcher>().sources(),
    })
}

#[tauri::command]
pub async fn agent_pet_limits(app: AppHandle) -> Result<LimitsReport, String> {
    report(&app)
}

#[tauri::command]
pub async fn agent_pet_install_status_line(app: AppHandle) -> Result<LimitsReport, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    super::hooks::status_line::install(&super::hooks::Locations::in_home(&home).claude, &super::hooks::executable()?)?;
    report(&app)
}

#[tauri::command]
pub async fn agent_pet_remove_status_line(app: AppHandle) -> Result<LimitsReport, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    super::hooks::status_line::remove(&super::hooks::Locations::in_home(&home).claude)?;
    report(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3_600_000;

    fn sample(window: &str, used: f64, resets_at: Option<i64>, at: i64) -> Sample {
        Sample { agent: AgentId::Claude, window: window.into(), used, resets_at, at }
    }

    #[test]
    fn announces_scheduled_resets_on_time_and_only_for_used_windows() {
        let mut tracker = Tracker::default();
        let now = 100 * HOUR;
        let resets_at = (now + HOUR) / 1000;
        assert!(tracker.observe(vec![sample("5-hour", 40.0, Some(resets_at), now), sample("weekly", 0.0, Some(resets_at), now)], now).is_empty());
        assert!(tracker.tick(now + HOUR - 1000).is_empty());
        assert_eq!(tracker.tick(now + HOUR), vec![Reset { agent: AgentId::Claude, window: "5-hour".into() }]);
        assert!(tracker.tick(now + 2 * HOUR).is_empty(), "a reset is announced once");
    }

    #[test]
    fn announces_sudden_resets_from_a_drop_in_use() {
        let mut tracker = Tracker::default();
        let now = 100 * HOUR;
        tracker.observe(vec![sample("weekly", 23.0, Some((now + 50 * HOUR) / 1000), now)], now);
        // Rounding between sources is not a reset.
        assert!(tracker.observe(vec![sample("weekly", 22.6, None, now + 1)], now + 1).is_empty());
        assert!(tracker.observe(vec![sample("weekly", 25.0, None, now + 2)], now + 2).is_empty());
        let resets = tracker.observe(vec![sample("weekly", 6.0, Some((now + 160 * HOUR) / 1000), now + 3)], now + 3);
        assert_eq!(resets, vec![Reset { agent: AgentId::Claude, window: "weekly".into() }]);
        // An older reading that arrives late changes nothing.
        assert!(tracker.observe(vec![sample("weekly", 0.0, None, now)], now + 4).is_empty());
    }

    #[test]
    fn never_announces_what_happened_before_it_started() {
        let mut tracker = Tracker::default();
        let now = 100 * HOUR;
        assert!(tracker.observe(vec![sample("5-hour", 80.0, Some((now - HOUR) / 1000), now - 2 * HOUR)], now).is_empty());
        assert!(tracker.tick(now).is_empty());
        // The stale reading counted as used 0, so new use after it is not a drop either.
        assert!(tracker.observe(vec![sample("5-hour", 5.0, None, now)], now).is_empty());
    }

    #[test]
    fn reads_codex_session_lines_and_names_windows() {
        let text = concat!(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"primary\":{\"used_percent\":23.0,\"window_minutes\":10080,\"resets_at\":1793082742},\"secondary\":null}}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"primary\":{\"used_percent\":6,\"window_minutes\":300,\"resets_at\":1793295687},\"secondary\":{\"used_percent\":2.5,\"window_minutes\":10080}}}}\n",
        );
        assert_eq!(codex_samples(text, 7), vec![
            Sample { agent: AgentId::Codex, window: "5-hour".into(), used: 6.0, resets_at: Some(1793295687), at: 7 },
            Sample { agent: AgentId::Codex, window: "weekly".into(), used: 2.5, resets_at: None, at: 7 },
        ]);
        assert!(codex_samples("not json\n", 1).is_empty());
        assert_eq!(window_name(1440), "1-day");
        assert_eq!(window_name(120), "2-hour");
    }

    #[test]
    fn reads_the_claude_apps_newest_usage_sample() {
        let text = r#"{"version":2,"samples":[{"t":20,"org":"a","u":{"fh":70,"sd":60}},{"t":10,"org":"a","u":{"fh":66,"sd":59}}]}"#;
        assert_eq!(claude_app_samples(text), vec![sample("5-hour", 70.0, None, 20), sample("weekly", 60.0, None, 20)]);
        assert!(claude_app_samples("{}").is_empty());
    }

    #[test]
    fn finds_the_newest_codex_session() {
        let root = std::env::temp_dir().join(format!("toolbox-chan-limits-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // Written oldest first, so the newest file is also the newest day's.
        for (day, file) in [("2026/09/30", "c.jsonl"), ("2026/10/21", "a.jsonl"), ("2026/10/22", "b.jsonl")] {
            fs::create_dir_all(root.join(day)).unwrap();
            fs::write(root.join(day).join(file), "{}").unwrap();
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(newest_codex_session(&root).unwrap().file_name().unwrap(), "b.jsonl");
        assert!(newest_codex_session(&root.join("missing")).is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn says_which_limit_reset_once_per_agent() {
        let events = reset_events(&[
            Reset { agent: AgentId::Codex, window: "weekly".into() },
            Reset { agent: AgentId::Claude, window: "5-hour".into() },
            Reset { agent: AgentId::Claude, window: "weekly".into() },
        ]);
        let texts: Vec<_> = events.iter().map(|event| event.message.as_ref().unwrap().text.as_str()).collect();
        assert_eq!(texts, ["Codex's weekly limit is reset", "Claude Code's 5-hour and weekly limits are reset"]);
        assert!(events.iter().all(|event| event.notice == Some(PetNotice::LimitReset) && event.validate().is_ok()));
    }
}
