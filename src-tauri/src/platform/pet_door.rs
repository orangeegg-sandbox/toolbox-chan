//! A loopback-only HTTP door to the pet event API for programs outside the app,
//! such as agent hooks:
//!
//!   curl -s -m 2 -H "Content-Type: application/json" -d "{\"source\":\"hook\",\"agent\":\"claude\",\"status\":\"done\"}" http://127.0.0.1:47615/pet/events
//!
//! Web pages cannot use it: a request with an `Origin` header is refused, and a
//! JSON content type forces a CORS preflight that is never answered. The `Host`
//! check stops DNS rebinding. Requests are small and handled one at a time.

use super::pet_events::{DoorStatus, PetEvent, PetHub};
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, TcpListener},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager};

pub const PORT: u16 = 47615;
const PATH: &str = "/pet/events";
const MAX_HEAD: usize = 8 * 1024;
const MAX_BODY: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(2);

pub fn url() -> String {
    format!("http://127.0.0.1:{PORT}{PATH}")
}

/// Opens the door on a background thread and records the outcome for settings pages.
pub fn start(app: &AppHandle) {
    let hub = app.state::<PetHub>();
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, PORT)) {
        Ok(listener) => listener,
        Err(error) => {
            hub.set_door(DoorStatus { url: url(), listening: false, error: Some(format!("Port {PORT} is unavailable: {error}")) });
            return;
        }
    };
    let handle = app.clone();
    if let Err(error) = thread::Builder::new().name("pet-event-door".into()).spawn(move || serve(handle, listener)) {
        hub.set_door(DoorStatus { url: url(), listening: false, error: Some(format!("The pet event door could not start: {error}")) });
        return;
    }
    hub.set_door(DoorStatus { url: url(), listening: true, error: None });
    write_discovery_file(app);
}

/// Scripts can read the door's address from `<app data>/pet-api.json`.
fn write_discovery_file(app: &AppHandle) {
    let Ok(directory) = app.path().app_data_dir() else { return };
    let contents = serde_json::json!({ "url": url(), "port": PORT }).to_string();
    if std::fs::create_dir_all(&directory).is_ok() {
        let _ = std::fs::write(directory.join("pet-api.json"), contents);
    }
}

