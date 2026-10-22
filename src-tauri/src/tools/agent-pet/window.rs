//! The pet window: a transparent, always-on-top, click-through layer over the
//! work area of the screen the mouse is on. The window passes every click
//! through until the frontend reports that the cursor is over a pet. A poller
//! thread follows the cursor across screens, sends its position to the pet
//! surface, and hides the pets while another app runs full screen.
//!
//! On Windows the click-through style is set directly: changing it through the
//! window library would show the window again with activation, so hovering a
//! pet would take focus from the user's app.

use serde::Serialize;
#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, Ordering};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "agent-pet";
const URL: &str = "index.html#tool-window/agent-pet/pets";
const POINTER_EVENT: &str = "agent-pet-pointer";
const TICK: Duration = Duration::from_millis(25);
const IDLE_TICK: Duration = Duration::from_millis(250);
const REFRESH_SCREENS: Duration = Duration::from_secs(2);
const REPEAT_POINTER: Duration = Duration::from_secs(1);
const CHECK_FULLSCREEN: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct PetWindowState {
    inner: Mutex<Wanted>,
    /// The native window handle, read once: asking the window for it waits on the UI thread.
    #[cfg(windows)]
    handle: AtomicIsize,
}

#[derive(Clone, Copy, Default)]
struct Wanted {
    shown: bool,
    interactive: bool,
}

impl PetWindowState {
    fn wanted(&self) -> Wanted {
        self.inner.lock().map(|wanted| *wanted).unwrap_or_default()
    }

    #[cfg(windows)]
    fn handle(&self, window: &WebviewWindow) -> Option<win32::Hwnd> {
        let mut handle = self.handle.load(Ordering::Relaxed);
        if handle == 0 {
            handle = window.hwnd().ok()?.0 as isize;
            self.handle.store(handle, Ordering::Relaxed);
        }
        Some(handle as win32::Hwnd)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= f64::from(self.x) && y >= f64::from(self.y)
            && x < f64::from(self.x) + f64::from(self.width) && y < f64::from(self.y) + f64::from(self.height)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Screen {
    full: Rect,
    work: Rect,
    scale: f64,
}

/// Where the pet surface sees the cursor, in its own CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    x: f64,
    y: f64,
    fullscreen: bool,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(URL.into()))
        .title("Toolbox-Chan pets")
        .inner_size(320.0, 240.0)
        .position(-32000.0, -32000.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .visible(true)
        .disable_drag_drop_handler()
        .build()?;
    set_click_through(&window, &app.state::<PetWindowState>(), true);
    window.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
    let handle = app.clone();
    thread::Builder::new().name("agent-pet-window".into()).spawn(move || poll(handle))?;
    Ok(())
}

/// The pet surface reports whether any pet is shown and whether the cursor is over one.
#[tauri::command]
pub fn agent_pet_set_window(
    window: WebviewWindow,
    state: tauri::State<'_, PetWindowState>,
    shown: bool,
    interactive: bool,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("This command is not available from this window.".into());
    }
    *state.inner.lock().map_err(|_| "The pet window is unavailable.")? = Wanted { shown, interactive };
    set_click_through(&window, &state, !(shown && interactive));
    Ok(())
}

fn poll(app: AppHandle) {
    let mut screens: Vec<Screen> = Vec::new();
    let mut screens_at: Option<Instant> = None;
    let mut current: Option<Screen> = None;
    let mut last: Option<(Pointer, Instant)> = None;
    let mut fullscreen = false;
    let mut fullscreen_at: Option<Instant> = None;
    loop {
        let Some(window) = app.get_webview_window(LABEL) else { return };
        let state = app.state::<PetWindowState>();
        let wanted = state.wanted();
        // Re-assert the style every tick, so nothing else can leave a window that catches every click.
        set_click_through(&window, &state, !(wanted.shown && wanted.interactive));
        if !wanted.shown {
            thread::sleep(IDLE_TICK);
            continue;
        }
        if screens_at.is_none_or(|at| at.elapsed() >= REFRESH_SCREENS) {
            screens = available_screens(&app);
            screens_at = Some(Instant::now());
            // A display change or a DPI change may have moved the window.
            if let Some(screen) = current.filter(|screen| screens.contains(screen)) {
                place(&window, &screen, false);
            } else {
                current = None;
            }
        }
        let Some((x, y)) = cursor_position(&app) else {
            thread::sleep(TICK);
            continue;
        };
        let Some(screen) = screens.iter().find(|screen| screen.full.contains(x, y)).or(screens.first()).copied() else {
            thread::sleep(TICK);
            continue;
        };
        if current != Some(screen) {
            place(&window, &screen, true);
            current = Some(screen);
            last = None;
        }
        if fullscreen_at.is_none_or(|at| at.elapsed() >= CHECK_FULLSCREEN) {
            fullscreen = another_app_is_fullscreen(&window, &state, &screen.full);
            fullscreen_at = Some(Instant::now());
        }
        let pointer = Pointer {
            x: ((x - f64::from(screen.work.x)) / screen.scale).round(),
            y: ((y - f64::from(screen.work.y)) / screen.scale).round(),
            fullscreen,
        };
        if last.is_none_or(|(previous, at)| previous != pointer || at.elapsed() >= REPEAT_POINTER) {
            let _ = app.emit_to(LABEL, POINTER_EVENT, pointer);
            last = Some((pointer, Instant::now()));
        }
        thread::sleep(TICK);
    }
}

