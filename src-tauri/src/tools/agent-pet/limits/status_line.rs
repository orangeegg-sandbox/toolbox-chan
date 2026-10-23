//! The status line wrapper. Claude Code gives its usage limits only to its
//! status line command, so Toolbox-Chan can stand in for it:
//!
//!   little-toolbox.exe --pet-status-line <the user's own command, base64url>
//!
//! It reads Claude Code's status JSON from stdin, runs the user's own command
//! with the same input, prints that command's output unchanged, and saves the
//! limits to `<app data>/agent-pet/claude-limits.json` for the limit watcher.
//! Like `--pet-hook` it runs before Tauri starts, prints nothing of its own, and
//! never waits long: a missing Toolbox-Chan never breaks the status line.

use super::Sample;
use crate::platform::pet_events::AgentId;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const FLAG: &str = "--pet-status-line";
/// The app's identifier from `tauri.conf.json`; the helper runs before Tauri knows it.
pub const IDENTIFIER: &str = "com.littletoolbox.desktop";
const FILE: &str = "claude-limits.json";
const MAX_INPUT: u64 = 1024 * 1024;
const MAX_OUTPUT: u64 = 64 * 1024;
const INPUT_WAIT: Duration = Duration::from_millis(1500);
const COMMAND_WAIT: Duration = Duration::from_secs(5);
const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Where the helper leaves Claude Code's limits; the app's data folder, found without Tauri.
pub fn limits_file() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
    };
    base.map(|base| base.join(IDENTIFIER).join("agent-pet").join(FILE))
}

/// The user's command as one shell-safe word.
pub fn encode(command: &str) -> String {
    let bytes = command.as_bytes();
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..=chunk.len() {
            text.push(BASE64URL[((value >> (18 - 6 * index)) & 63) as usize] as char);
        }
    }
    text
}

pub fn decode(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    let digits: Vec<u32> = text.bytes().map(|byte| BASE64URL.iter().position(|&digit| digit == byte).map(|index| index as u32)).collect::<Option<_>>()?;
    for chunk in digits.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let value = chunk.iter().enumerate().fold(0u32, |value, (index, digit)| value | (digit << (18 - 6 * index)));
        for index in 0..chunk.len() - 1 {
            bytes.push((value >> (16 - 8 * index)) as u8);
        }
    }
    String::from_utf8(bytes).ok()
}

/// Runs the wrapper when the executable was started with `--pet-status-line`; `None` starts the app as usual.
pub fn run_if_requested() -> Option<i32> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some(FLAG) {
        return None;
    }
    let command = arguments.next().and_then(|encoded| decode(&encoded)).unwrap_or_default();
    let input = read_input();
    let (output, code) = if command.trim().is_empty() { (Vec::new(), 0) } else { run(&command, &input) };
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(&output);
    let _ = stdout.flush();
    if let Some(path) = limits_file() {
        if let Some(contents) = limits_record(&input, now_ms()) {
            let _ = save(&path, &contents);
        }
    }
    Some(code)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or(0)
}

fn read_input() -> Vec<u8> {
    let (sender, receiver) = mpsc::channel();
    let _ = thread::Builder::new().name("pet-status-stdin".into()).spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::stdin().take(MAX_INPUT).read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });
    receiver.recv_timeout(INPUT_WAIT).unwrap_or_default()
}

/// Splits a simple command line into words, or `None` when it needs a shell (pipes, variables, …).
pub fn split_words(command: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for character in command.chars() {
        match (quote, character) {
            (Some(open), character) if character == open => quote = None,
            (Some(_), character) => word.push(character),
            (None, '"' | '\'') => {
                quote = Some(character);
                started = true;
            }
            (None, character) if character.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            (None, '|' | '&' | ';' | '<' | '>' | '$' | '`' | '(' | ')' | '%' | '^' | '*' | '?') => return None,
            (None, character) => {
                word.push(character);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return None;
    }
    if started {
        words.push(word);
    }
    (!words.is_empty()).then_some(words)
}

fn shell(command: &str) -> Command {
    if let Some(words) = split_words(command) {
        let mut process = Command::new(&words[0]);
        process.args(&words[1..]);
        return process;
    }
    // Commands that need a shell: cmd on Windows (bash there may be WSL's), sh elsewhere.
    let mut process = if cfg!(windows) { Command::new("cmd") } else { Command::new("sh") };
    process.arg(if cfg!(windows) { "/C" } else { "-c" }).arg(command);
    process
}

/// Runs the user's command with the same input; its output, and its exit code (0 when it could not run).
fn run(command: &str, input: &[u8]) -> (Vec<u8>, i32) {
    let mut process = shell(command);
    process.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // This helper has no console; without this flag a console program would open a window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut child) = process.spawn() else { return (Vec::new(), 0) };
    if let Some(mut stdin) = child.stdin.take() {
        let input = input.to_vec();
        let _ = thread::Builder::new().name("pet-status-input".into()).spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }
    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let _ = thread::Builder::new().name("pet-status-output".into()).spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.take(MAX_OUTPUT).read_to_end(&mut bytes);
            let _ = sender.send(bytes);
        });
    }
    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(0),
            Ok(None) if started.elapsed() < COMMAND_WAIT => thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                break 0;
            }
        }
    };
    (receiver.recv_timeout(Duration::from_millis(500)).unwrap_or_default(), code)
}

