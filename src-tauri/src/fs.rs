use std::path::Path;
use tokio::process::Command;

use crate::types::{LocalFile, RemoteFile};
use crate::adb::get_adb_path;

#[tauri::command]
pub fn list_local_files(path: &str) -> Result<Vec<LocalFile>, String> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let dir = std::fs::read_dir(dir_path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();

    for entry in dir {
        if let Ok(entry) = entry {
            let metadata = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let name = entry.file_name().to_string_lossy().to_string();
            let path_buf = entry.path();
            let path_str = path_buf.to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            let size = metadata.len();
            let modified = if let Ok(modified_time) = metadata.modified() {
                let datetime: chrono::DateTime<chrono::Local> = modified_time.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            } else {
                "".to_string()
            };

            files.push(LocalFile { name, path: path_str, is_dir, size, modified });
        }
    }

    files.sort_by(|a, b| {
        let a_hidden = a.name.starts_with('.');
        let b_hidden = b.name.starts_with('.');
        if a_hidden && !b_hidden {
            std::cmp::Ordering::Greater
        } else if !a_hidden && b_hidden {
            std::cmp::Ordering::Less
        } else if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(files)
}

pub fn parse_ls_line(line: &str, parent_path: &str) -> Option<RemoteFile> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("total ") {
        return None;
    }

    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }

    let permissions = tokens[0];
    if permissions.len() < 10 {
        return None;
    }

    let first_char = permissions.chars().next()?;
    let is_dir = first_char == 'd';
    let is_symlink = first_char == 'l';

    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

    let mut date_idx = None;
    let mut is_iso_date = false;

    for (i, token) in tokens.iter().enumerate() {
        if token.len() == 10 && token.chars().nth(4) == Some('-') && token.chars().nth(7) == Some('-') {
            date_idx = Some(i);
            is_iso_date = true;
            break;
        }
        let token_lower = token.to_lowercase();
        if months.contains(&token_lower.as_str()) {
            date_idx = Some(i);
            break;
        }
    }

    if let Some(d_idx) = date_idx {
        let (size_val, name_start_idx, modified) = if is_iso_date {
            let size_str = tokens.get(d_idx - 1).copied().unwrap_or("0");
            let size = size_str.parse::<u64>().unwrap_or(0);
            let date_str = tokens.get(d_idx).copied().unwrap_or("");
            let time_str = tokens.get(d_idx + 1).copied().unwrap_or("");
            let modified = format!("{} {}", date_str, time_str);
            (size, d_idx + 2, modified)
        } else {
            let size_str = tokens.get(d_idx - 1).copied().unwrap_or("0");
            let size = size_str.parse::<u64>().unwrap_or(0);
            let month = tokens.get(d_idx).copied().unwrap_or("");
            let day = tokens.get(d_idx + 1).copied().unwrap_or("");
            let year_or_time = tokens.get(d_idx + 2).copied().unwrap_or("");
            let modified = format!("{} {} {}", month, day, year_or_time);
            (size, d_idx + 3, modified)
        };

        if name_start_idx >= tokens.len() {
            return None;
        }

        let mut name = tokens[name_start_idx..].join(" ");
        let mut link_target = None;

        if is_symlink {
            if let Some(pos) = name.find(" -> ") {
                let target = name[pos + 4..].to_string();
                name = name[..pos].to_string();
                link_target = Some(target);
            }
        }

        if name == "." || name == ".." {
            return None;
        }

        let path = if parent_path == "/" {
            format!("/{}", name)
        } else if parent_path.ends_with('/') {
            format!("{}{}", parent_path, name)
        } else {
            format!("{}/{}", parent_path, name)
        };

        Some(RemoteFile {
            name,
            path,
            is_dir,
            is_symlink,
            size: size_val,
            modified,
            permissions: permissions.to_string(),
            link_target,
        })
    } else {
        let name = tokens.last()?.to_string();
        if name == "." || name == ".." {
            return None;
        }
        let path = if parent_path == "/" {
            format!("/{}", name)
        } else if parent_path.ends_with('/') {
            format!("{}{}", parent_path, name)
        } else {
            format!("{}/{}", parent_path, name)
        };
        Some(RemoteFile {
            name,
            path,
            is_dir,
            is_symlink,
            size: 0,
            modified: "".to_string(),
            permissions: permissions.to_string(),
            link_target: None,
        })
    }
}

