//! Finds things an agent told the user to do in the final message of a turn.
//! `TODO(user): ...` lines are exact; the heading and sentence rules are simple
//! word rules, so some misses and some noise are expected. No AI is used.

const MAX_PER_MESSAGE: usize = 20;
const MAX_SENTENCE: usize = 300;

/// List items under these headings are follow-ups (compared in lowercase).
const HEADINGS: &[&str] = &[
    "next steps", "next step", "todo", "todos", "to do", "to-do", "follow-ups", "follow-up", "follow ups",
    "followups", "action items", "for you",
];

/// Sentences that start with these words are follow-ups (compared in lowercase).
const PHRASES: &[&str] = &[
    "you need to", "you'll need to", "you will need to", "you should", "you must", "please run", "remember to",
    "make sure to", "don't forget to",
];

pub fn follow_ups(message: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut push = |text: String| {
        let text = tidy(&text);
        if !text.is_empty() && !found.iter().any(|known| known.eq_ignore_ascii_case(&text)) {
            found.push(text);
        }
    };
    let mut fenced = false;
    let mut under_heading = false;
    for raw in message.lines() {
        let line = raw.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let (item, is_list) = strip_list_marker(line);
        if let Some(todo) = fixed_format(item) {
            push(todo.to_string());
            continue;
        }
        if let Some(heading) = heading_text(line) {
            // "Please run:" introduces a list for the user, like a heading does.
            under_heading = HEADINGS.contains(&heading.as_str()) || PHRASES.iter().any(|phrase| heading.starts_with(phrase));
            continue;
        }
        if line.is_empty() {
            continue;
        }
        if under_heading && is_list {
            push(item.to_string());
            continue;
        }
        // Plain text ends a heading's list; indented continuation lines do not.
        if !is_list && !raw.starts_with(char::is_whitespace) {
            under_heading = false;
        }
        for sentence in sentences(item) {
            let lower = sentence.to_lowercase();
            if PHRASES.iter().any(|phrase| lower.starts_with(phrase)) {
                push(sentence.chars().take(MAX_SENTENCE).collect());
            }
        }
    }
    found.truncate(MAX_PER_MESSAGE);
    found
}

/// `TODO(user): text` on its own line, optionally bold or in a list. Placeholder
/// text such as `...` is not a follow-up, and code spans are quotes, not requests.
fn fixed_format(line: &str) -> Option<&str> {
    let line = line.trim_start_matches("**").trim_start_matches("__");
    let rest = line.get(..11).filter(|head| head.eq_ignore_ascii_case("todo(user):")).map(|_| &line[11..])?;
    let text = rest.trim().trim_start_matches("**").trim_end_matches("**").trim();
    (!text.is_empty() && !matches!(text, "..." | "…")).then_some(text)
}

/// Markdown headings, bold-only lines, and short lines ending in a colon.
fn heading_text(line: &str) -> Option<String> {
    let text = if let Some(rest) = line.strip_prefix('#') {
        rest.trim_start_matches('#').trim()
    } else if line.len() > 4 && line.starts_with("**") && line.ends_with("**") && !line[2..line.len() - 2].contains("**") {
        line[2..line.len() - 2].trim()
    } else if line.ends_with(':') && line.chars().count() <= 40 && strip_list_marker(line).0 == line {
        line
    } else {
        return None;
    };
    let text = text.trim_matches(|c: char| c == '*' || c == '_' || c == ':' || c.is_whitespace());
    Some(text.to_lowercase())
}

/// Returns the line without a list marker, and whether it had one.
fn strip_list_marker(line: &str) -> (&str, bool) {
    let line = line.trim_start_matches('>').trim_start();
    for marker in ["- [ ] ", "* [ ] ", "- [x] ", "- ", "* ", "+ ", "• "] {
        if let Some(rest) = line.strip_prefix(marker) {
            return (rest.trim(), true);
        }
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && digits < 4 {
        let rest = &line[digits..];
        if let Some(rest) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
            return (rest.trim(), true);
        }
    }
    (line, false)
}

fn sentences(text: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        let ends = matches!(byte, b'.' | b'!' | b'?') && bytes.get(index + 1).map_or(true, |next| next.is_ascii_whitespace());
        if ends {
            result.push(text[start..=index].trim());
            start = index + 1;
        }
    }
    if start < text.len() {
        result.push(text[start..].trim());
    }
    result.into_iter().map(|sentence| sentence.trim_start_matches("**").trim_start_matches('_')).filter(|s| !s.is_empty()).collect()
}

fn tidy(text: &str) -> String {
    text.replace("**", "").split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_the_fixed_format_exactly() {
        let message = "Done.\nTODO(user): Restart the app\n- **TODO(user):** Add the API key\n`TODO(user): ...` is the format.\nTODO(user): ...";
        assert_eq!(follow_ups(message), ["Restart the app", "Add the API key"]);
    }

    #[test]
    fn takes_list_items_under_follow_up_headings_only() {
        let message = "## Summary\n- Changed the parser\n\n**Next steps**\n1. Run `npm test`\n2. Review the diff\n   with care\n\nFollow-ups:\n- Rotate the key\n\nThat is all.\n- Not a follow-up\n\nPlease run:\n- `npm ci`";
        assert_eq!(follow_ups(message), ["Run `npm test`", "Review the diff", "Rotate the key", "`npm ci`"]);
    }

    #[test]
    fn catches_sentences_that_ask_the_user_to_act() {
        let message = "I fixed it. You need to restart the server. It works now! Please run the migration first.\nRemember to commit.";
        assert_eq!(follow_ups(message), ["You need to restart the server.", "Please run the migration first.", "Remember to commit."]);
    }

    #[test]
    fn ignores_code_blocks_and_repeats() {
        let message = "```\nTODO(user): not this\nYou should not see this.\n```\nYou should check it. You should check it.";
        assert_eq!(follow_ups(message), ["You should check it."]);
    }

    #[test]
    fn handles_text_without_follow_ups() {
        assert!(follow_ups("All tests pass. Nothing else is needed.").is_empty());
        assert!(follow_ups("").is_empty());
    }
}
