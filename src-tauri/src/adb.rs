use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone, Debug)]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub status: String,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: String,
    pub link_target: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct LocalFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DiskInfo {
    pub name: String,
    pub path: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub pct: u32,
    pub is_removable: bool,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct StorageSpace {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub pct: u32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ProgressPayload {
    pub current_file: String,
    pub index: usize,
    pub total: usize,
    pub percentage: u32,
    pub status: String, // "running", "completed", "error"
    pub error_message: Option<String>,
}

// Helper to locate ADB executable
fn get_adb_path() -> String {
    if std::process::Command::new("adb").arg("--version").output().is_ok() {
        return "adb".to_string();
    }
    if Path::new("/usr/local/bin/adb").exists() {
        return "/usr/local/bin/adb".to_string();
    }
    if Path::new("/opt/homebrew/bin/adb").exists() {
        return "/opt/homebrew/bin/adb".to_string();
    }
    if let Ok(home) = std::env::var("HOME") {
        let sdk_path = format!("{}/Library/Android/sdk/platform-tools/adb", home);
        if Path::new(&sdk_path).exists() {
            return sdk_path;
        }
    }
    "adb".to_string()
}

#[tauri::command]
pub async fn get_adb_devices() -> Result<Vec<Device>, String> {
    let adb = get_adb_path();
    let output = std::process::Command::new(&adb)
        .arg("devices")
        .arg("-l")
        .output()
        .map_err(|e| format!("Failed to run adb: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in stdout_str.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices attached") {
            continue;
        }

        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() >= 2 {
            let serial = tokens[0].to_string();
            let status = tokens[1].to_string();
            let mut model = "Unknown Device".to_string();

            for token in tokens.iter().skip(2) {
                if token.starts_with("model:") {
                    model = token.replace("model:", "").replace("_", " ");
                    break;
                }
            }

            devices.push(Device {
                serial,
                model,
                status,
            });
        }
    }

    Ok(devices)
}

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
                Err(_) => continue, // Skip unreadable files
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

            files.push(LocalFile {
                name,
                path: path_str,
                is_dir,
                size,
                modified,
            });
        }
    }

    // Sort folders first, then files alphabetically
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

        // Skip self/parent listings in file manager panel
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

    // For /storage or /, return storage volume roots
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

    // For any other path, list the actual directory contents via adb shell ls -la
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

    // Sort folders first, then files alphabetically
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
pub fn get_home_directories() -> Result<(String, String), String> {
    let local_home = std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string());
    // Android starting path set to /storage to show internal and SD card
    let remote_home = "/storage".to_string();
    Ok((local_home, remote_home))
}

fn parse_df_output(stdout: &str) -> Option<StorageSpace> {
    let lines: Vec<&str> = stdout.lines().collect();
    if lines.len() < 2 {
        return None;
    }
    
    let mut stats_line = "";
    for line in lines.iter().skip(1) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            stats_line = trimmed;
            break;
        }
    }
    
    if stats_line.is_empty() {
        return None;
    }

    let tokens: Vec<&str> = stats_line.split_whitespace().collect();
    if tokens.len() >= 5 {
        let total_kb = tokens[1].parse::<u64>().ok()?;
        let used_kb = tokens[2].parse::<u64>().ok()?;
        let free_kb = tokens[3].parse::<u64>().ok()?;
        
        let pct_str = tokens[4].replace('%', "");
        let pct = pct_str.parse::<u32>().unwrap_or(0);
        
        Some(StorageSpace {
            total: total_kb * 1024,
            used: used_kb * 1024,
            free: free_kb * 1024,
            pct,
        })
    } else {
        None
    }
}

async fn get_local_path_space(path: &str) -> Option<StorageSpace> {
    let output = Command::new("df")
        .arg("-k")
        .arg(path)
        .output()
        .await
        .ok()?;
    
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_df_output(&stdout)
    } else {
        None
    }
}

