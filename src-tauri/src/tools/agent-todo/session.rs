//! What the scanner remembers about one chat between scans, and the shared
//! turn-end logic: plan steps still unfinished when a turn ends become items.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    pub text: String,
    pub status: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    pub project: String,
    pub title: String,
    /// Used until the agent names the chat, such as the first prompt's first line.
    pub fallback_title: String,
    /// Subagent and imported chats talk to another agent, not to the user.
    pub skip: bool,
    /// A forked chat replays its source first; those turns are not new.
    pub seeding: bool,
    pub plan: Vec<Step>,
    /// The message that is the turn's final message so far, and its text.
    pub final_id: String,
    pub final_text: String,
}

/// One ended turn: when, its unfinished plan steps, and its final message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnEnd {
    pub at: Option<i64>,
    pub steps: Vec<String>,
    pub message: String,
}

impl Session {
    pub fn title(&self) -> &str {
        if self.title.is_empty() { &self.fallback_title } else { &self.title }
    }

    pub fn set_plan(&mut self, steps: impl IntoIterator<Item = (String, String)>) {
        self.plan = steps.into_iter()
            .map(|(text, status)| Step { text: text.trim().to_string(), status })
            .filter(|step| !step.text.is_empty())
            .collect();
    }

    pub fn complete_in_progress(&mut self) {
        for step in self.plan.iter_mut().filter(|step| step.status == "in_progress") {
            step.status = "completed".into();
        }
    }

    pub fn end_turn(&self, at: Option<i64>, message: Option<&str>) -> Option<TurnEnd> {
        if self.skip || self.seeding {
            return None;
        }
        let steps = self.plan.iter()
            .filter(|step| step.status != "completed")
            .map(|step| step.text.clone())
            .collect();
        Some(TurnEnd { at, steps, message: message.unwrap_or_default().to_string() })
    }
}

/// The first line of a prompt, short enough for a list.
pub fn first_line(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    if line.chars().count() <= 80 {
        return line.to_string();
    }
    format!("{}…", line.chars().take(79).collect::<String>())
}

/// Milliseconds since 1970 for an RFC 3339 time such as `2026-10-22T05:12:31.736Z`.
pub fn parse_time(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' || !matches!(bytes[10], b'T' | b't' | b' ') {
        return None;
    }
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &text[19..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.chars().take_while(char::is_ascii_digit).count();
        let padded = format!("{:0<3}", &fraction[..digits.min(3)]);
        millis = padded.parse::<i64>().ok()?;
        rest = &fraction[digits..];
    }
    let offset = match rest {
        "Z" | "z" | "" => 0,
        zone if zone.len() == 6 && matches!(&zone[..1], "+" | "-") => {
            let minutes = zone.get(1..3)?.parse::<i64>().ok()? * 60 + zone.get(4..6)?.parse::<i64>().ok()?;
            if zone.starts_with('-') { -minutes } else { minutes }
        }
        _ => return None,
    };
    // Days since 1970 for a civil date (Howard Hinnant's algorithm).
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some((((days * 24 + hour) * 60 + minute - offset) * 60 + second) * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rfc3339_times() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-10-22T05:12:31.736Z"), Some(1_792_645_951_736));
        assert_eq!(parse_time("2026-10-22T13:12:31.7364+08:00"), Some(1_792_645_951_736));
        assert_eq!(parse_time("2024-02-29T00:00:00.5Z"), Some(1_709_164_800_500));
        assert_eq!(parse_time("yesterday"), None);
        assert_eq!(parse_time("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn only_unfinished_steps_are_reported_at_turn_end() {
        let mut session = Session::default();
        session.set_plan([("Read".into(), "completed".into()), ("Build".into(), "in_progress".into()), (" ".into(), "pending".into()), ("Ship".into(), "pending".into())]);
        assert_eq!(session.end_turn(Some(1), Some("Bye")).unwrap().steps, ["Build", "Ship"]);
        session.complete_in_progress();
        assert_eq!(session.end_turn(None, None).unwrap().steps, ["Ship"]);
        session.skip = true;
        assert_eq!(session.end_turn(None, None), None);
    }

    #[test]
    fn shortens_prompt_titles() {
        assert_eq!(first_line("\n  Fix the build\nand more"), "Fix the build");
        assert_eq!(first_line(&"a".repeat(100)).chars().count(), 80);
    }
}