#[tauri::command]
pub async fn list_remote_files(device_id: String, path: String) -> Result<Vec<RemoteFile>, String> {
    let adb = get_adb_path();

    if path == "/storage" || path == "/" {
        let mut files = Vec::new();
        files.push(RemoteFile {
            name: "Almacenamiento Interno".to_string(),
            path: "/storage/emulated/0".to_string(),
            is_dir: true,
            is_symlink: false,
            size: 0,
            modified: "".to_string(),
            permissions: "drwxrwxrwx".to_string(),
            link_target: None,
        });

        let output = Command::new(&adb)
            .arg("-s")
            .arg(&device_id)
            .arg("shell")
            .arg("ls -la /storage")
            .output()
            .await
            .map_err(|e| format!("Failed to list storage: {}", e))?;

        if output.status.success() {
            let stdout_str = String::from_utf8_lossy(&output.stdout);
            for line in stdout_str.lines() {
                if let Some(file) = parse_ls_line(line, "/storage") {
                    if file.name != "self" && file.name != "emulated" && file.name != "usb" {
                        let mut sd_file = file.clone();
                        sd_file.name = format!("Tarjeta SD ({})", file.name);
                        files.push(sd_file);
                    }
                }
            }
        }

        files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        return Ok(files);
    }

    let escaped_path = path.replace("'", "'\\''");
    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg(format!("ls -la '{}'", escaped_path))
        .output()
        .await
        .map_err(|e| format!("Failed to list directory: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list directory '{}': {}", path, stderr));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut files: Vec<RemoteFile> = Vec::new();

    for line in stdout_str.lines() {
        if let Some(file) = parse_ls_line(line, &path) {
            files.push(file);
        }
    }

    files.sort_by(|a, b| {
        let a_hidden = a.name.starts_with('.');
        let b_hidden = b.name.starts_with('.');
        if a_hidden && !b_hidden {
            std::cmp::Ordering::Greater
        } else if !a_hidden && b_hidden {
            std::cmp::Ordering::Less
        } else if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(files)
}

#[tauri::command]
pub async fn create_local_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create folder: {}", e))
}

#[tauri::command]
pub async fn create_remote_directory(device_id: String, path: String) -> Result<(), String> {
    let adb = get_adb_path();
    let escaped_path = path.replace("'", "'\\''");
    let cmd = format!("mkdir -p '{}'", escaped_path);

    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg(cmd)
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_local_items(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let p = Path::new(&path);
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| format!("Failed to delete folder {}: {}", path, e))?;
        } else {
            std::fs::remove_file(p).map_err(|e| format!("Failed to delete file {}: {}", path, e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_remote_items(device_id: String, paths: Vec<String>) -> Result<(), String> {
    let adb = get_adb_path();
    for path in paths {
        let escaped_path = path.replace("'", "'\\''");
        let cmd = format!("rm -rf '{}'", escaped_path);

        let output = Command::new(&adb)
            .arg("-s")
            .arg(&device_id)
            .arg("shell")
            .arg(cmd)
            .output()
            .await
            .map_err(|e| format!("Failed to delete {}: {}", path, e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_local_item(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}

#[tauri::command]
pub async fn rename_remote_item(device_id: String, old_path: String, new_path: String) -> Result<(), String> {
    let adb = get_adb_path();
    let escaped_old = old_path.replace("'", "'\\''");
    let escaped_new = new_path.replace("'", "'\\''");
    let cmd = format!("mv '{}' '{}'", escaped_old, escaped_new);

    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg(cmd)
        .output()
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn is_local_dir(path: String) -> bool {
    std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)
}

#[tauri::command]
pub async fn is_remote_dir(device_id: String, path: String) -> bool {
    let adb = get_adb_path();
    let cmd = format!("test -d {} && echo yes || echo no", shell_escape(&path));
    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg(&cmd)
        .output()
        .await;
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim() == "yes",
        Err(_) => false,
    }
}

fn shell_escape(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

#[tauri::command]
pub fn list_local_files_recursive(path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_local_files(&path, &mut files)?;
    Ok(files)
}

fn collect_local_files(dir_path: &str, files: &mut Vec<String>) -> Result<(), String> {
    let dir = std::fs::read_dir(Path::new(dir_path)).map_err(|e| format!("Cannot read '{}': {}", dir_path, e))?;
    for entry in dir.flatten() {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        if path.is_dir() {
            collect_local_files(&path_str, files)?;
        } else {
            files.push(path_str);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_remote_files_recursive(device_id: String, path: String) -> Result<Vec<String>, String> {
    let adb = get_adb_path();
    let escaped = path.replace("'", "'\\''");
    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg(format!("find '{}' -type f 2>/dev/null", escaped))
        .output()
        .await
        .map_err(|e| format!("Failed to list remote files: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout.lines().map(|l| l.to_string()).collect();
    Ok(files)
}

#[tauri::command]
pub fn get_home_directories() -> Result<(String, String), String> {
    let local_home = std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string());
    let remote_home = "/storage/emulated/0".to_string();
    Ok((local_home, remote_home))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ls_line_iso() {
        let line = "-rw-rw---- 1 root sdcard_rw 1599824 2026-06-10 18:32 photo.jpg";
        let parsed = parse_ls_line(line, "/sdcard").unwrap();
        assert_eq!(parsed.name, "photo.jpg");
        assert_eq!(parsed.size, 1599824);
        assert_eq!(parsed.is_dir, false);
        assert_eq!(parsed.modified, "2026-06-10 18:32");
    }

    #[test]
    fn test_parse_ls_line_monthly() {
        let line = "drwxrwx--x  3 system system 4096 Jun 14 12:00 cache";
        let parsed = parse_ls_line(line, "/").unwrap();
        assert_eq!(parsed.name, "cache");
        assert_eq!(parsed.size, 4096);
        assert_eq!(parsed.is_dir, true);
        assert_eq!(parsed.modified, "Jun 14 12:00");
    }

    #[test]
    fn test_parse_ls_line_spaces() {
        let line = "-rw-rw---- 1 root sdcard_rw 1024 2026-06-10 18:32 My Document File.pdf";
        let parsed = parse_ls_line(line, "/sdcard").unwrap();
        assert_eq!(parsed.name, "My Document File.pdf");
        assert_eq!(parsed.size, 1024);
        assert_eq!(parsed.is_dir, false);
    }
}