fn available_screens(app: &AppHandle) -> Vec<Screen> {
    let mut monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        monitors.extend(app.primary_monitor().ok().flatten());
    }
    monitors.iter().map(|monitor| {
        let work = monitor.work_area();
        Screen {
            full: Rect { x: monitor.position().x, y: monitor.position().y, width: monitor.size().width, height: monitor.size().height },
            work: Rect { x: work.position.x, y: work.position.y, width: work.size.width, height: work.size.height },
            scale: monitor.scale_factor(),
        }
    }).collect()
}

/// Covers the screen's work area, so pets stand on the taskbar's edge. With
/// `force` the window is moved even if it already seems to be there.
fn place(window: &WebviewWindow, screen: &Screen, force: bool) {
    let position = PhysicalPosition::new(screen.work.x, screen.work.y);
    let size = PhysicalSize::new(screen.work.width, screen.work.height);
    let placed = window.outer_position().ok() == Some(position) && window.outer_size().ok() == Some(size);
    if force || !placed {
        let _ = window.set_position(position);
        let _ = window.set_size(size);
    }
}

#[cfg(windows)]
mod win32 {
    use std::ffi::c_void;
    pub type Hwnd = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    pub const GWL_EXSTYLE: i32 = -20;
    pub const WS_EX_TRANSPARENT: isize = 0x20;
    pub const WS_EX_LAYERED: isize = 0x80000;

    #[link(name = "user32")]
    extern "system" {
        pub fn GetCursorPos(point: *mut Point) -> i32;
        pub fn GetForegroundWindow() -> Hwnd;
        pub fn GetWindowRect(window: Hwnd, rect: *mut Rect) -> i32;
        pub fn GetClassNameW(window: Hwnd, name: *mut u16, max: i32) -> i32;
        pub fn IsZoomed(window: Hwnd) -> i32;
        pub fn GetWindowLongPtrW(window: Hwnd, index: i32) -> isize;
        pub fn SetWindowLongPtrW(window: Hwnd, index: i32, value: isize) -> isize;
    }
}

#[cfg(windows)]
fn set_click_through(window: &WebviewWindow, state: &PetWindowState, through: bool) {
    use win32::*;
    let Some(hwnd) = state.handle(window) else { return };
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = if through { style | WS_EX_TRANSPARENT | WS_EX_LAYERED } else { style & !(WS_EX_TRANSPARENT | WS_EX_LAYERED) };
        if wanted != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
        }
    }
}

#[cfg(not(windows))]
fn set_click_through(window: &WebviewWindow, _state: &PetWindowState, through: bool) {
    let _ = window.set_ignore_cursor_events(through);
}

#[cfg(windows)]
fn cursor_position(_app: &AppHandle) -> Option<(f64, f64)> {
    let mut point = win32::Point::default();
    (unsafe { win32::GetCursorPos(&mut point) } != 0).then(|| (f64::from(point.x), f64::from(point.y)))
}

#[cfg(not(windows))]
fn cursor_position(app: &AppHandle) -> Option<(f64, f64)> {
    app.cursor_position().ok().map(|point| (point.x, point.y))
}

/// True when the foreground window of another app covers the whole screen, such as a video or a game.
/// A maximized window is not full screen, even when an auto-hidden taskbar lets it cover the screen
/// (Windows' own "busy" state counts that case, so it cannot be used here).
#[cfg(windows)]
fn another_app_is_fullscreen(window: &WebviewWindow, state: &PetWindowState, screen: &Rect) -> bool {
    use win32::*;
    let own = state.handle(window).unwrap_or(std::ptr::null_mut());
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_null() || foreground == own || IsZoomed(foreground) != 0 {
            return false;
        }
        let mut name = [0u16; 64];
        let length = GetClassNameW(foreground, name.as_mut_ptr(), name.len() as i32).max(0) as usize;
        // The desktop and the taskbar cover the screen too, but they are not full-screen apps.
        if matches!(String::from_utf16_lossy(&name[..length]).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        let mut rect = win32::Rect::default();
        if GetWindowRect(foreground, &mut rect) == 0 {
            return false;
        }
        rect.left <= screen.x && rect.top <= screen.y
            && i64::from(rect.right) >= i64::from(screen.x) + i64::from(screen.width)
            && i64::from(rect.bottom) >= i64::from(screen.y) + i64::from(screen.height)
    }
}

#[cfg(not(windows))]
fn another_app_is_fullscreen(_window: &WebviewWindow, _state: &PetWindowState, _screen: &Rect) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screens_contain_their_own_pixels_only() {
        let screen = Rect { x: -1920, y: 0, width: 1920, height: 1080 };
        assert!(screen.contains(-1920.0, 0.0));
        assert!(screen.contains(-1.0, 1079.0));
        assert!(!screen.contains(0.0, 0.0));
        assert!(!screen.contains(-1000.0, 1080.0));
    }
}
