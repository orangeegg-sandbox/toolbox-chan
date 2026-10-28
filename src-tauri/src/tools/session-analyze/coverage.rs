use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use super::model::{FileActivity, ProjectCoverage, ProjectEntry, UnmappedFileActivity};
use super::gitignore::{self, RuleReader, Scope};

const MAX_ENTRIES: usize = 100_000;
const MAX_DEPTH: usize = 40;
const MAX_PATH_BYTES: usize = 32 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 48 * 1024 * 1024;
const MAX_CACHE_FILES: usize = 128;
const MAX_CACHE_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const INVENTORY_VERSION: u32 = 3;
static CACHE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_CACHE_FILE: AtomicU64 = AtomicU64::new(0);
const EXCLUDED: &[&str] = &[".git", "node_modules", "vendor", "target", "dist", "build", ".tools", ".claude"];
const LIMIT_WARNING: &str = "Inventory stopped at its scan limit (100,000 directory entries, 32 MiB of path names, or 10 seconds). Coverage uses only the collected subset.";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Inventory {
    version: u32,
    project: String,
    include_dependencies: bool,
    respect_gitignore: bool,
    ignored_entries: usize,
    scanned_at: u64,
    entries: Vec<ProjectEntry>,
    complete: bool,
    warnings: Vec<String>,
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn project_key(root: &Path) -> String { key(&root.to_string_lossy().replace('\\', "/")) }

pub(super) fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions and other reparse points must not bypass the symlink exclusion.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn project_root(project: &str) -> Result<PathBuf, String> {
    if project.len() > 32_768 || project.contains('\0') || project.starts_with("\\\\") || project.starts_with("//") {
        return Err("Choose an absolute local project directory; network and device paths are not supported.".into());
    }
    let path = Path::new(project);
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("Project coverage requires an absolute local directory without '..' components.".into());
    }
    if !path.components().any(|part| matches!(part, Component::Normal(_))) {
        return Err("Choose a project directory, not a filesystem root.".into());
    }
    let mut checked = PathBuf::new();
    for part in path.components() {
        checked.push(part.as_os_str());
        if matches!(part, Component::Normal(_)) {
            let metadata = fs::symlink_metadata(&checked)
                .map_err(|error| format!("Cannot access project directory {}: {error}", checked.display()))?;
            if is_link(&metadata) {
                return Err("Project coverage does not follow symlinks or directory reparse points. Choose the real local directory.".into());
            }
            if !metadata.is_dir() {
                return Err(format!("{} is not a directory.", checked.display()));
            }
        }
    }
    Ok(checked)
}

fn key(path: &str) -> String {
    if cfg!(windows) { path.to_lowercase() } else { path.to_owned() }
}

fn lexical_path(path: &Path) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => { if !result.pop() { return None; } }
            _ => result.push(part.as_os_str()),
        }
    }
    Some(result)
}

enum RecordedPath {
    Inside(String),
    Outside,
    Unresolved,
}

/// Resolve only lexical path components. Never stat or open a path from the report.
fn recorded_path(root: &Path, file: &FileActivity) -> RecordedPath {
    let path = &file.path;
    if path.is_empty() || path.len() > 32_768 || path.contains('\0') || path.contains("://") {
        return RecordedPath::Unresolved;
    }
    if file.evidence == "inferred" && path.chars().any(|ch| matches!(ch, '*' | '?' | '[' | ']' | '$' | '%' | '~')) {
        return RecordedPath::Unresolved;
    }
    let portable = path.replace('\\', "/");
    if portable.starts_with("//") {
        return RecordedPath::Outside;
    }
    let bytes = portable.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        if bytes.get(2) != Some(&b'/') {
            return RecordedPath::Unresolved; // Drive-relative paths depend on another working directory.
        }
        if !cfg!(windows) {
            return RecordedPath::Outside;
        }
    }
    let candidate = Path::new(&portable);
    let Some(absolute) = lexical_path(&root.join(candidate)) else { return RecordedPath::Outside; };
    if !absolute.is_absolute() {
        return RecordedPath::Unresolved;
    }
    let root_parts: Vec<_> = root.components().map(|part| key(&part.as_os_str().to_string_lossy())).collect();
    let parts: Vec<_> = absolute.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
    if parts.len() < root_parts.len() || root_parts.iter().zip(&parts).any(|(left, right)| left != &key(right)) {
        return RecordedPath::Outside;
    }
    let relative = parts[root_parts.len()..].join("/");
    if relative.is_empty() { RecordedPath::Unresolved } else { RecordedPath::Inside(key(&relative)) }
}

