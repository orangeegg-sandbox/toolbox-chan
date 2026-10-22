//! The modifier gesture stays a pass-through hook; ordinary chords use Windows'
//! hotkey registration so conflicts can be reported without intercepting typing.

#[derive(Clone)]
pub struct PaletteShortcutService {
    #[cfg(windows)]
    service: std::sync::Arc<Result<windows::ShortcutService, String>>,
}

impl PaletteShortcutService {
    pub fn new(app: tauri::AppHandle) -> Self {
        #[cfg(windows)]
        {
            Self {
                service: std::sync::Arc::new(windows::ShortcutService::start(app)),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            Self {}
        }
    }

    fn set(&self, shortcut: &str) -> Result<(), String> {
        #[cfg(windows)]
        {
            let shortcut = gesture::Shortcut::parse(shortcut)?;
            self.service.as_ref().as_ref().map_err(Clone::clone)?.set(shortcut)
        }
        #[cfg(not(windows))]
        {
            let _ = shortcut;
            Err("Global command palette shortcuts are currently supported on Windows only.".into())
        }
    }
}

#[tauri::command]
pub async fn set_palette_shortcut(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, PaletteShortcutService>,
    shortcut: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("The command palette shortcut can only be changed from the toolbox.".into());
    }
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.set(&shortcut))
        .await
        .map_err(|_| "The command palette shortcut could not be updated.".to_string())?
}

#[cfg(any(windows, test))]
mod gesture {
    pub const DOUBLE_TAP_INTERVAL_MS: u64 = 500;
    const MAX_TAP_DURATION_MS: u64 = 500;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Shortcut {
        Disabled,
        DoubleTap,
        Chord { modifiers: u32, key: u32 },
    }

    impl Shortcut {
        pub fn parse(value: &str) -> Result<Self, String> {
            if value.is_empty() {
                return Ok(Self::Disabled);
            }
            if value == "Ctrl+Shift+DoubleTap" {
                return Ok(Self::DoubleTap);
            }
            let mut modifiers = 0;
            let mut key = None;
            for part in value.split('+') {
                let modifier = match part {
                    "Alt" => 0x0001,
                    "Ctrl" => 0x0002,
                    "Shift" => 0x0004,
                    "Meta" => 0x0008,
                    _ => 0,
                };
                if modifier != 0 {
                    if modifiers & modifier != 0 || key.is_some() {
                        return Err("Use each modifier once, before the shortcut key.".into());
                    }
                    modifiers |= modifier;
                } else if key.is_none() {
                    key = Some(parse_key(part).ok_or_else(|| {
                        "Use a letter, number, function key, Space, or navigation key.".to_string()
                    })?);
                } else {
                    return Err("A shortcut can contain only one non-modifier key.".into());
                }
            }
            match (modifiers, key) {
                (modifiers, _) if modifiers & 0x000b == 0 => Err("Choose Ctrl, Alt, or Meta with a shortcut key.".into()),
                (_, None) => Err("Choose at least one modifier and a shortcut key.".into()),
                (modifiers, Some(key)) => Ok(Self::Chord { modifiers, key }),
            }
        }
    }