fn serve(app: AppHandle, listener: TcpListener) {
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let _ = stream.set_read_timeout(Some(TIMEOUT));
        let _ = stream.set_write_timeout(Some(TIMEOUT));
        let response = match read_request(&mut stream) {
            Ok(event) => match app.state::<PetHub>().publish(&app, event) {
                Ok(()) => Response::new(204, ""),
                Err(error) => Response::new(400, error),
            },
            Err(response) => response,
        };
        let _ = stream.write_all(&response.to_bytes());
        let _ = stream.flush();
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Response {
    status: u16,
    message: String,
}

impl Response {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }

    fn to_bytes(&self) -> Vec<u8> {
        let reason = match self.status {
            204 => "No Content",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            408 => "Request Timeout",
            411 => "Length Required",
            413 => "Content Too Large",
            415 => "Unsupported Media Type",
            431 => "Request Header Fields Too Large",
            _ => "Error",
        };
        let allow = if self.status == 405 { "Allow: POST\r\n" } else { "" };
        if self.status == 204 {
            return format!("HTTP/1.1 204 {reason}\r\nConnection: close\r\n\r\n").into_bytes();
        }
        let body = format!("{}\n", self.message);
        format!(
            "HTTP/1.1 {} {reason}\r\n{allow}Content-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            self.status,
            body.len(),
        ).into_bytes()
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn read_request(stream: &mut impl Read) -> Result<PetEvent, Response> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let head_end = loop {
        if let Some(end) = find(&buffer, b"\r\n\r\n") {
            break end;
        }
        if buffer.len() > MAX_HEAD {
            return Err(Response::new(431, "The request headers are too large."));
        }
        let read = stream.read(&mut chunk).map_err(|_| Response::new(408, "The request was not received in time."))?;
        if read == 0 {
            return Err(Response::new(400, "The request ended early."));
        }
        buffer.extend_from_slice(&chunk[..read]);
    };
    let head = std::str::from_utf8(&buffer[..head_end]).map_err(|_| Response::new(400, "The request headers are not valid text."))?;
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split(' ');
    let (method, target) = match (request_line.next(), request_line.next(), request_line.next(), request_line.next()) {
        (Some(method), Some(target), Some(version), None) if version.starts_with("HTTP/1.") => (method, target),
        _ => return Err(Response::new(400, "This is not an HTTP/1 request.")),
    };
    let mut host = None;
    let mut content_type = None;
    let mut content_length = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or_else(|| Response::new(400, "A request header is malformed."))?;
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "host" => host = Some(value),
            "origin" => return Err(Response::new(403, "Requests from web pages are not accepted.")),
            "content-type" => content_type = Some(value),
            "content-length" => content_length = Some(value.parse::<usize>().map_err(|_| Response::new(400, "Content-Length is not a number."))?),
            "transfer-encoding" => return Err(Response::new(411, "Send the event with a Content-Length.")),
            _ => {}
        }
    }
    let allowed_hosts = [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")];
    if !host.is_some_and(|host| allowed_hosts.iter().any(|allowed| allowed.eq_ignore_ascii_case(host))) {
        return Err(Response::new(403, "Use http://127.0.0.1 to reach the pet event door."));
    }
    if target != PATH {
        return Err(Response::new(404, format!("Post pet events to {PATH}.")));
    }
    if method != "POST" {
        return Err(Response::new(405, "Use POST to send a pet event."));
    }
    let is_json = content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(Response::new(415, "Send the event as Content-Type: application/json."));
    }
    let length = content_length.ok_or_else(|| Response::new(411, "Send the event with a Content-Length."))?;
    if length > MAX_BODY {
        return Err(Response::new(413, format!("A pet event must be at most {MAX_BODY} bytes.")));
    }
    let mut body = buffer.split_off(head_end + 4);
    if body.len() < length {
        let start = body.len();
        body.resize(length, 0);
        stream.read_exact(&mut body[start..]).map_err(|_| Response::new(408, "The request body was not received in time."))?;
    }
    body.truncate(length);
    PetEvent::parse(&body).map_err(|error| Response::new(400, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn request(method: &str, target: &str, headers: &[&str], body: &str) -> Result<PetEvent, Response> {
        let mut text = format!("{method} {target} HTTP/1.1\r\n");
        for header in headers {
            text.push_str(header);
            text.push_str("\r\n");
        }
        text.push_str("\r\n");
        text.push_str(body);
        read_request(&mut Cursor::new(text.into_bytes()))
    }

    fn post(headers: &[&str], body: &str) -> Result<PetEvent, Response> {
        request("POST", PATH, headers, body)
    }

    fn status(result: Result<PetEvent, Response>) -> u16 {
        result.map(|_| 204).unwrap_or_else(|response| response.status)
    }

    const EVENT: &str = r#"{"source":"hook","agent":"claude","status":"done"}"#;

    fn length(body: &str) -> String {
        format!("Content-Length: {}", body.len())
    }

    #[test]
    fn accepts_a_json_post_from_curl() {
        let host = format!("Host: 127.0.0.1:{PORT}");
        let event = post(&[&host, "User-Agent: curl/8.4.0", "Content-Type: application/json; charset=utf-8", &length(EVENT)], EVENT).unwrap();
        assert_eq!(event.source, "hook");
        let localhost = format!("Host: LOCALHOST:{PORT}");
        assert_eq!(status(post(&[&localhost, "Content-Type: application/json", &length(EVENT)], EVENT)), 204);
    }

    #[test]
    fn reads_a_body_that_arrives_after_the_headers() {
        let host = format!("Host: 127.0.0.1:{PORT}");
        let head = format!("POST {PATH} HTTP/1.1\r\n{host}\r\nContent-Type: application/json\r\n{}\r\n\r\n", length(EVENT));
        let mut reader = Cursor::new(head.into_bytes()).chain(Cursor::new(EVENT.as_bytes().to_vec()));
        assert!(read_request(&mut reader).is_ok());
    }

    #[test]
    fn refuses_browsers_other_hosts_and_wrong_requests() {
        let host = format!("Host: 127.0.0.1:{PORT}");
        let json = "Content-Type: application/json";
        let len = length(EVENT);
        assert_eq!(status(post(&[&host, json, &len, "Origin: https://example.com"], EVENT)), 403);
        assert_eq!(status(post(&["Host: evil.example:47615", json, &len], EVENT)), 403);
        assert_eq!(status(post(&[json, &len], EVENT)), 403);
        assert_eq!(status(post(&[&host, "Content-Type: text/plain", &len], EVENT)), 415);
        assert_eq!(status(post(&[&host, &len], EVENT)), 415);
        assert_eq!(status(post(&[&host, json], EVENT)), 411);
        assert_eq!(status(post(&[&host, json, "Transfer-Encoding: chunked"], EVENT)), 411);
        assert_eq!(status(post(&[&host, json, "Content-Length: 99999"], EVENT)), 413);
        assert_eq!(status(request("GET", PATH, &[&host], "")), 405);
        assert_eq!(status(request("POST", "/other", &[&host, json, &len], EVENT)), 404);
        let bad = r#"{"source":"hook"}"#;
        assert_eq!(status(post(&[&host, json, &length(bad)], bad)), 400);
        assert_eq!(status(read_request(&mut Cursor::new(b"garbage\r\n\r\n".to_vec()))), 400);
        assert_eq!(status(read_request(&mut Cursor::new(b"POST /pet/events HTTP/1.1\r\nHost".to_vec()))), 400);
        assert_eq!(status(read_request(&mut Cursor::new(vec![b'a'; MAX_HEAD + 2048]))), 431);
    }

    #[test]
    fn a_short_body_is_an_error_not_a_partial_event() {
        let host = format!("Host: 127.0.0.1:{PORT}");
        assert_eq!(status(post(&[&host, "Content-Type: application/json", "Content-Length: 80"], EVENT)), 408);
    }

    #[test]
    fn responses_are_well_formed() {
        let text = String::from_utf8(Response::new(405, "Use POST.").to_bytes()).unwrap();
        assert!(text.starts_with("HTTP/1.1 405 Method Not Allowed\r\nAllow: POST\r\n"));
        assert!(text.ends_with("\r\n\r\nUse POST.\n"));
        assert!(text.contains("Content-Length: 10\r\n"));
        assert_eq!(String::from_utf8(Response::new(204, "").to_bytes()).unwrap(), "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
    }
}