fn inventory(root: &Path, include_dependencies: bool, respect_gitignore: bool) -> Result<Inventory, String> {
    let mut names: BTreeMap<String, ProjectEntry> = BTreeMap::new();
    let start = Instant::now();
    let mut rules = RuleReader::default();
    let (inherited, project_ignored) = if respect_gitignore { rules.inherited(root, start) } else { (None, false) };
    let mut pending: Vec<(String, usize, Scope)> = if project_ignored { Vec::new() } else { vec![(String::new(), 0, inherited)] };
    let mut ignored_entries = usize::from(project_ignored);
    let mut warnings = Vec::new();
    if project_ignored { warnings.push("The selected project directory is ignored by inherited repository rules; its contents were not enumerated.".into()); }
    let mut complete = true;
    let mut visited = 0;
    let mut path_bytes = 0;
    let mut inaccessible = 0;
    let mut links = 0;
    let mut deep = 0;
    let mut unsupported = 0;
    'walk: while let Some((directory_name, depth, inherited_rules)) = pending.pop() {
        let directory = root.join(&directory_name);
        if visited >= MAX_ENTRIES || start.elapsed() >= Duration::from_secs(10) {
            warnings.push(LIMIT_WARNING.into());
            complete = false;
            break;
        }
        // Recheck queued directories because the project may change during the scan.
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if is_link(&metadata) => { links += 1; complete = false; continue; }
            Ok(metadata) if metadata.is_dir() => {}
            _ => { inaccessible += 1; complete = false; continue; }
        }
        let scope = if respect_gitignore { rules.load_directory(&directory, inherited_rules, start) } else { inherited_rules };
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if depth == 0 => return Err(format!("Cannot list project directory: {error}")),
            Err(_) => { inaccessible += 1; complete = false; continue; }
        };
        let mut directory_complete = true;
        let mut children = Vec::new();
        for entry in entries {
            if visited >= MAX_ENTRIES || path_bytes >= MAX_PATH_BYTES || start.elapsed() >= Duration::from_secs(10) {
                warnings.push(LIMIT_WARNING.into());
                complete = false;
                break 'walk;
            }
            visited += 1;
            let entry = match entry { Ok(entry) => entry, Err(_) => { inaccessible += 1; complete = false; directory_complete = false; continue; } };
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| "Inventory encountered an invalid relative path.".to_owned())?;
            // Include directories in this budget, so the pending walk stack is bounded too.
            let bytes = relative.as_os_str().to_string_lossy().len();
            if path_bytes + bytes > MAX_PATH_BYTES {
                warnings.push(LIMIT_WARNING.into());
                complete = false;
                break 'walk;
            }
            path_bytes += bytes;
            let Some(relative) = relative.to_str() else { unsupported += 1; complete = false; directory_complete = false; continue; };
            let name = if cfg!(windows) { relative.replace('\\', "/") } else { relative.to_owned() };
            if !valid_relative(&name) { unsupported += 1; complete = false; directory_complete = false; continue; }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    inaccessible += 1;
                    complete = false;
                    let kind = if entry.file_type().is_ok_and(|kind| kind.is_file()) { "file" } else { "directory" };
                    names.insert(key(&name), ProjectEntry { path: name, kind: kind.into(), excluded: true });
                    continue;
                }
            };
            if respect_gitignore && gitignore::ignored(&scope, &path, metadata.is_dir()) {
                ignored_entries += 1;
                continue;
            }
            if is_link(&metadata) {
                links += 1;
                complete = false;
                names.insert(key(&name), ProjectEntry { path: name, kind: if metadata.is_dir() { "directory" } else { "file" }.into(), excluded: true });
                continue;
            }
            if metadata.is_dir() {
                // A queued directory stays visibly excluded until its listing has completed.
                names.insert(key(&name), ProjectEntry { path: name.clone(), kind: "directory".into(), excluded: true });
                let filename = entry.file_name();
                if filename.to_string_lossy().eq_ignore_ascii_case(".git") || (!include_dependencies && EXCLUDED.iter().any(|excluded| filename.to_string_lossy().eq_ignore_ascii_case(excluded))) {
                    continue;
                }
                if depth >= MAX_DEPTH {
                    deep += 1;
                    complete = false;
                } else {
                    children.push((name, depth + 1, scope.clone()));
                }
            } else if metadata.is_file() {
                names.insert(key(&name), ProjectEntry { path: name, kind: "file".into(), excluded: false });
            } else {
                unsupported += 1;
                complete = false;
                names.insert(key(&name), ProjectEntry { path: name, kind: "file".into(), excluded: true });
            }
        }
        // LIFO traversal in ascending path order reaches source folders before
        // later build/cache folders without changing any scope or scan budget.
        children.sort_by_cached_key(|(name, _, _)| std::cmp::Reverse(key(name)));
        pending.extend(children);
        if let Some(directory) = names.get_mut(&key(&directory_name)) { directory.excluded = !directory_complete; }
    }
    if inaccessible > 0 { warnings.push(format!("Skipped {inaccessible} inaccessible or changed filesystem entries; inventory may be incomplete.")); }
    if links > 0 { warnings.push(format!("Skipped {links} symlinks or reparse points; linked files are excluded from coverage.")); }
    if deep > 0 { warnings.push(format!("Skipped {deep} directories below depth {MAX_DEPTH}; inventory is incomplete.")); }
    if unsupported > 0 { warnings.push(format!("Skipped {unsupported} paths that cannot be represented as UTF-8.")); }
    complete &= rules.complete();
    warnings.extend(rules.warnings());
    Ok(Inventory { version: INVENTORY_VERSION, project: project_key(root), include_dependencies, respect_gitignore, ignored_entries, scanned_at: now_millis(), entries: names.into_values().collect(), complete, warnings })
}

fn overlay(root: &Path, files: &[FileActivity], snapshot: Inventory, cached: bool, mut warnings: Vec<String>) -> ProjectCoverage {
    warnings.extend(snapshot.warnings.iter().cloned());
    let names: BTreeMap<_, _> = snapshot.entries.iter().filter(|entry| entry.kind == "file" && !entry.excluded).map(|entry| (key(&entry.path), entry.path.clone())).collect();
    let mut read = BTreeSet::new();
    let mut written = BTreeSet::new();
    let mut outside = BTreeSet::new();
    let mut missing = BTreeSet::new();
    let mut unresolved = 0;
    let mut unmatched_files = Vec::new();
    for file in files {
        if file.operation != "read" && file.operation != "write" { continue; }
        let reason = match recorded_path(root, file) {
            RecordedPath::Inside(path) if names.contains_key(&path) => {
                if file.operation == "read" { read.insert(path); } else { written.insert(path); }
                None
            }
            RecordedPath::Inside(path) => { missing.insert(path); Some("not-in-snapshot") }
            RecordedPath::Outside => { outside.insert(file.path.clone()); Some("outside-project") }
            RecordedPath::Unresolved => { unresolved += 1; Some("unresolved") }
        };
        if let Some(reason) = reason {
            unmatched_files.push(UnmappedFileActivity { path: file.path.clone(), operation: file.operation.clone(), event_id: file.event_id.clone(), evidence: file.evidence.clone(), reason: reason.into() });
        }
    }
    if unresolved > 0 { warnings.push(format!("Ignored {unresolved} unresolved read/write paths, including inferred globs or variables; no expansion was attempted.")); }
    if !missing.is_empty() { warnings.push(format!("{} distinct recorded paths are missing from this inventory (deleted, excluded, inaccessible, directories, or beyond scan limits).", missing.len())); }
    warnings.push("Coverage reflects recorded file operations, not proof of successful access or inclusion in the model's context. The saved filesystem snapshot is not historical or atomic; rescan to refresh it.".into());
    ProjectCoverage {
        project: root.to_string_lossy().into_owned(),
        total_files: names.len(),
        read_files: read.iter().filter_map(|path| names.get(path).cloned()).collect(),
        written_files: written.iter().filter_map(|path| names.get(path).cloned()).collect(),
        untouched_files: names.iter().filter(|(path, _)| !read.contains(*path) && !written.contains(*path)).map(|(_, name)| name.clone()).collect(),
        outside_project: outside.into_iter().collect(),
        unmatched_files,
        entries: snapshot.entries,
        scanned_at: snapshot.scanned_at,
        cached,
        include_dependencies: snapshot.include_dependencies,
        respect_gitignore: snapshot.respect_gitignore,
        ignored_entries: snapshot.ignored_entries,
        complete: snapshot.complete,
        basis: format!("Saved regular-file and directory name inventory. {} {} Symlinks and reparse points are never followed. Only concrete recorded read/write paths matching included files count; list/search operations do not. Unmatched read/write evidence is listed separately and never added to the inventory or coverage counts. Other excluded directories are shown but unscanned. Complete means the selected scope was fully listed within safety limits.", if snapshot.include_dependencies { "Includes dependency/build contents; .git stays excluded." } else { "Excludes contents of .git, node_modules, vendor, target, dist, build, .tools, and .claude." }, if snapshot.respect_gitignore { "Reads only bounded .gitignore rule files from the nearest enclosing repository through the project and its descendants, no other project file contents. Without a repository, only project-root and nested rules apply. Nested repositories start a new rule scope; global and .git/info/exclude rules are not used. Ignored entries are omitted; the count includes only encountered ignored files/directories, not unenumerated descendants of ignored directories. Rules remain frozen in this snapshot until rescan." } else { "No project file contents are read. Does not apply .gitignore." }),
        warnings,
    }
}

