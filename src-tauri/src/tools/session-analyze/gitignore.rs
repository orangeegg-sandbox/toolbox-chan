//! Bounded, opt-in .gitignore loading. Matching grammar belongs to the ignore crate.
use std::{fs, io::Read, path::Path, sync::Arc, time::{Duration, Instant}};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use super::coverage::is_link;

pub(super) const MAX_RULE_FILES: usize = 1_024;
pub(super) const MAX_RULE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_RULE_LINES: usize = 50_000;
const MAX_LINE_BYTES: usize = 8 * 1024;
const MAX_REPOSITORY_ANCESTORS: usize = 64;

pub(super) type Scope = Option<Arc<Rules>>;
pub(super) struct Rules { parent: Scope, matcher: Gitignore }

pub(super) fn ignored(scope: &Scope, path: &Path, is_directory: bool) -> bool {
    let mut current = scope.as_deref();
    while let Some(rules) = current {
        let result = rules.matcher.matched(path, is_directory);
        if !result.is_none() { return result.is_ignore(); }
        current = rules.parent.as_deref();
    }
    false
}

#[derive(Default)]
pub(super) struct RuleReader {
    files: usize,
    bytes: usize,
    lines: usize,
    errors: usize,
    invalid: usize,
    links: usize,
    limited: bool,
    inheritance_incomplete: bool,
}

impl RuleReader {
    pub(super) fn complete(&self) -> bool { self.errors == 0 && self.invalid == 0 && self.links == 0 && !self.limited && !self.inheritance_incomplete }

    pub(super) fn warnings(&self) -> Vec<String> {
        let mut warnings = Vec::new();
        if self.errors > 0 { warnings.push(format!("Could not read or compile {} .gitignore files; ignore filtering is partial.", self.errors)); }
        if self.invalid > 0 { warnings.push(format!("Skipped {} invalid .gitignore rules; ignore filtering is partial.", self.invalid)); }
        if self.links > 0 { warnings.push(format!("Skipped {} linked or reparse-point .gitignore files without reading them; ignore filtering is partial.", self.links)); }
        if self.limited { warnings.push(".gitignore loading reached a safety limit (1,024 files, 4 MiB total, 256 KiB per file, 50,000 lines, 8 KiB per line, or scan time); ignore filtering is partial.".into()); }
        if self.inheritance_incomplete { warnings.push("Repository ignore inheritance was incomplete: a directory or .git marker was unavailable or linked, or discovery reached 64 ancestors or the scan time limit. Parent rules may be missing.".into()); }
        warnings
    }

    /// A worktree's regular .git file establishes a boundary without reading its contents.
    /// Linked or inaccessible markers stop discovery instead of exposing an outer repository.
    fn repository_boundary(&mut self, directory: &Path) -> Option<bool> {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {}
            _ => { self.inheritance_incomplete = true; return None; }
        }
        match fs::symlink_metadata(directory.join(".git")) {
            Ok(metadata) if !is_link(&metadata) && (metadata.is_dir() || metadata.is_file()) => Some(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(false),
            _ => { self.inheritance_incomplete = true; None }
        }
    }

    /// Load only rules between the nearest enclosing repository and the selected
    /// project's parent. The normal walk loads the project root's rules once.
    pub(super) fn inherited(&mut self, project: &Path, start: Instant) -> (Scope, bool) {
        let mut parents = Vec::new();
        for (depth, directory) in project.ancestors().enumerate() {
            if depth >= MAX_REPOSITORY_ANCESTORS || start.elapsed() >= Duration::from_secs(10) {
                self.inheritance_incomplete = true;
                return (None, false);
            }
            match fs::symlink_metadata(directory) {
                Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {}
                _ => { self.inheritance_incomplete = true; return (None, false); }
            }
            if depth > 0 { parents.push(directory); }
            match self.repository_boundary(directory) {
                Some(true) => {
                    let mut scope = None;
                    for parent in parents.into_iter().rev() {
                        // Descendant rules cannot re-include an ignored parent directory.
                        if ignored(&scope, parent, true) { return (scope, true); }
                        scope = self.load(parent, scope, start);
                    }
                    let project_ignored = ignored(&scope, project, true);
                    return (scope, project_ignored);
                }
                Some(false) => {}
                None => return (None, false),
            }
        }
        // Without a repository boundary, preserve root/nested-only behavior.
        (None, false)
    }

    pub(super) fn load_directory(&mut self, directory: &Path, parent: Scope, start: Instant) -> Scope {
        let parent = match self.repository_boundary(directory) {
            Some(false) => parent,
            Some(true) | None => None,
        };
        self.load(directory, parent, start)
    }