async fn get_remote_path_space(adb: &str, device_id: &str, path: &str) -> Option<StorageSpace> {
    let output = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("shell")
        .arg(format!("df -k '{}'", path))
        .output()
        .await
        .ok()?;
    
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_df_output(&stdout)
    } else {
        None
    }
}

#[tauri::command]
pub async fn get_local_disks() -> Result<Vec<DiskInfo>, String> {
    let mut disks = Vec::new();
    
    // 1. Macintosh HD (Root)
    if let Some(space) = get_local_path_space("/").await {
        disks.push(DiskInfo {
            name: "Macintosh HD".to_string(),
            path: "/".to_string(),
            total: space.total,
            free: space.free,
            used: space.used,
            pct: space.pct,
            is_removable: false,
        });
    }

    // 2. Volumes
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            let path_buf = entry.path();
            let path_str = path_buf.to_string_lossy().to_string();
            let name = entry.file_name().to_string_lossy().to_string();
            
            if name.starts_with('.') || name == "macOS" {
                continue;
            }
            
            if path_buf.is_dir() {
                if let Some(space) = get_local_path_space(&path_str).await {
                    disks.push(DiskInfo {
                        name,
                        path: path_str,
                        total: space.total,
                        free: space.free,
                        used: space.used,
                        pct: space.pct,
                        is_removable: true,
                    });
                }
            }
        }
    }

    Ok(disks)
}

