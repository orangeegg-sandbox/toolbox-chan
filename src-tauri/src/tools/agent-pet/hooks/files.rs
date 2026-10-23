//! Careful file edits for agent config files: read, back up once, write atomically.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const BACKUP_SUFFIX: &str = ".toolbox-chan-backup";

/// The backup made before Toolbox-Chan first edited `path`.
pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(BACKUP_SUFFIX);
    PathBuf::from(name)
}

/// `None` when the file does not exist yet.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read(path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(|text| Some(text.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(text)))
            .map_err(|_| format!("{} is not UTF-8 text.", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read {}: {error}", path.display())),
    }
}

/// Copies the original file once, before the first edit. Later edits keep that first copy.
pub fn back_up_once(path: &Path) -> Result<(), String> {
    let backup = backup_path(path);
    if backup.exists() || !path.exists() {
        return Ok(());
    }
    fs::copy(path, &backup).map(|_| ()).map_err(|error| format!("Could not back up {}: {error}", path.display()))
}

/// Writes through a temporary file in the same folder, so a crash never leaves half a config.
pub fn write_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let directory = path.parent().ok_or_else(|| format!("{} has no parent folder.", path.display()))?;
    fs::create_dir_all(directory).map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(".toolbox-chan-{}.tmp", std::process::id()));
    let temporary = PathBuf::from(temporary);
    let result = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| format!("Could not write {}: {error}", path.display()))
}
