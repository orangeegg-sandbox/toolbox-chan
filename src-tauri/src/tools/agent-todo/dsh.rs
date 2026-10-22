//! DeepSeek Harness chats: `~/.dsh/sessions/<encoded folder>/session-<id>/session.v4.jsonl.zstd`.
//! The file is a series of zstd frames appended as the chat grows; together they
//! decode to one JSON record per line. Plans are `todo_write` tool calls; a turn
//! ends with a `turn/end` record. Field names follow DSH's session event types.

use super::session::{first_line, Session, TurnEnd};
use ruzstd::decoding::{BlockDecodingStrategy, FrameDecoder};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type", default)]
    kind: String,
    time: Option<i64>,
    id: Option<String>,
    cwd: Option<String>,
    #[serde(default)]
    delegation_depth: u32,
    #[serde(default)]
    is_seeded: bool,
    #[serde(default)]
    data: Value,
}

pub fn feed(session: &mut Session, line: &[u8], ends: &mut Vec<TurnEnd>) {
    let Ok(record) = serde_json::from_slice::<Record>(line) else { return };
    let data = &record.data;
    let text = |value: &Value| value.as_str().unwrap_or_default().to_string();
    match record.kind.as_str() {
        "session" => {
            session.id = record.id.unwrap_or_default();
            session.project = record.cwd.unwrap_or_default();
            // Subagents run below depth 0; forked chats replay their source until `session/end-seed`.
            session.skip = record.delegation_depth > 0;
            session.seeding = record.is_seeded;
        }
        "session/end-seed" => session.seeding = false,
        "session/title" => {
            let title = text(&data["title"]);
            if !title.trim().is_empty() {
                session.title = title.trim().to_string();
            }
        }
        "user/message" if session.fallback_title.is_empty() && data["source"]["kind"] == "user" => {
            session.fallback_title = first_line(&texts(&data["content"]));
        }
        "tool/call" if data["name"] == "todo_write" => {
            let Ok(arguments) = serde_json::from_str::<Value>(data["arguments"].as_str().unwrap_or_default()) else { return };
            if let Some(todos) = arguments["todos"].as_array() {
                session.set_plan(todos.iter().map(|todo| (text(&todo["content"]), text(&todo["status"]))));
            }
        }
        "turn/start" => session.final_text.clear(),
        // The latest assistant message of a turn is its final message.
        "assistant/message" => session.final_text = texts(&data["message"]["content"]),
        "turn/end" if data["reason"]["kind"] != "forked" => {
            ends.extend(session.end_turn(record.time, Some(&session.final_text)));
        }
        _ => {}
    }
}

fn texts(content: &Value) -> String {
    let parts = content.as_array().into_iter().flatten();
    parts.filter(|part| part["type"] == "text").filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n\n")
}

/// Decodes the complete frames in `data` and returns the text and the number of
/// bytes used. A frame still being written is left for the next scan.
pub fn decode_frames(data: &[u8]) -> (Vec<u8>, usize) {
    let mut output = Vec::new();
    let mut used = 0;
    let mut decoder = FrameDecoder::new();
    while used < data.len() {
        let rest = &data[used..];
        if rest.len() >= 8 && (0x184D_2A50..=0x184D_2A5F).contains(&u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]])) {
            let size = u32::from_le_bytes([rest[4], rest[5], rest[6], rest[7]]) as usize;
            if rest.len() < 8 + size {
                break;
            }
            used += 8 + size;
            continue;
        }
        let mut source = rest;
        let decoded = decoder.reset(&mut source)
            .map_err(|error| error.to_string())
            .and_then(|()| decoder.decode_blocks(&mut source, BlockDecodingStrategy::All).map_err(|error| error.to_string()));
        if decoded.is_err() || !decoder.is_finished() {
            break;
        }
        let Some(frame) = decoder.collect() else { break };
        output.extend_from_slice(&frame);
        used += rest.len() - source.len();
    }
    (output, used)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(source: &str) -> (Session, Vec<TurnEnd>) {
        let mut session = Session::default();
        let mut ends = Vec::new();
        for line in source.lines() {
            feed(&mut session, line.as_bytes(), &mut ends);
        }
        (session, ends)
    }

    #[test]
    fn reads_the_fixture_chat() {
        let (session, ends) = run(include_str!("fixtures/dsh.jsonl"));
        assert_eq!(session.id, "a0000000-0000-4000-8000-000000000001");
        assert_eq!(session.project, "D:\\Work\\demo-site");
        assert_eq!(session.title, "Demo site checks");
        assert_eq!(session.fallback_title, "Check the demo site links");
        assert_eq!(ends.len(), 1);
        assert_eq!(ends[0].at, Some(1_792_666_830_000));
        assert_eq!(ends[0].steps, ["Write a closing note"]);
        assert!(ends[0].message.contains("TODO(user): Check the dummy chat appears in the TODO list"));
    }

    #[test]
    fn skips_subagents_and_seeded_turns() {
        let child = r#"{"type":"session","version":4,"id":"c","createdAt":1,"cwd":"D:\\Work","isSeeded":false,"delegationDepth":1}"#;
        let end = r#"{"type":"turn/end","seq":2,"time":5,"data":{"turn":1,"reason":{"kind":"completed"}}}"#;
        assert!(run(&format!("{child}\n{end}")).1.is_empty());
        let fork = r#"{"type":"session","version":4,"id":"f","createdAt":1,"cwd":"D:\\Work","isSeeded":true,"delegationDepth":0}"#;
        let seed_end = r#"{"type":"session/end-seed","seq":3,"time":6,"data":{}}"#;
        assert_eq!(run(&format!("{fork}\n{end}\n{seed_end}\n{end}")).1.len(), 1);
    }

    #[test]
    fn decodes_appended_frames_and_waits_for_a_partial_one() {
        // Written by Node's zlib like DSH; the second frame carries a checksum.
        let data = include_bytes!("fixtures/dsh.session.v4.jsonl.zstd");
        let (text, used) = decode_frames(data);
        assert_eq!(used, data.len());
        assert_eq!(String::from_utf8(text).unwrap(), include_str!("fixtures/dsh.jsonl").replace("\r\n", "\n"));

        let (first, used_first) = decode_frames(&data[..data.len() - 3]);
        assert!(used_first < data.len() - 3, "a cut-off frame is not used");
        assert!(include_str!("fixtures/dsh.jsonl").replace("\r\n", "\n").starts_with(std::str::from_utf8(&first).unwrap()));
        let (rest, _) = decode_frames(&data[used_first..]);
        assert_eq!([first, rest].concat(), text_of(data));
    }

    fn text_of(data: &[u8]) -> Vec<u8> {
        decode_frames(data).0
    }
}