#[tauri::command]
pub async fn get_remote_disks(device_id: String) -> Result<Vec<DiskInfo>, String> {
    let adb = get_adb_path();
    let mut disks = Vec::new();

    // 1. Internal Storage
    if let Some(space) = get_remote_path_space(&adb, &device_id, "/storage/emulated/0").await {
        disks.push(DiskInfo {
            name: "Almacenamiento Interno".to_string(),
            path: "/storage/emulated/0".to_string(),
            total: space.total,
            free: space.free,
            used: space.used,
            pct: space.pct,
            is_removable: false,
        });
    } else if let Some(space) = get_remote_path_space(&adb, &device_id, "/sdcard").await {
        disks.push(DiskInfo {
            name: "Almacenamiento Interno".to_string(),
            path: "/sdcard".to_string(),
            total: space.total,
            free: space.free,
            used: space.used,
            pct: space.pct,
            is_removable: false,
        });
    }

    // 2. Scan /storage for external cards
    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("shell")
        .arg("ls -la /storage")
        .output()
        .await
        .map_err(|e| format!("Failed to list remote storage: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.len() >= 2 {
                let permissions = tokens[0];
                if permissions.starts_with('d') {
                    if let Some(&name) = tokens.last() {
                        if name != "." && name != ".." && name != "self" && name != "emulated" && name != "usb" {
                            let path = format!("/storage/{}", name);
                            if let Some(space) = get_remote_path_space(&adb, &device_id, &path).await {
                                disks.push(DiskInfo {
                                    name: format!("Tarjeta SD ({})", name),
                                    path,
                                    total: space.total,
                                    free: space.free,
                                    used: space.used,
                                    pct: space.pct,
                                    is_removable: true,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(disks)
}

#[tauri::command]
pub async fn adb_connect(ip: String) -> Result<String, String> {
    let adb = get_adb_path();
    let output = Command::new(&adb)
        .arg("connect")
        .arg(&ip)
        .output()
        .await
        .map_err(|e| format!("Failed to run adb connect: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() && !stdout.contains("failed") {
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Error de conexión: {} {}", stdout, stderr))
    }
}

#[tauri::command]
pub async fn adb_pair(ip: String, code: String) -> Result<String, String> {
    let adb = get_adb_path();
    let output = Command::new(&adb)
        .arg("pair")
        .arg(&ip)
        .arg(&code)
        .output()
        .await
        .map_err(|e| format!("Failed to run adb pair: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() && !stdout.contains("failed") {
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Error de emparejamiento: {} {}", stdout, stderr))
    }
}

#[tauri::command]
pub async fn adb_enable_tcpip(device_id: String) -> Result<String, String> {
    let adb = get_adb_path();
    let output = Command::new(&adb)
        .arg("-s")
        .arg(&device_id)
        .arg("tcpip")
        .arg("5555")
        .output()
        .await
        .map_err(|e| format!("Failed to run adb tcpip: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok("Dispositivo cambiado a modo TCP/IP en puerto 5555. ¡Ya puedes desconectar el cable y conectarte por WiFi con su dirección IP!".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Error al habilitar TCP/IP: {} {}", stdout, stderr))
    }
}

fn parse_percentage(text: &str) -> Option<u32> {
    if let Some(pct_idx) = text.rfind('%') {
        let mut start = pct_idx;
        while start > 0 {
            start -= 1;
            let c = text.chars().nth(start)?;
            if c == '[' {
                let num_str = &text[start + 1..pct_idx].trim();
                if let Ok(val) = num_str.parse::<u32>() {
                    if val <= 100 {
                        return Some(val);
                    }
                }
                break;
            }
        }
    }
    None
}

#[tauri::command]
pub async fn copy_files(
    app: AppHandle,
    device_id: String,
    direction: String, // "push" (local -> remote) or "pull" (remote -> local)
    sources: Vec<String>,
    destination: String,
) -> Result<(), String> {
    let adb = get_adb_path();
    let total = sources.len();

    for (index, source) in sources.iter().enumerate() {
        let file_name = Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| source.clone());

        // Emit initial status for this file
        app.emit("transfer-progress", ProgressPayload {
            current_file: file_name.clone(),
            index: index + 1,
            total,
            percentage: 0,
            status: "running".to_string(),
            error_message: None,
        }).ok();

        // Spawn process
        let mut cmd = Command::new(&adb);
        cmd.arg("-s").arg(&device_id);

        if direction == "push" {
            cmd.arg("push").arg(source).arg(&destination);
        } else {
            cmd.arg("pull").arg(source).arg(&destination);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn adb: {}", e))?;
        let mut stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let mut stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        let app_clone = app.clone();
        let file_name_clone = file_name.clone();

        // Async loop to read stdout for progress
        let stdout_handle = tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let mut last_percentage = 0;
            while let Ok(n) = stdout.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buf[..n]);
                if let Some(pct) = parse_percentage(&text) {
                    if pct != last_percentage {
                        last_percentage = pct;
                        app_clone.emit("transfer-progress", ProgressPayload {
                            current_file: file_name_clone.clone(),
                            index: index + 1,
                            total,
                            percentage: pct,
                            status: "running".to_string(),
                            error_message: None,
                        }).ok();
                    }
                }
            }
        });

        // Wait for adb to finish
        let status = child.wait().await.map_err(|e| format!("Error waiting for process: {}", e))?;
        let _ = stdout_handle.await;

        if !status.success() {
            let mut err_str = String::new();
            let _ = stderr.read_to_string(&mut err_str).await;
            
            app.emit("transfer-progress", ProgressPayload {
                current_file: file_name.clone(),
                index: index + 1,
                total,
                percentage: 0,
                status: "error".to_string(),
                error_message: Some(err_str.clone()),
            }).ok();

            return Err(format!("Failed to copy file '{}': {}", file_name, err_str));
        }

        // Emit final 100% progress for this file
        app.emit("transfer-progress", ProgressPayload {
            current_file: file_name.clone(),
            index: index + 1,
            total,
            percentage: 100,
            status: "running".to_string(),
            error_message: None,
        }).ok();
    }

    // Emit completed event
    app.emit("transfer-progress", ProgressPayload {
        current_file: "".to_string(),
        index: total,
        total,
        percentage: 100,
        status: "completed".to_string(),
        error_message: None,
    }).ok();

    Ok(())
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

    #[test]
    fn test_parse_percentage() {
        assert_eq!(parse_percentage("[ 50%] /sdcard/file.bin"), Some(50));
        assert_eq!(parse_percentage("[  9%] /sdcard/file.bin"), Some(9));
        assert_eq!(parse_percentage("[100%] /sdcard/file.bin"), Some(100));
        assert_eq!(parse_percentage("some noise [ 75%] other noise"), Some(75));
    }
}