    fn parse_key(value: &str) -> Option<u32> {
        let bytes = value.as_bytes();
        if bytes.len() == 1 && (bytes[0].is_ascii_uppercase() || bytes[0].is_ascii_digit()) {
            return Some(u32::from(bytes[0]));
        }
        if let Some(function) = value.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
            if (1..=24).contains(&function) {
                return Some(0x70 + function - 1);
            }
        }
        Some(match value {
            "Backspace" => 0x08,
            "Tab" => 0x09,
            "Enter" => 0x0d,
            "Escape" => 0x1b,
            "Space" => 0x20,
            "PageUp" => 0x21,
            "PageDown" => 0x22,
            "End" => 0x23,
            "Home" => 0x24,
            "ArrowLeft" => 0x25,
            "ArrowUp" => 0x26,
            "ArrowRight" => 0x27,
            "ArrowDown" => 0x28,
            "Insert" => 0x2d,
            "Delete" => 0x2e,
            _ => return None,
        })
    }

    struct Tap {
        started: u64,
        saw_chord: bool,
        invalid: bool,
    }

    pub struct DoubleTapDetector {
        down: [bool; 256],
        armed: bool,
        tap: Option<Tap>,
        previous_release: Option<u64>,
    }

    impl DoubleTapDetector {
        pub fn new(down: [bool; 256]) -> Self {
            Self {
                armed: !down.iter().any(|pressed| *pressed),
                down,
                tap: None,
                previous_release: None,
            }
        }

        pub fn event(&mut self, key: u32, pressed: bool, now: u64) -> bool {
            let Some(is_down) = self.down.get_mut(key as usize) else {
                return false;
            };
            if *is_down == pressed {
                return false; // Ignore autorepeat and unmatched releases.
            }
            *is_down = pressed;
            if !self.armed {
                self.armed = !self.down.iter().any(|down| *down);
                return false;
            }

            let ctrl = [0x11, 0xa2, 0xa3].iter().any(|key| self.down[*key]);
            let shift = [0x10, 0xa0, 0xa1].iter().any(|key| self.down[*key]);
            let is_gesture_key = matches!(key, 0x10 | 0x11 | 0xa0..=0xa3);
            if !is_gesture_key {
                self.previous_release = None;
                if let Some(tap) = &mut self.tap {
                    tap.invalid = true;
                }
            }
            if (ctrl || shift) && self.tap.is_none() {
                self.tap = Some(Tap {
                    started: now,
                    saw_chord: false,
                    invalid: self.down.iter().enumerate().any(|(key, down)| {
                        *down && !matches!(key, 0x10 | 0x11 | 0xa0..=0xa3)
                    }),
                });
            }
            if let Some(tap) = &mut self.tap {
                tap.saw_chord |= ctrl && shift;
            }
            // A tap completes only after both modifiers have been fully released.
            if !ctrl && !shift {
                if let Some(tap) = self.tap.take() {
                    if tap.invalid || !tap.saw_chord || now.saturating_sub(tap.started) > MAX_TAP_DURATION_MS {
                        self.previous_release = None;
                        return false;
                    }
                    if self.previous_release.is_some_and(|previous| now.saturating_sub(previous) <= DOUBLE_TAP_INTERVAL_MS) {
                        self.previous_release = None;
                        return true;
                    }
                    self.previous_release = Some(now);
                }
            }
            false
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::gesture::{DoubleTapDetector, Shortcut};
    use std::{cell::RefCell, ffi::c_void, ptr::null_mut, sync::mpsc, thread, time::Instant};

    const WM_CONFIGURE: u32 = 0x8001;
    const WM_HOTKEY: u32 = 0x0312;
    const WM_QUIT: u32 = 0x0012;
    const MOD_NOREPEAT: u32 = 0x4000;

    // The small Win32 surface is declared here to avoid another platform crate.
    #[repr(C)]
    #[derive(Default)]
    struct Point { x: i32, y: i32 }

    #[repr(C)]
    #[derive(Default)]
    struct Message {
        hwnd: *mut c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        point: Point,
        private: u32,
    }

    #[repr(C)]
    struct KeyboardEvent {
        key: u32,
        scan_code: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowsHookExW(kind: i32, callback: Option<unsafe extern "system" fn(i32, usize, isize) -> isize>, module: *mut c_void, thread: u32) -> *mut c_void;
        fn CallNextHookEx(hook: *mut c_void, code: i32, wparam: usize, lparam: isize) -> isize;
        fn UnhookWindowsHookEx(hook: *mut c_void) -> i32;
        fn GetMessageW(message: *mut Message, window: *mut c_void, min: u32, max: u32) -> i32;
        fn PeekMessageW(message: *mut Message, window: *mut c_void, min: u32, max: u32, remove: u32) -> i32;
        fn PostThreadMessageW(thread: u32, message: u32, wparam: usize, lparam: isize) -> i32;
        fn RegisterHotKey(window: *mut c_void, id: i32, modifiers: u32, key: u32) -> i32;
        fn UnregisterHotKey(window: *mut c_void, id: i32) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
    }

    struct HookContext {
        detector: DoubleTapDetector,
        enabled: bool,
        origin: Instant,
        triggered: mpsc::Sender<()>,
    }

    thread_local! {
        static CONTEXT: RefCell<Option<HookContext>> = const { RefCell::new(None) };
    }

    // Called exclusively on the dedicated hook thread. The callback only tracks
    // pressed keys and sends a signal; all window work happens off the hook.
    unsafe extern "system" fn keyboard_hook(code: i32, wparam: usize, lparam: isize) -> isize {
        if code >= 0 && matches!(wparam, 0x0100 | 0x0101 | 0x0104 | 0x0105) {
            let event = &*(lparam as *const KeyboardEvent);
            CONTEXT.with(|context| {
                if let Some(context) = context.borrow_mut().as_mut() {
                    if context.enabled && context.detector.event(
                        event.key,
                        matches!(wparam, 0x0100 | 0x0104),
                        context.origin.elapsed().as_millis() as u64,
                    ) {
                        let _ = context.triggered.send(());
                    }
                }
            });
        }
        CallNextHookEx(null_mut(), code, wparam, lparam)
    }

    fn initial_keys() -> [bool; 256] {
        let mut down = [false; 256];
        // Generic modifier aliases duplicate the side-specific keys. Mouse
        // buttons have no keyboard release event and must not enter this state.
        for key in 8..256 {
            if !matches!(key, 0x10..=0x12) {
                down[key] = unsafe { GetAsyncKeyState(key as i32) < 0 };
            }
        }
        down
    }

    struct Configure {
        shortcut: Shortcut,
        result: mpsc::Sender<Result<(), String>>,
    }

    pub struct ShortcutService {
        thread_id: u32,
        requests: mpsc::Sender<Configure>,
    }

    impl ShortcutService {
        pub fn start(app: tauri::AppHandle) -> Result<Self, String> {
            let (requests, incoming) = mpsc::channel::<Configure>();
            let (started, startup) = mpsc::sync_channel(1);
            let (triggered, triggers) = mpsc::channel();
            thread::Builder::new().name("palette-shortcut-actions".into()).spawn(move || {
                while triggers.recv().is_ok() {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Err(error) = crate::platform::palette_window::show(&handle) {
                            eprintln!("Could not open the command palette: {error}");
                        }
                    });
                }
            }).map_err(|error| format!("Could not start the shortcut service: {error}"))?;

            thread::Builder::new().name("palette-shortcut-hook".into()).spawn(move || unsafe {
                let mut message = Message::default();
                PeekMessageW(&mut message, null_mut(), 0, 0, 0);
                CONTEXT.with(|context| *context.borrow_mut() = Some(HookContext {
                    detector: DoubleTapDetector::new(initial_keys()),
                    enabled: true,
                    origin: Instant::now(),
                    triggered: triggered.clone(),
                }));
                let hook = SetWindowsHookExW(13, Some(keyboard_hook), GetModuleHandleW(std::ptr::null()), 0);
                if hook.is_null() {
                    let _ = started.send(Err(format!("Windows could not enable the command palette shortcut: {}", std::io::Error::last_os_error())));
                    CONTEXT.with(|context| *context.borrow_mut() = None);
                    return;
                }
                let _ = started.send(Ok(GetCurrentThreadId()));
                let mut active = Shortcut::DoubleTap;
                let mut hotkey_id = None;
                while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                    if message.message == WM_CONFIGURE {
                        while let Ok(request) = incoming.try_recv() {
                            let result = configure(request.shortcut, &mut active, &mut hotkey_id);
                            let _ = request.result.send(result);
                        }
                    } else if message.message == WM_HOTKEY && hotkey_id == Some(message.wparam as i32) {
                        let _ = triggered.send(());
                    }
                }
                if let Some(id) = hotkey_id {
                    UnregisterHotKey(null_mut(), id);
                }
                UnhookWindowsHookEx(hook);
                CONTEXT.with(|context| *context.borrow_mut() = None);
            }).map_err(|error| format!("Could not start the shortcut hook: {error}"))?;

            let thread_id = startup.recv().map_err(|_| "The shortcut service stopped before it was ready.".to_string())??;
            Ok(Self { thread_id, requests })
        }

        pub fn set(&self, shortcut: Shortcut) -> Result<(), String> {
            let (result, response) = mpsc::channel();
            self.requests.send(Configure { shortcut, result }).map_err(|_| "The command palette shortcut service has stopped.".to_string())?;
            if unsafe { PostThreadMessageW(self.thread_id, WM_CONFIGURE, 0, 0) } == 0 {
                return Err("Windows could not update the command palette shortcut.".into());
            }
            response.recv().map_err(|_| "The command palette shortcut service has stopped.".to_string())?
        }
    }

    impl Drop for ShortcutService {
        fn drop(&mut self) {
            unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0); }
        }
    }

    unsafe fn configure(shortcut: Shortcut, active: &mut Shortcut, hotkey_id: &mut Option<i32>) -> Result<(), String> {
        if shortcut == *active {
            return Ok(());
        }
        // Register the replacement before dropping the current shortcut. A
        // conflict therefore leaves the existing binding fully operational.
        let replacement = if let Shortcut::Chord { modifiers, key } = shortcut {
            let id = if *hotkey_id == Some(1) { 2 } else { 1 };
            if RegisterHotKey(null_mut(), id, modifiers | MOD_NOREPEAT, key) == 0 {
                return Err(format!("Windows could not register this shortcut. It may already be in use or reserved. Choose another combination. ({})", std::io::Error::last_os_error()));
            }
            Some(id)
        } else {
            None
        };
        if let Some(id) = *hotkey_id {
            UnregisterHotKey(null_mut(), id);
        }
        *hotkey_id = replacement;
        *active = shortcut;
        CONTEXT.with(|context| {
            if let Some(context) = context.borrow_mut().as_mut() {
                context.detector = DoubleTapDetector::new(initial_keys());
                context.enabled = shortcut == Shortcut::DoubleTap;
            }
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::gesture::{DoubleTapDetector, Shortcut};

    fn tap(detector: &mut DoubleTapDetector, start: u64) -> bool {
        assert!(!detector.event(0xa2, true, start));
        assert!(!detector.event(0xa0, true, start + 10));
        assert!(!detector.event(0xa2, false, start + 20));
        detector.event(0xa0, false, start + 30)
    }

    #[test]
    fn parses_default_disabled_and_custom_chords() {
        assert_eq!(Shortcut::parse("Ctrl+Shift+DoubleTap"), Ok(Shortcut::DoubleTap));
        assert_eq!(Shortcut::parse(""), Ok(Shortcut::Disabled));
        assert_eq!(Shortcut::parse("Ctrl+Shift+P"), Ok(Shortcut::Chord { modifiers: 6, key: 0x50 }));
        assert_eq!(Shortcut::parse("Alt+Space"), Ok(Shortcut::Chord { modifiers: 1, key: 0x20 }));
        assert_eq!(Shortcut::parse("Meta+ArrowUp"), Ok(Shortcut::Chord { modifiers: 8, key: 0x26 }));
        assert_eq!(Shortcut::parse("Ctrl+F24"), Ok(Shortcut::Chord { modifiers: 2, key: 0x87 }));
        for invalid in ["P", "Ctrl", "Shift+A", "Shift+F1", "Ctrl+Ctrl+P", "Ctrl+P+K", "Ctrl+P+Shift", "Ctrl+F25", "Ctrl+DoubleTap"] {
            assert!(Shortcut::parse(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn double_tap_triggers_once_on_second_complete_release() {
        let mut detector = DoubleTapDetector::new([false; 256]);
        assert!(!tap(&mut detector, 0));
        assert!(tap(&mut detector, 150));
        assert!(!tap(&mut detector, 300));
        assert!(tap(&mut detector, 450));
    }

    #[test]
    fn slow_or_long_taps_do_not_trigger() {
        let mut detector = DoubleTapDetector::new([false; 256]);
        assert!(!tap(&mut detector, 0));
        assert!(!tap(&mut detector, 550));
        assert!(!detector.event(0xa2, true, 700));
        assert!(!detector.event(0xa0, true, 710));
        assert!(!detector.event(0xa0, false, 1300));
        assert!(!detector.event(0xa2, false, 1310));
        assert!(!tap(&mut detector, 1400));
    }

    #[test]
    fn typing_or_other_modifiers_cancel_the_sequence() {
        for key in [0x41, 0xa4, 0x5b] {
            let mut detector = DoubleTapDetector::new([false; 256]);
            assert!(!tap(&mut detector, 0));
            assert!(!detector.event(key, true, 80));
            assert!(!detector.event(key, false, 90));
            assert!(!tap(&mut detector, 150));
            assert!(!detector.event(0xa2, true, 220));
            assert!(!detector.event(0xa0, true, 230));
            assert!(!detector.event(key, true, 240));
            assert!(!detector.event(key, false, 250));
            assert!(!detector.event(0xa2, false, 260));
            assert!(!detector.event(0xa0, false, 270));
            assert!(!tap(&mut detector, 300));
        }
    }

    #[test]
    fn repeats_and_partial_releases_are_not_extra_taps() {
        let mut detector = DoubleTapDetector::new([false; 256]);
        assert!(!detector.event(0xa2, true, 0));
        assert!(!detector.event(0xa0, true, 10));
        assert!(!detector.event(0xa0, true, 20));
        assert!(!detector.event(0xa0, false, 30));
        assert!(!detector.event(0xa0, true, 40));
        assert!(!detector.event(0xa0, false, 50));
        assert!(!detector.event(0xa2, false, 60));
        assert!(tap(&mut detector, 100));
    }

    #[test]
    fn keys_held_when_enabled_must_be_released_before_the_first_tap() {
        let mut down = [false; 256];
        down[0xa2] = true;
        let mut detector = DoubleTapDetector::new(down);
        assert!(!detector.event(0xa0, true, 0));
        assert!(!detector.event(0xa0, false, 10));
        assert!(!detector.event(0xa2, false, 20));
        assert!(!tap(&mut detector, 100));
        assert!(tap(&mut detector, 250));
    }
}
