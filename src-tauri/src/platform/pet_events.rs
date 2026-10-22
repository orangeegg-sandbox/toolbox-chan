//! The pet event API: the one way anything talks to the desktop pets. In-app
//! tools call `pet_notify`; outside programs such as agent hooks post the same
//! JSON to the loopback door in `pet_door.rs`. Both reach `PetHub::publish`,
//! which validates the event, keeps the latest badges, and forwards it to every
//! window. Core owns this contract; the pet tool owns what the pets do with it.
//! Keep the rules in step with `src/core/pet/types.ts`.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::json;
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "pet-event";
pub const VISIBILITY_EVENT: &str = "pet-visibility";
pub const OPEN_TOOL_EVENT: &str = "pet-open-tool";

const MAX_SOURCE: usize = 64;
const MAX_SESSION_ID: usize = 200;
const MAX_NOTE: usize = 200;
const MAX_TOOL_ID: usize = 64;
const MAX_COUNT: u32 = 9999;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Codex,
    Deepseek,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetStatus {
    Working,
    Done,
    NeedsYou,
    Idle,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PetEmote {
    Happy,
    Laugh,
    Surprised,
    Sleepy,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PetAction {
    #[serde(rename_all = "camelCase")]
    OpenTool { tool_id: String },
}

impl PetAction {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::OpenTool { tool_id } => check_text("badge action toolId", tool_id, MAX_TOOL_ID),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetBadge {
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<PetAction>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetEvent {
    pub source: String,
    /// `None` addresses every pet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<PetStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emote: Option<PetEmote>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Absent leaves this source's badge alone; `null` clears it.
    #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
    pub badge: Option<Option<PetBadge>>,
}

fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(deserializer: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

fn check_text(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("The pet event {name} must not be empty."));
    }
    if value.chars().count() > max {
        return Err(format!("The pet event {name} must be at most {max} characters."));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("The pet event {name} must not contain control characters."));
    }
    Ok(())
}

impl PetEvent {
    pub fn parse(json: &[u8]) -> Result<Self, String> {
        let event: Self = serde_json::from_slice(json).map_err(|error| format!("This is not a valid pet event: {error}"))?;
        event.validate()?;
        Ok(event)
    }

    pub fn validate(&self) -> Result<(), String> {
        check_text("source", &self.source, MAX_SOURCE)?;
        if let Some(id) = &self.session_id {
            check_text("sessionId", id, MAX_SESSION_ID)?;
        }
        if let Some(note) = &self.note {
            check_text("note", note, MAX_NOTE)?;
        }
        if let Some(Some(badge)) = &self.badge {
            if badge.count > MAX_COUNT {
                return Err(format!("The pet event badge count must be at most {MAX_COUNT}."));
            }
            if let Some(action) = &badge.action {
                action.validate()?;
            }
        }
        if self.status.is_none() && self.emote.is_none() && self.note.is_none() && self.badge.is_none() {
            return Err("A pet event needs a status, emote, note, or badge.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BadgeEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentId>,
    pub source: String,
    pub badge: PetBadge,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorStatus {
    pub url: String,
    pub listening: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetState {
    pub visible: bool,
    pub badges: Vec<BadgeEntry>,
    pub door: DoorStatus,
}

/// Badges are keyed by agent and source, so one source never clears another's.
type Badges = HashMap<(Option<AgentId>, String), PetBadge>;

fn apply_badge(badges: &mut Badges, event: &PetEvent) {
    let key = (event.agent, event.source.clone());
    match &event.badge {
        Some(Some(badge)) => {
            badges.insert(key, badge.clone());
        }
        Some(None) => {
            badges.remove(&key);
        }
        None => {}
    }
}

struct HubState {
    visible: bool,
    badges: Badges,
    door: DoorStatus,
}

pub struct PetHub {
    state: Mutex<HubState>,
}

impl Default for PetHub {
    fn default() -> Self {
        Self {
            state: Mutex::new(HubState { visible: true, badges: HashMap::new(), door: DoorStatus::default() }),
        }
    }
}

impl PetHub {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HubState>, String> {
        self.state.lock().map_err(|_| "The pet event service is unavailable.".to_string())
    }

    pub fn publish(&self, app: &AppHandle, event: PetEvent) -> Result<(), String> {
        event.validate()?;
        apply_badge(&mut self.lock()?.badges, &event);
        app.emit(EVENT, &event).map_err(|error| error.to_string())
    }

    pub fn set_visible(&self, app: &AppHandle, visible: bool) -> Result<(), String> {
        self.lock()?.visible = visible;
        app.emit(VISIBILITY_EVENT, json!({ "visible": visible })).map_err(|error| error.to_string())
    }

    pub fn set_door(&self, door: DoorStatus) {
        if let Ok(mut state) = self.state.lock() {
            state.door = door;
        }
    }

    pub fn snapshot(&self) -> Result<PetState, String> {
        let state = self.lock()?;
        let mut badges: Vec<BadgeEntry> = state.badges.iter()
            .map(|((agent, source), badge)| BadgeEntry { agent: *agent, source: source.clone(), badge: badge.clone() })
            .collect();
        badges.sort_by(|a, b| (a.agent.map(|agent| agent as u8), &a.source).cmp(&(b.agent.map(|agent| agent as u8), &b.source)));
        Ok(PetState { visible: state.visible, badges, door: state.door.clone() })
    }
}

#[tauri::command]
pub fn pet_notify(app: AppHandle, hub: tauri::State<'_, PetHub>, event: PetEvent) -> Result<(), String> {
    hub.publish(&app, event)
}

#[tauri::command]
pub fn pet_get_state(hub: tauri::State<'_, PetHub>) -> Result<PetState, String> {
    hub.snapshot()
}

/// Runs a badge's action on behalf of the pet, which does not know what it opens.
#[tauri::command]
pub fn pet_run_action(app: AppHandle, action: PetAction) -> Result<(), String> {
    action.validate()?;
    match action {
        PetAction::OpenTool { tool_id } => {
            crate::platform::tray::show_main(&app)?;
            app.emit_to(crate::platform::tray::MAIN_WINDOW, OPEN_TOOL_EVENT, json!({ "toolId": tool_id }))
                .map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: serde_json::Value) -> Result<PetEvent, String> {
        PetEvent::parse(value.to_string().as_bytes())
    }

    #[test]
    fn accepts_complete_and_minimal_events() {
        let event = parse(json!({
            "source": "hook",
            "agent": "claude",
            "sessionId": "abc-123",
            "status": "needs-you",
            "emote": "happy",
            "note": "CustomOfflineTool · Add pet",
            "badge": { "count": 3, "action": { "type": "open-tool", "toolId": "example" } }
        })).unwrap();
        assert_eq!(event.status, Some(PetStatus::NeedsYou));
        assert_eq!(event.badge, Some(Some(PetBadge {
            count: 3,
            action: Some(PetAction::OpenTool { tool_id: "example".into() }),
        })));
        assert!(parse(json!({ "source": "script", "emote": "laugh" })).is_ok());
        assert_eq!(parse(json!({ "source": "script", "badge": null })).unwrap().badge, Some(None));
    }

    #[test]
    fn round_trips_badge_clearing_and_omits_absent_fields() {
        let event = parse(json!({ "source": "script", "agent": "codex", "badge": null })).unwrap();
        assert_eq!(serde_json::to_value(&event).unwrap(), json!({ "source": "script", "agent": "codex", "badge": null }));
    }

    #[test]
    fn rejects_malformed_events() {
        for value in [
            json!({ "agent": "claude", "status": "done" }),
            json!({ "source": "", "status": "done" }),
            json!({ "source": "   ", "status": "done" }),
            json!({ "source": "x".repeat(65), "status": "done" }),
            json!({ "source": "hook" }),
            json!({ "source": "hook", "agent": "gemini", "status": "done" }),
            json!({ "source": "hook", "status": "finished" }),
            json!({ "source": "hook", "emote": "dance" }),
            json!({ "source": "hook", "status": "done", "colour": "red" }),
            json!({ "source": "hook", "note": "line\nbreak" }),
            json!({ "source": "hook", "note": "x".repeat(201) }),
            json!({ "source": "hook", "sessionId": "", "status": "done" }),
            json!({ "source": "hook", "badge": { "count": 10000 } }),
            json!({ "source": "hook", "badge": { "count": -1 } }),
            json!({ "source": "hook", "badge": { "count": 1, "action": { "type": "open-tool", "toolId": "" } } }),
            json!({ "source": "hook", "badge": { "count": 1, "action": { "type": "run-script", "path": "x" } } }),
            json!({ "source": "hook", "badge": { "count": 1, "action": { "type": "open-tool", "toolId": "a", "extra": 1 } } }),
        ] {
            assert!(parse(value.clone()).is_err(), "accepted {value}");
        }
        assert!(PetEvent::parse(b"not json").is_err());
    }

    #[test]
    fn badges_are_kept_per_agent_and_source() {
        let mut badges = Badges::new();
        let event = |value: serde_json::Value| parse(value).unwrap();
        apply_badge(&mut badges, &event(json!({ "source": "a", "agent": "claude", "badge": { "count": 2 } })));
        apply_badge(&mut badges, &event(json!({ "source": "b", "agent": "claude", "badge": { "count": 5 } })));
        apply_badge(&mut badges, &event(json!({ "source": "a", "agent": "codex", "badge": { "count": 1 } })));
        apply_badge(&mut badges, &event(json!({ "source": "a", "badge": { "count": 7 } })));
        assert_eq!(badges.len(), 4);

        apply_badge(&mut badges, &event(json!({ "source": "a", "agent": "claude", "badge": { "count": 4 } })));
        assert_eq!(badges[&(Some(AgentId::Claude), "a".to_string())].count, 4);
        assert_eq!(badges[&(Some(AgentId::Claude), "b".to_string())].count, 5);

        apply_badge(&mut badges, &event(json!({ "source": "a", "agent": "claude", "status": "done" })));
        assert_eq!(badges.len(), 4, "an event without a badge leaves badges alone");

        apply_badge(&mut badges, &event(json!({ "source": "a", "agent": "claude", "badge": null })));
        assert!(!badges.contains_key(&(Some(AgentId::Claude), "a".to_string())));
        assert_eq!(badges.len(), 3);
    }
}