fn valid_relative(path: &str) -> bool {
    !path.is_empty() && path.len() <= 32_768 && !path.contains(['\\', '\0', ':'])
        && !path.starts_with('/') && !path.ends_with('/')
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
        && path.split('/').count() <= MAX_DEPTH + 1
}

fn excluded_name(name: &str, include_dependencies: bool) -> bool {
    name.eq_ignore_ascii_case(".git") || (!include_dependencies && EXCLUDED.iter().any(|excluded| name.eq_ignore_ascii_case(excluded)))
}

fn validate_inventory(snapshot: &Inventory, root: &Path, include_dependencies: bool, respect_gitignore: bool) -> Result<(), String> {
    if snapshot.version != INVENTORY_VERSION || snapshot.project != project_key(root) || snapshot.include_dependencies != include_dependencies || snapshot.respect_gitignore != respect_gitignore {
        return Err("The saved inventory does not match this project and scan scope.".into());
    }
    if snapshot.entries.len().saturating_add(snapshot.ignored_entries) > MAX_ENTRIES || (!respect_gitignore && snapshot.ignored_entries != 0) || snapshot.scanned_at == 0 || snapshot.scanned_at > now_millis().saturating_add(300_000)
        || snapshot.warnings.len() > 64 || snapshot.warnings.iter().any(|warning| warning.len() > 4096) {
        return Err("The saved inventory exceeds its metadata limits.".into());
    }
    let mut names = BTreeMap::new();
    let mut bytes = 0;
    for entry in &snapshot.entries {
        bytes += entry.path.len();
        if bytes > MAX_PATH_BYTES || !valid_relative(&entry.path) || !matches!(entry.kind.as_str(), "file" | "directory")
            || names.insert(key(&entry.path), entry).is_some() {
            return Err("The saved inventory contains invalid, duplicate, or oversized paths.".into());
        }
        if snapshot.complete && entry.excluded && (entry.kind != "directory" || !excluded_name(entry.path.rsplit('/').next().unwrap_or(""), include_dependencies)) {
            return Err("The saved inventory claims completeness despite an unscanned entry.".into());
        }
    }
    for entry in &snapshot.entries {
        let mut parent = entry.path.as_str();
        while let Some((ancestor, leaf)) = parent.rsplit_once('/') {
            if excluded_name(ancestor.rsplit('/').next().unwrap_or(""), include_dependencies) {
                return Err("The saved inventory contains children beneath an excluded directory.".into());
            }
            if leaf.is_empty() || names.get(&key(ancestor)).is_none_or(|entry| entry.kind != "directory") {
                return Err("The saved inventory omits a directory parent.".into());
            }
            parent = ancestor;
        }
        if entry.kind == "directory" && excluded_name(entry.path.rsplit('/').next().unwrap_or(""), include_dependencies) && !entry.excluded {
            return Err("The saved inventory includes a directory excluded by the selected scope.".into());
        }
    }
    Ok(())
}

fn cache_path(folder: &Path, root: &Path, include_dependencies: bool, respect_gitignore: bool) -> PathBuf {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    project_key(root).hash(&mut hash);
    include_dependencies.hash(&mut hash);
    respect_gitignore.hash(&mut hash);
    INVENTORY_VERSION.hash(&mut hash);
    folder.join(format!("{:016x}.json", hash.finish()))
}

fn prepare_cache_folder(folder: &Path) -> Result<(), String> {
    let portable = folder.to_string_lossy();
    if !folder.is_absolute() || portable.starts_with("\\\\") || portable.starts_with("//") { return Err("The project cache must use an absolute local directory.".into()); }
    let mut checked = PathBuf::new();
    for part in folder.components() {
        if matches!(part, Component::ParentDir) { return Err("The project cache path cannot contain '..'.".into()); }
        checked.push(part.as_os_str());
        if !matches!(part, Component::Normal(_)) { continue; }
        match fs::create_dir(&checked) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("Cannot create project cache: {error}")),
        }
        let metadata = fs::symlink_metadata(&checked).map_err(|error| error.to_string())?;
        if is_link(&metadata) || !metadata.is_dir() { return Err("Project cache folders must be real directories, not links or reparse points.".into()); }
    }
    Ok(())
}

fn read_cache(path: &Path, root: &Path, include_dependencies: bool, respect_gitignore: bool) -> Result<Option<Inventory>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot inspect the saved inventory: {error}")),
    };
    if is_link(&metadata) || !metadata.is_file() { return Err("The saved inventory is not a regular file.".into()); }
    if metadata.len() > MAX_CACHE_BYTES { return Err("The saved inventory exceeds 48 MiB.".into()); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|error| error.to_string())?.take(MAX_CACHE_BYTES + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_CACHE_BYTES { return Err("The saved inventory exceeds 48 MiB.".into()); }
    let snapshot: Inventory = serde_json::from_slice(&bytes).map_err(|error| format!("The saved inventory is invalid JSON: {error}"))?;
    validate_inventory(&snapshot, root, include_dependencies, respect_gitignore)?;
    Ok(Some(snapshot))
}

fn cache_capacity(folder: &Path, replacing: &Path, new_bytes: u64) -> Result<(), String> {
    let mut count = 1;
    let mut bytes = new_bytes;
    for (index, entry) in fs::read_dir(folder).map_err(|error| error.to_string())?.enumerate() {
        if index >= 512 { return Err("Project cache contains too many entries; the fresh inventory was not saved.".into()); }
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path() == replacing { continue; }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let Some(stem) = name.strip_suffix(".json") else { continue; };
        if stem.len() != 16 || !stem.bytes().all(|byte| byte.is_ascii_hexdigit()) { continue; }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if is_link(&metadata) || !metadata.is_file() { continue; }
        count += 1;
        bytes = bytes.saturating_add(metadata.len());
        if count > MAX_CACHE_FILES || bytes > MAX_CACHE_TOTAL_BYTES {
            return Err("Project cache reached its 128-snapshot or 256 MiB limit; the fresh inventory was not saved.".into());
        }
    }
    Ok(())
}