/// A time as Unix seconds: a number, or text such as `2026-10-23T10:00:00.000Z` or `…+08:00`.
pub fn parse_time(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_f64() {
        // Milliseconds are far larger than any seconds value in this century.
        return Some(if number > 1e12 { (number / 1000.0) as i64 } else { number as i64 });
    }
    let text = value.as_str()?.trim();
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if !matches!(text.as_bytes().get(10), Some(b'T' | b't' | b' ')) {
        return None;
    }
    let rest = text[19..].trim_start_matches(|character: char| character == '.' || character.is_ascii_digit());
    let offset = match rest {
        "" | "Z" | "z" => 0,
        zone => {
            let sign = match zone.as_bytes().first()? { b'+' => 1, b'-' => -1, _ => return None };
            let hours = zone.get(1..3)?.parse::<i64>().ok()?;
            let minutes = zone.get(4..6).or_else(|| zone.get(3..5)).and_then(|minutes| minutes.parse::<i64>().ok()).unwrap_or(0);
            sign * (hours * 3600 + minutes * 60)
        }
    };
    // Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let of_era_days = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    let days = era * 146_097 + of_era_days - 719_468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// The record saved for the limit watcher, or `None` when the status JSON has no limits.
pub fn limits_record(input: &[u8], at: i64) -> Option<String> {
    let status: Value = serde_json::from_slice(input).ok()?;
    let limits = &status["rate_limits"];
    let windows: Vec<Value> = [("five_hour", "5-hour"), ("seven_day", "weekly")].iter()
        .filter_map(|(key, window)| {
            let used = limits[key]["used_percentage"].as_f64()?;
            Some(json!({ "window": window, "used": used, "resetsAt": parse_time(&limits[key]["resets_at"]) }))
        })
        .collect();
    (!windows.is_empty()).then(|| json!({ "at": at, "windows": windows }).to_string())
}

pub fn read_samples(text: &str) -> Vec<Sample> {
    let Ok(record) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    let at = record["at"].as_i64().unwrap_or(0);
    record["windows"].as_array().into_iter().flatten().filter_map(|window| Some(Sample {
        agent: AgentId::Claude,
        window: window["window"].as_str()?.to_owned(),
        used: window["used"].as_f64()?,
        resets_at: window["resetsAt"].as_i64(),
        at,
    })).collect()
}

/// Writes through a temporary file, so the watcher never reads half a record.
fn save(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(".{}.tmp", std::process::id()));
    let temporary = PathBuf::from(temporary);
    std::fs::write(&temporary, contents)?;
    std::fs::rename(&temporary, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temporary);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_commands_through_one_word() {
        for command in ["", "a", "ab", "abc", "\"C:/Program Files/node.exe\" D:/cli.js statusline", "echo ünïcödé | more"] {
            let encoded = encode(command);
            assert!(encoded.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_'));
            assert_eq!(decode(&encoded).as_deref(), Some(command));
        }
        assert_eq!(decode("a"), None);
        assert_eq!(decode("ab+c"), None);
    }

    #[test]
    fn runs_simple_commands_without_a_shell() {
        assert_eq!(
            split_words("\"C:/Users/PC/AppData/Local/Author Software/node.exe\" D:/Personal/cli.js statusline"),
            Some(vec!["C:/Users/PC/AppData/Local/Author Software/node.exe".into(), "D:/Personal/cli.js".into(), "statusline".into()]),
        );
        assert_eq!(split_words("say 'two words' \"\""), Some(vec!["say".into(), "two words".into(), "".into()]));
        assert_eq!(split_words("a | b"), None);
        assert_eq!(split_words("echo $HOME"), None);
        assert_eq!(split_words("open \"quote"), None);
        assert_eq!(split_words("   "), None);
    }

    #[test]
    fn reads_reset_times_as_numbers_or_text() {
        assert_eq!(parse_time(&json!(1793082742)), Some(1793082742));
        assert_eq!(parse_time(&json!(1793082742123_i64)), Some(1793082742));
        assert_eq!(parse_time(&json!("1970-01-01T00:00:00Z")), Some(0));
        assert_eq!(parse_time(&json!("2026-10-23T10:00:00.500Z")), Some(1_792_749_600));
        assert_eq!(parse_time(&json!("2026-10-23T18:00:00+08:00")), Some(1_792_749_600));
        assert_eq!(parse_time(&json!("2024-02-29T00:00:00-0130")), Some(1_709_170_200));
        assert_eq!(parse_time(&json!("soon")), None);
        assert_eq!(parse_time(&Value::Null), None);
    }

    #[test]
    fn saves_claude_limits_for_the_watcher() {
        let input = json!({
            "model": { "id": "x" },
            "rate_limits": {
                "five_hour": { "used_percentage": 41.5, "resets_at": "2026-10-23T10:00:00Z" },
                "seven_day": { "used_percentage": 12, "resets_at": 1793082742 }
            }
        }).to_string();
        let record = limits_record(input.as_bytes(), 99).unwrap();
        assert_eq!(read_samples(&record), vec![
            Sample { agent: AgentId::Claude, window: "5-hour".into(), used: 41.5, resets_at: Some(1_792_749_600), at: 99 },
            Sample { agent: AgentId::Claude, window: "weekly".into(), used: 12.0, resets_at: Some(1793082742), at: 99 },
        ]);
        assert!(limits_record(b"{\"model\":{}}", 1).is_none(), "no limits, nothing to save");
        assert!(limits_record(b"not json", 1).is_none());
    }

    #[test]
    fn knows_the_apps_identifier() {
        let config: Value = serde_json::from_str(include_str!("../../../../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], json!(IDENTIFIER));
    }
}