    pub(super) fn load(&mut self, directory: &Path, parent: Scope, start: Instant) -> Scope {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {}
            _ => { self.inheritance_incomplete = true; return parent; }
        }
        let path = directory.join(".gitignore");
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return parent,
            Err(_) => { self.errors += 1; return parent; }
        };
        if self.files >= MAX_RULE_FILES || self.bytes >= MAX_RULE_BYTES || self.lines >= MAX_RULE_LINES || start.elapsed() >= Duration::from_secs(10) {
            self.limited = true;
            return parent;
        }
        self.files += 1;
        if is_link(&metadata) { self.links += 1; return parent; }
        if !metadata.is_file() { self.errors += 1; return parent; }
        let allowance = MAX_FILE_BYTES.min(MAX_RULE_BYTES - self.bytes);
        if metadata.len() > allowance as u64 { self.limited = true; return parent; }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Open a replacement reparse point itself, never its destination.
            options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
        }
        let file = match options.open(&path) { Ok(file) => file, Err(_) => { self.errors += 1; return parent; } };
        let opened = match file.metadata() { Ok(metadata) => metadata, Err(_) => { self.errors += 1; return parent; } };
        if is_link(&opened) { self.links += 1; return parent; }
        if !opened.is_file() { self.errors += 1; return parent; }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            // A changed path must not make us read a newly substituted target.
            if metadata.dev() != opened.dev() || metadata.ino() != opened.ino() { self.errors += 1; return parent; }
        }
        let mut bytes = Vec::new();
        if file.take(allowance as u64 + 1).read_to_end(&mut bytes).is_err() { self.bytes += bytes.len(); self.errors += 1; return parent; }
        self.bytes += bytes.len();
        if bytes.len() > allowance { self.limited = true; return parent; }
        let contents = match std::str::from_utf8(&bytes) { Ok(contents) => contents, Err(_) => { self.errors += 1; return parent; } };
        let mut builder = GitignoreBuilder::new(directory);
        for (index, line) in contents.lines().enumerate() {
            if self.lines >= MAX_RULE_LINES || start.elapsed() >= Duration::from_secs(10) { self.limited = true; break; }
            self.lines += 1;
            if line.len() > MAX_LINE_BYTES { self.limited = true; continue; }
            let line = if index == 0 { line.trim_start_matches('\u{feff}') } else { line };
            if builder.add_line(Some(path.clone()), line).is_err() { self.invalid += 1; }
        }
        match builder.build() {
            Ok(matcher) => Some(Arc::new(Rules { parent, matcher })),
            Err(_) => { self.errors += 1; parent }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, sync::atomic::{AtomicUsize, Ordering}};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(contents: &str) -> Self {
            let path = std::env::temp_dir().join(format!("session-ignore-rules-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join(".gitignore"), contents).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn aggregate_rule_file_and_byte_limits_stop_reading_further_rules() {
        let fixture = Fixture::new("a\n");
        let mut files = RuleReader { files: MAX_RULE_FILES - 1, ..RuleReader::default() };
        let scope = files.load(&fixture.0, None, Instant::now());
        assert!(ignored(&scope, &fixture.0.join("a"), false));
        assert!(files.complete());
        assert!(files.load(&fixture.0, None, Instant::now()).is_none());
        assert!(!files.complete());
        assert_eq!(files.files, MAX_RULE_FILES);

        let mut bytes = RuleReader { bytes: MAX_RULE_BYTES - 3, ..RuleReader::default() };
        let scope = bytes.load(&fixture.0, None, Instant::now());
        assert!(ignored(&scope, &fixture.0.join("a"), false));
        assert!(bytes.complete());
        assert!(bytes.load(&fixture.0, None, Instant::now()).is_none());
        assert!(!bytes.complete());
        assert_eq!(bytes.bytes, MAX_RULE_BYTES - 1);
    }

    #[test]
    fn line_and_time_limits_preserve_partial_rules_and_disclose_omissions() {
        let fixture = Fixture::new("a\nb\n");
        let mut lines = RuleReader { lines: MAX_RULE_LINES - 1, ..RuleReader::default() };
        let scope = lines.load(&fixture.0, None, Instant::now());
        assert!(ignored(&scope, &fixture.0.join("a"), false));
        assert!(!ignored(&scope, &fixture.0.join("b"), false));
        assert!(!lines.complete());
        let mut timed = RuleReader::default();
        assert!(timed.load(&fixture.0, None, Instant::now() - Duration::from_secs(11)).is_none());
        assert!(!timed.complete());
        assert!(timed.warnings()[0].contains("safety limit"));
    }
}