fn write_cache(path: &Path, snapshot: &Inventory) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_CACHE_BYTES { return Err("The inventory is too large to cache (48 MiB maximum).".into()); }
    if fs::symlink_metadata(path).is_ok_and(|metadata| is_link(&metadata) || !metadata.is_file()) {
        return Err("The cache destination is not a regular file; it was left unchanged.".into());
    }
    let folder = path.parent().ok_or("The cache destination has no parent.")?;
    cache_capacity(folder, path, bytes.len() as u64)?;
    let temporary = folder.join(format!(".inventory-{}-{}-{}.tmp", std::process::id(), now_millis(), NEXT_CACHE_FILE.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
        output.write_all(&bytes).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        drop(output);
        // Same-directory rename replaces atomically; never remove the old cache first.
        fs::rename(&temporary, path).map_err(|error| format!("Could not replace the saved inventory; the old cache was preserved: {error}"))
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

pub fn scan_cached(cache_folder: &Path, project: &str, files: &[FileActivity], rescan: bool, include_dependencies: bool, respect_gitignore: bool) -> Result<ProjectCoverage, String> {
    if files.len() > MAX_ENTRIES || files.iter().try_fold(0_usize, |total, file| total.checked_add(file.path.len())).is_none_or(|total| total > MAX_PATH_BYTES) {
        return Err("Coverage accepts at most 100,000 file activity records and 32 MiB of recorded paths.".into());
    }
    let root = project_root(project)?;
    let _guard = CACHE_LOCK.lock().map_err(|_| "Project inventory cache was interrupted.".to_owned())?;
    let mut warnings = Vec::new();
    let writable = match prepare_cache_folder(cache_folder) {
        Ok(()) => true,
        Err(error) => { warnings.push(format!("Inventory cache unavailable: {error}")); false }
    };
    let path = cache_path(cache_folder, &root, include_dependencies, respect_gitignore);
    if writable && !rescan {
        match read_cache(&path, &root, include_dependencies, respect_gitignore) {
            Ok(Some(snapshot)) => return Ok(overlay(&root, files, snapshot, true, warnings)),
            Ok(None) => {}
            Err(error) => warnings.push(format!("Saved inventory was not reused and will be rescanned: {error}")),
        }
    }
    let snapshot = inventory(&root, include_dependencies, respect_gitignore)?;
    validate_inventory(&snapshot, &root, include_dependencies, respect_gitignore)?;
    if writable {
        if let Err(error) = write_cache(&path, &snapshot) { warnings.push(format!("Fresh inventory is available, but could not be cached: {error}")); }
    }
    Ok(overlay(&root, files, snapshot, false, warnings))
}

#[cfg(test)]
fn scan(project: &str, files: &[FileActivity]) -> Result<ProjectCoverage, String> {
    let root = project_root(project)?;
    let snapshot = inventory(&root, false, false)?;
    Ok(overlay(&root, files, snapshot, false, Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("session-coverage-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self, path: &str) {
            let path = self.0.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "fixture").unwrap();
        }
        fn scan(&self, files: &[FileActivity]) -> ProjectCoverage { scan(self.0.to_str().unwrap(), files).unwrap() }
        fn cache(&self) -> PathBuf { self.0.with_extension("inventory-cache") }
        fn cached(&self, files: &[FileActivity], rescan: bool, include_dependencies: bool) -> ProjectCoverage {
            self.scoped(files, rescan, include_dependencies, false)
        }
        fn scoped(&self, files: &[FileActivity], rescan: bool, include_dependencies: bool, respect_gitignore: bool) -> ProjectCoverage {
            scan_cached(&self.cache(), self.0.to_str().unwrap(), files, rescan, include_dependencies, respect_gitignore).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); let _ = fs::remove_dir_all(self.cache()); }
    }
    fn activity(path: &str, operation: &str) -> FileActivity {
        FileActivity { path: path.into(), operation: operation.into(), event_id: "event-1".into(), evidence: "explicit".into() }
    }

    fn nested_scan(fixture: &Fixture, project: &str, files: &[FileActivity], rescan: bool, respect_gitignore: bool) -> ProjectCoverage {
        scan_cached(&fixture.cache(), fixture.0.join(project).to_str().unwrap(), files, rescan, true, respect_gitignore).unwrap()
    }

    #[test]
    fn counts_distinct_concrete_paths_and_keeps_searches_out_of_coverage() {
        let fixture = Fixture::new();
        for path in ["src/main.ts", "test/main.ts", "changed.ts", "listed.ts", "searched.ts"] { fixture.file(path); }
        let report = fixture.scan(&[
            activity("src/main.ts", "read"), activity("src\\main.ts", "read"),
            activity(fixture.0.join("test/main.ts").to_str().unwrap(), "read"),
            activity("changed.ts", "write"), activity("src/main.ts", "write"),
            activity("listed.ts", "list"), activity("searched.ts", "search"),
        ]);
        assert_eq!(report.total_files, 5);
        assert_eq!(report.read_files, ["src/main.ts", "test/main.ts"]);
        assert_eq!(report.written_files, ["changed.ts", "src/main.ts"]);
        assert_eq!(report.untouched_files, ["listed.ts", "searched.ts"]);
    }

    #[test]
    fn excludes_dependencies_and_does_not_claim_gitignore_is_applied() {
        let fixture = Fixture::new();
        fixture.file("source.ts");
        fixture.file(".gitignore");
        for excluded in EXCLUDED { fixture.file(&format!("{excluded}/hidden.ts")); }
        let report = fixture.scan(&[activity("node_modules/hidden.ts", "read")]);
        assert_eq!(report.total_files, 2);
        assert!(report.read_files.is_empty());
        assert!(report.basis.contains("Does not apply .gitignore"));
        assert!(report.warnings.iter().any(|warning| warning.contains("missing from this inventory")));
    }

    #[test]
    fn traversal_and_prefix_collisions_are_outside_without_reading_them() {
        let fixture = Fixture::new();
        fixture.file("src/main.ts");
        let similar = format!("{}-other/file.ts", fixture.0.display());
        let report = fixture.scan(&[
            activity("../outside.ts", "read"), activity(&similar, "write"),
            activity("src/../../outside.ts", "read"), activity("src/../src/main.ts", "read"),
            activity("\\\\server\\share\\file.ts", "read"),
        ]);
        assert_eq!(report.read_files, ["src/main.ts"]);
        assert_eq!(report.outside_project.len(), 4);
    }

    #[test]
    fn inferred_patterns_and_variables_never_count_as_reads() {
        let fixture = Fixture::new();
        fixture.file("src/main.ts");
        let files = ["src/*.ts", "$PROJECT/src/main.ts", "%PROJECT%/src/main.ts", "~/src/main.ts"].map(|path| {
            let mut file = activity(path, "read"); file.evidence = "inferred".into(); file
        });
        let report = fixture.scan(&files);
        assert!(report.read_files.is_empty());
        assert!(report.outside_project.is_empty());
        assert!(report.warnings.iter().any(|warning| warning.contains("Ignored 4 unresolved")));
    }

    #[test]
    fn unmatched_read_write_records_retain_evidence_without_expanding_the_snapshot() {
        let fixture = Fixture::new();
        fixture.file("source.ts");
        let mut inferred = activity("$ROOT/source.ts", "read");
        inferred.evidence = "inferred".into();
        inferred.event_id = "event-7".into();
        let mut repeated = activity("missing.ts", "read");
        repeated.event_id = "event-9".into();
        let files = [activity("source.ts", "read"), activity("missing.ts", "read"),
            activity("../outside.ts", "write"), inferred, repeated, activity("unknown/", "list"), activity("*.ts", "search")];
        let evidence = serde_json::to_value(&files).unwrap();
        let report = fixture.scan(&files);
        assert_eq!(report.total_files, 1);
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.read_files, ["source.ts"]);
        assert_eq!(report.unmatched_files.len(), 4);
        assert_eq!(report.unmatched_files.iter().map(|file| file.reason.as_str()).collect::<Vec<_>>(),
            ["not-in-snapshot", "outside-project", "unresolved", "not-in-snapshot"]);
        assert_eq!(report.unmatched_files[2].path, "$ROOT/source.ts");
        assert_eq!(report.unmatched_files[2].evidence, "inferred");
        assert_eq!(report.unmatched_files[2].event_id, "event-7");
        assert_eq!(report.unmatched_files[3].event_id, "event-9");
        assert_eq!(serde_json::to_value(&files).unwrap(), evidence);
    }

    #[test]
    fn rejects_relative_network_root_and_file_targets() {
        let fixture = Fixture::new();
        fixture.file("file.ts");
        assert!(scan("relative/project", &[]).is_err());
        assert!(scan("\\\\server\\share", &[]).is_err());
        assert!(scan("//server/share", &[]).is_err());
        assert!(scan(fixture.0.join("file.ts").to_str().unwrap(), &[]).is_err());
        assert!(scan(fixture.0.join("..").to_str().unwrap(), &[]).is_err());
        let filesystem_root: PathBuf = fixture.0.components().take_while(|part| !matches!(part, Component::Normal(_))).collect();
        assert!(scan(filesystem_root.to_str().unwrap(), &[]).is_err());
    }

    #[test]
    fn stops_below_depth_limit_and_reports_omission() {
        let fixture = Fixture::new();
        fixture.file("top.ts");
        fixture.file(&format!("{}deep.ts", "d/".repeat(MAX_DEPTH + 1)));
        let report = fixture.scan(&[]);
        assert_eq!(report.total_files, 1);
        assert!(report.warnings.iter().any(|warning| warning.contains("below depth 40")));
    }

    #[test]
    fn never_follows_directory_links() {
        let fixture = Fixture::new();
        let external = Fixture::new();
        external.file("external.ts");
        let link = fixture.0.join("linked");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&external.0, &link).unwrap();
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_dir(&external.0, &link) {
            if error.raw_os_error() == Some(1314) { return; } // Windows may require Developer Mode for symlink creation.
            panic!("Could not create symlink fixture: {error}");
        }
        let report = fixture.scan(&[activity("linked/external.ts", "read")]);
        assert_eq!(report.total_files, 0);
        assert!(report.read_files.is_empty());
        assert!(report.warnings.iter().any(|warning| warning.contains("symlinks or reparse points")));
        assert!(scan(link.to_str().unwrap(), &[]).is_err());
    }

    #[test]
    fn hierarchy_includes_empty_untouched_and_visibly_excluded_directories() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.0.join("empty/nested")).unwrap();
        fixture.file("src/untouched.ts");
        fixture.file("node_modules/package/index.js");
        fixture.file(".git/config");
        let report = fixture.cached(&[], false, false);
        for path in ["empty", "empty/nested", "src"] {
            assert!(report.entries.iter().any(|entry| entry.path == path && entry.kind == "directory" && !entry.excluded));
        }
        for path in ["node_modules", ".git"] {
            assert!(report.entries.iter().any(|entry| entry.path == path && entry.kind == "directory" && entry.excluded));
        }
        assert!(report.entries.iter().any(|entry| entry.path == "src/untouched.ts" && entry.kind == "file"));
        assert!(!report.entries.iter().any(|entry| entry.path.is_empty() || entry.path.contains('\\')));
        assert_eq!(report.untouched_files, ["src/untouched.ts"]);
        assert_eq!(report.total_files, 1);
        assert!(report.complete);
    }

    #[test]
    fn cache_reuses_inventory_until_rescan_and_always_refreshes_session_overlay() {
        let fixture = Fixture::new();
        fixture.file("first.ts");
        let first = fixture.cached(&[activity("first.ts", "read")], false, false);
        assert!(!first.cached);
        assert_eq!(first.read_files, ["first.ts"]);
        fixture.file("second.ts");
        let second = fixture.cached(&[activity("first.ts", "write")], false, false);
        assert!(second.cached);
        assert_eq!(second.scanned_at, first.scanned_at);
        assert_eq!(second.total_files, 1);
        assert!(second.read_files.is_empty());
        assert_eq!(second.written_files, ["first.ts"]);
        let fresh = fixture.cached(&[activity("second.ts", "read")], true, false);
        assert!(!fresh.cached);
        assert_eq!(fresh.total_files, 2);
        assert_eq!(fresh.read_files, ["second.ts"]);
        let reused = fixture.cached(&[], false, false);
        assert!(reused.cached);
        assert_eq!(reused.scanned_at, fresh.scanned_at);
        assert!(reused.read_files.is_empty());
        assert_eq!(reused.untouched_files, ["first.ts", "second.ts"]);
    }

    #[test]
    fn dependency_scope_has_its_own_cache_and_git_is_always_excluded() {
        let fixture = Fixture::new();
        for path in ["source.ts", "node_modules/package/index.js", "build/output.js", ".git/config"] { fixture.file(path); }
        let normal = fixture.cached(&[], false, false);
        let expanded = fixture.cached(&[activity("node_modules/package/index.js", "read")], false, true);
        assert_eq!(normal.total_files, 1);
        assert!(!expanded.cached);
        assert!(expanded.include_dependencies);
        assert_eq!(expanded.total_files, 3);
        assert_eq!(expanded.read_files, ["node_modules/package/index.js"]);
        assert!(expanded.entries.iter().any(|entry| entry.path == "node_modules/package" && !entry.excluded));
        assert!(expanded.entries.iter().any(|entry| entry.path == ".git" && entry.excluded));
        assert!(!expanded.entries.iter().any(|entry| entry.path == ".git/config"));
        let normal_again = fixture.cached(&[], false, false);
        assert!(normal_again.cached);
        assert_eq!(normal_again.total_files, 1);
    }

    #[test]
    fn corrupt_and_oversized_caches_are_repaired_without_trusting_their_paths() {
        let fixture = Fixture::new();
        fixture.file("safe.ts");
        fixture.cached(&[], false, false);
        let path = cache_path(&fixture.cache(), &fixture.0, false, false);
        fs::write(&path, b"invalid json").unwrap();
        let repaired = fixture.cached(&[], false, false);
        assert!(!repaired.cached);
        assert_eq!(repaired.total_files, 1);
        assert!(repaired.warnings.iter().any(|warning| warning.contains("will be rescanned")));
        let mut malicious = read_cache(&path, &fixture.0, false, false).unwrap().unwrap();
        malicious.entries[0].path = "../outside.ts".into();
        fs::write(&path, serde_json::to_vec(&malicious).unwrap()).unwrap();
        assert!(!fixture.cached(&[], false, false).cached);
        fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(MAX_CACHE_BYTES + 1).unwrap();
        let repaired = fixture.cached(&[], false, false);
        assert!(!repaired.cached);
        assert_eq!(repaired.total_files, 1);
        assert!(read_cache(&path, &fixture.0, false, false).unwrap().is_some());
    }

    #[test]
    fn cache_validation_requires_parents_matching_scope_and_bounded_entries() {
        let fixture = Fixture::new();
        fixture.file("src/main.ts");
        let mut snapshot = inventory(&fixture.0, false, false).unwrap();
        assert!(validate_inventory(&snapshot, &fixture.0, false, false).is_ok());
        snapshot.entries.retain(|entry| entry.path != "src");
        assert!(validate_inventory(&snapshot, &fixture.0, false, false).unwrap_err().contains("parent"));
        let mut snapshot = inventory(&fixture.0, false, false).unwrap();
        snapshot.include_dependencies = true;
        assert!(validate_inventory(&snapshot, &fixture.0, false, false).is_err());
        let mut snapshot = inventory(&fixture.0, false, false).unwrap();
        let entry = snapshot.entries[0].clone();
        snapshot.entries = vec![entry; MAX_ENTRIES + 1];
        assert!(validate_inventory(&snapshot, &fixture.0, false, false).is_err());
    }

    #[test]
    fn cache_capacity_failure_preserves_the_old_snapshot_and_returns_fresh_inventory() {
        let fixture = Fixture::new();
        fixture.file("old.ts");
        fixture.cached(&[], false, false);
        let path = cache_path(&fixture.cache(), &fixture.0, false, false);
        let old = fs::read(&path).unwrap();
        for number in 0..512 { fs::write(fixture.cache().join(format!("other-{number}")), b"").unwrap(); }
        fixture.file("new.ts");
        let fresh = fixture.cached(&[], true, false);
        assert_eq!(fresh.total_files, 2);
        assert!(!fresh.cached);
        assert!(fresh.warnings.iter().any(|warning| warning.contains("could not be cached")));
        assert_eq!(fs::read(path).unwrap(), old);
    }

    #[test]
    fn partial_inventory_keeps_unscanned_directory_parents_visible() {
        let fixture = Fixture::new();
        fixture.file(&format!("{}deep.ts", "d/".repeat(MAX_DEPTH + 1)));
        let report = fixture.cached(&[], false, false);
        assert!(!report.complete);
        assert_eq!(report.entries.len(), MAX_DEPTH + 1);
        assert!(report.entries.last().unwrap().excluded);
        assert!(report.entries.iter().all(|entry| entry.kind == "directory"));
        let reused = fixture.cached(&[], false, false);
        assert!(reused.cached);
        assert!(!reused.complete);
    }

    #[test]
    fn gitignore_supports_nested_overrides_negation_anchors_and_double_stars_without_git() {
        let fixture = Fixture::new();
        for path in ["keep.log", "drop.log", "root-only.txt", "nested/root-only.txt", "nested/keep.log", "nested/drop.log", "nested/local.txt", "cache/child.txt", "nested/deep/generated/temp.tmp", "nested/deep/generated/keep.txt"] { fixture.file(path); }
        fs::write(fixture.0.join(".gitignore"), "*.log\n!/keep.log\n/root-only.txt\ncache/\n**/generated/*.tmp\n").unwrap();
        fs::write(fixture.0.join("nested/.gitignore"), "!keep.log\nlocal.txt\n").unwrap();
        assert!(!fixture.0.join(".git").exists());
        let report = fixture.scoped(&[], false, false, true);
        for path in ["keep.log", "nested/keep.log", "nested/root-only.txt", "nested/deep/generated/keep.txt"] {
            assert!(report.entries.iter().any(|entry| entry.path == path), "missing {path}");
        }
        for path in ["drop.log", "root-only.txt", "nested/drop.log", "nested/local.txt", "cache", "cache/child.txt", "nested/deep/generated/temp.tmp"] {
            assert!(!report.entries.iter().any(|entry| entry.path == path), "unexpected {path}");
        }
        assert_eq!(report.ignored_entries, 6);
        assert!(report.respect_gitignore && report.complete);
    }

    #[test]
    fn nested_project_inherits_repository_rules_and_local_overrides() {
        let fixture = Fixture::new();
        for path in [".git/config", "app/Library/cache.bin", "app/Temp/cache.bin", "app/Assets/code.cs", "app/Assets/keep.log", "app/Assets/drop.log", "app/root-only.log"] { fixture.file(path); }
        fs::write(fixture.0.join(".gitignore"), "/**/[Ll]ibrary/\n/**/[Tt]emp/\n*.log\n").unwrap();
        fs::write(fixture.0.join("app/.gitignore"), "!root-only.log\n").unwrap();
        fs::write(fixture.0.join("app/Assets/.gitignore"), "!keep.log\n").unwrap();
        let report = nested_scan(&fixture, "app", &[activity("Assets/code.cs", "read"), activity("Library/cache.bin", "read")], false, true);
        assert!(report.complete);
        assert_eq!(report.ignored_entries, 3);
        assert_eq!(report.read_files, ["Assets/code.cs"]);
        for path in ["Assets/code.cs", "Assets/keep.log", "root-only.log"] {
            assert!(report.entries.iter().any(|entry| entry.path == path), "missing {path}");
        }
        for path in ["Library", "Library/cache.bin", "Temp", "Assets/drop.log"] {
            assert!(!report.entries.iter().any(|entry| entry.path == path), "unexpected {path}");
        }
        assert_eq!(report.unmatched_files[0].path, "Library/cache.bin");
        assert_eq!(report.unmatched_files[0].reason, "not-in-snapshot");
        let opted_out = nested_scan(&fixture, "app", &[], false, false);
        assert!(opted_out.complete);
        assert_eq!(opted_out.ignored_entries, 0);
        assert!(opted_out.entries.iter().any(|entry| entry.path == "Library/cache.bin"));
        assert!(opted_out.entries.iter().any(|entry| entry.path == "Assets/drop.log"));
    }

    #[test]
    fn intermediary_rules_override_repository_rules_and_unrelated_ancestor_rules_are_not_loaded() {
        let fixture = Fixture::new();
        fixture.file("workspace/app/keep.log");
        fixture.file("workspace/app/drop.log");
        fixture.file("workspace/app/local.tmp");
        fs::write(fixture.0.join(".gitignore"), "*.log\n").unwrap();
        fs::write(fixture.0.join("workspace/.gitignore"), "!keep.log\n").unwrap();
        fs::write(fixture.0.join("workspace/app/.gitignore"), "*.tmp\n").unwrap();
        let no_repo = nested_scan(&fixture, "workspace/app", &[], true, true);
        assert!(no_repo.entries.iter().any(|entry| entry.path == "drop.log"));
        assert!(!no_repo.entries.iter().any(|entry| entry.path == "local.tmp"));
        fixture.file(".git/config");
        let inherited = nested_scan(&fixture, "workspace/app", &[], true, true);
        assert!(inherited.entries.iter().any(|entry| entry.path == "keep.log"));
        assert!(!inherited.entries.iter().any(|entry| entry.path == "drop.log"));
        assert!(!inherited.entries.iter().any(|entry| entry.path == "local.tmp"));
        assert!(inherited.complete);
    }

    #[test]
    fn nearest_repository_and_nested_worktree_boundaries_reset_outer_rules() {
        let fixture = Fixture::new();
        for path in [".git/config", "outer.tmp", "nested/.git", "nested/app/outer.tmp", "nested/app/secret.log"] { fixture.file(path); }
        // A .git file is only a boundary marker. Its contents are never interpreted.
        fs::write(fixture.0.join("nested/.git"), "gitdir: /must/not/be/read\n").unwrap();
        fs::write(fixture.0.join(".gitignore"), "*.tmp\n").unwrap();
        fs::write(fixture.0.join("nested/.gitignore"), "secret.log\n").unwrap();
        let child = nested_scan(&fixture, "nested/app", &[], true, true);
        assert!(child.complete);
        assert!(child.entries.iter().any(|entry| entry.path == "outer.tmp"));
        assert!(!child.entries.iter().any(|entry| entry.path == "secret.log"));
        let entire = fixture.scoped(&[], true, true, true);
        assert!(entire.complete);
        assert!(!entire.entries.iter().any(|entry| entry.path == "outer.tmp"));
        assert!(entire.entries.iter().any(|entry| entry.path == "nested/app/outer.tmp"));
        assert!(!entire.entries.iter().any(|entry| entry.path == "nested/app/secret.log"));
    }

    #[test]
    fn selected_project_below_an_ignored_parent_does_not_reinclude_its_contents() {
        let fixture = Fixture::new();
        fixture.file(".git/config");
        fixture.file("blocked/app/source.ts");
        fs::write(fixture.0.join(".gitignore"), "blocked/\n").unwrap();
        fs::write(fixture.0.join("blocked/app/.gitignore"), "!source.ts\n").unwrap();
        let report = nested_scan(&fixture, "blocked/app", &[activity("source.ts", "read")], false, true);
        assert!(report.complete);
        assert_eq!(report.ignored_entries, 1);
        assert_eq!(report.total_files, 0);
        assert!(report.entries.is_empty());
        assert_eq!(report.unmatched_files[0].reason, "not-in-snapshot");
        assert!(report.warnings.iter().any(|warning| warning.contains("selected project directory is ignored")));
    }

    #[test]
    fn inherited_rules_refresh_only_on_rescan_and_old_inventory_versions_are_rejected() {
        let fixture = Fixture::new();
        fixture.file(".git/config");
        fixture.file("app/old.tmp");
        fixture.file("app/new.log");
        fs::write(fixture.0.join(".gitignore"), "*.tmp\n").unwrap();
        let first = nested_scan(&fixture, "app", &[], false, true);
        assert!(!first.cached);
        assert!(first.entries.iter().any(|entry| entry.path == "new.log"));
        fs::write(fixture.0.join(".gitignore"), "*.log\n").unwrap();
        let cached = nested_scan(&fixture, "app", &[], false, true);
        assert!(cached.cached);
        assert!(cached.entries.iter().any(|entry| entry.path == "new.log"));
        let fresh = nested_scan(&fixture, "app", &[], true, true);
        assert!(!fresh.cached);
        assert!(fresh.entries.iter().any(|entry| entry.path == "old.tmp"));
        assert!(!fresh.entries.iter().any(|entry| entry.path == "new.log"));
        let root = fixture.0.join("app");
        let path = cache_path(&fixture.cache(), &root, true, true);
        let mut old: Inventory = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        old.version = 2;
        fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(read_cache(&path, &root, true, true).is_err());
        let rebuilt = nested_scan(&fixture, "app", &[], false, true);
        assert!(!rebuilt.cached);
        assert!(rebuilt.warnings.iter().any(|warning| warning.contains("will be rescanned")));
        assert_eq!(read_cache(&path, &root, true, true).unwrap().unwrap().version, 3);
    }

    #[test]
    #[ignore = "requires explicit local project and expected relative file environment variables"]
    fn real_project_inventory_smoke() {
        let project = std::env::var("SESSION_ANALYZE_SMOKE_PROJECT").expect("Set SESSION_ANALYZE_SMOKE_PROJECT");
        let expected = std::env::var("SESSION_ANALYZE_SMOKE_FILE").expect("Set SESSION_ANALYZE_SMOKE_FILE").replace('\\', "/");
        assert!(valid_relative(&expected), "Smoke file must be a concrete relative file path");
        let temporary = Fixture::new();
        let report = scan_cached(&temporary.cache(), &project, &[activity(&expected, "read")], true, true, true).unwrap();
        println!("Inventory smoke: {} files, {} directories, {} ignored entries, complete={}, {} matched reads, {} unmatched records",
            report.total_files, report.entries.iter().filter(|entry| entry.kind == "directory").count(), report.ignored_entries,
            report.complete, report.read_files.len(), report.unmatched_files.len());
        assert!(report.read_files.iter().any(|path| key(path) == key(&expected)), "Expected file was not matched in the fresh inventory");
    }

    #[test]
    fn ignored_parent_is_pruned_even_when_descendant_is_negated() {
        let fixture = Fixture::new();
        fixture.file("blocked/keep.txt");
        fixture.file("blocked/deeper/other.txt");
        fs::write(fixture.0.join(".gitignore"), "blocked/\n!blocked/keep.txt\n").unwrap();
        // Unread and invalid nested rules cannot restore children of an ignored directory.
        fs::write(fixture.0.join("blocked/.gitignore"), [0xff]).unwrap();
        let report = fixture.scoped(&[], false, false, true);
        assert_eq!(report.ignored_entries, 1);
        assert_eq!(report.total_files, 1);
        assert!(report.complete);
        assert!(!report.entries.iter().any(|entry| entry.path.starts_with("blocked")));
        assert!(report.basis.contains("not unenumerated descendants"));
    }

    #[test]
    fn ignore_scope_and_rules_are_cached_until_rescan_without_changing_recorded_evidence() {
        let fixture = Fixture::new();
        fixture.file("private.txt");
        fixture.file("visible.txt");
        fs::write(fixture.0.join(".gitignore"), "private.txt\n").unwrap();
        let files = vec![activity("private.txt", "read"), activity("visible.txt", "write")];
        let evidence = serde_json::to_value(&files).unwrap();
        let unfiltered = fixture.scoped(&files, false, false, false);
        assert_eq!(unfiltered.total_files, 3);
        assert_eq!(unfiltered.read_files, ["private.txt"]);
        let filtered = fixture.scoped(&files, false, false, true);
        assert!(!filtered.cached);
        assert_eq!(filtered.total_files, 2);
        assert!(filtered.read_files.is_empty());
        assert_eq!(filtered.written_files, ["visible.txt"]);
        assert!(filtered.warnings.iter().any(|warning| warning.contains("missing from this inventory")));
        fs::write(fixture.0.join(".gitignore"), "visible.txt\n").unwrap();
        let cached = fixture.scoped(&files, false, false, true);
        assert!(cached.cached);
        assert!(cached.read_files.is_empty());
        assert_eq!(cached.written_files, ["visible.txt"]);
        let fresh = fixture.scoped(&files, true, false, true);
        assert!(!fresh.cached);
        assert_eq!(fresh.read_files, ["private.txt"]);
        assert!(fresh.written_files.is_empty());
        assert!(fixture.scoped(&files, false, false, false).cached);
        assert_eq!(serde_json::to_value(&files).unwrap(), evidence);
    }

    #[test]
    fn dependency_and_ignore_scopes_combine_and_git_contents_stay_excluded() {
        let fixture = Fixture::new();
        for path in ["source.ts", "node_modules/package/index.js", "node_modules/package/cache.tmp", ".git/config"] { fixture.file(path); }
        fs::write(fixture.0.join(".gitignore"), "*.tmp\n!.git/\n").unwrap();
        let default = fixture.scoped(&[], false, false, true);
        assert_eq!(default.total_files, 2);
        let expanded = fixture.scoped(&[], false, true, true);
        assert!(!expanded.cached);
        assert_eq!(expanded.total_files, 3);
        assert_eq!(expanded.ignored_entries, 1);
        assert!(expanded.entries.iter().any(|entry| entry.path == "node_modules/package/index.js"));
        assert!(!expanded.entries.iter().any(|entry| entry.path == ".git/config"));
        let unfiltered = fixture.scoped(&[], false, true, false);
        assert!(!unfiltered.cached);
        assert_eq!(unfiltered.total_files, 4);
        assert!(fixture.scoped(&[], false, true, true).cached);
        assert!(fixture.scoped(&[], false, false, true).cached);
    }

    #[test]
    fn invalid_and_oversized_rules_warn_and_mark_only_opted_in_scans_partial() {
        let fixture = Fixture::new();
        fixture.file("source.ts");
        fs::write(fixture.0.join(".gitignore"), "[z-a]\nsource.ts\n").unwrap();
        let invalid = fixture.scoped(&[], false, false, true);
        assert!(!invalid.complete);
        assert_eq!(invalid.ignored_entries, 1);
        assert!(invalid.warnings.iter().any(|warning| warning.contains("invalid .gitignore")));
        fs::write(fixture.0.join(".gitignore"), vec![b'#'; 256 * 1024 + 1]).unwrap();
        let oversized = fixture.scoped(&[], true, false, true);
        assert!(!oversized.complete);
        assert_eq!(oversized.ignored_entries, 0);
        assert!(oversized.warnings.iter().any(|warning| warning.contains(".gitignore loading reached a safety limit")));
        assert!(fixture.scoped(&[], false, false, false).complete);
    }

    #[test]
    fn linked_gitignore_is_never_read() {
        let fixture = Fixture::new();
        let external = Fixture::new();
        fixture.file("source.ts");
        fs::write(external.0.join("rules"), "source.ts\n").unwrap();
        let link = fixture.0.join(".gitignore");
        #[cfg(unix)]
        std::os::unix::fs::symlink(external.0.join("rules"), &link).unwrap();
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_file(external.0.join("rules"), &link) {
            if error.raw_os_error() == Some(1314) { return; }
            panic!("Could not create .gitignore symlink fixture: {error}");
        }
        let report = fixture.scoped(&[], false, false, true);
        assert_eq!(report.total_files, 1);
        assert_eq!(report.ignored_entries, 0);
        assert!(!report.complete);
        assert!(report.warnings.iter().any(|warning| warning.contains(".gitignore files without reading them")));
    }
}
