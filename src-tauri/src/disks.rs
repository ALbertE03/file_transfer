use tokio::process::Command;

use crate::types::{DiskInfo, StorageSpace};
use crate::adb::get_adb_path;

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
