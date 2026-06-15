use std::path::Path;
use std::process::Stdio;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tauri::{AppHandle, Emitter};

use crate::types::ProgressPayload;
use crate::adb::get_adb_path;

fn format_speed(bytes_per_sec: u64) -> String {
    if bytes_per_sec >= 1_000_000 {
        format!("{:.1} MB/s", bytes_per_sec as f64 / 1_000_000.0)
    } else if bytes_per_sec >= 1_000 {
        format!("{:.1} KB/s", bytes_per_sec as f64 / 1_000.0)
    } else if bytes_per_sec > 0 {
        format!("{} B/s", bytes_per_sec)
    } else {
        String::new()
    }
}

fn shell_escape(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

async fn get_remote_file_size(adb: &str, device_id: &str, path: &str) -> Option<u64> {
    let output = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("shell")
        .arg(format!("wc -c < {}", shell_escape(path)))
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<u64>().ok()
}

async fn push_file(
    adb: &str,
    device_id: &str,
    source: &str,
    dest_path: &str,
    app: &AppHandle,
    index: usize,
    total: usize,
    file_name: &str,
    file_size: u64,
) -> Result<(), String> {
    let adb_cmd = format!("cat > {}", shell_escape(dest_path));

    let mut child = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("shell")
        .arg(&adb_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ADB: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    let mut file = tokio::fs::File::open(source)
        .await
        .map_err(|e| format!("Failed to open '{}': {}", source, e))?;

    let mut buf = [0u8; 65536];
    let mut transferred: u64 = 0;
    let mut last_time = Instant::now();
    let mut last_bytes: u64 = 0;

    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Failed to read '{}': {}", source, e))?;
        if n == 0 {
            break;
        }
        stdin
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write error: {}", e))?;

        transferred += n as u64;
        let now = Instant::now();
        let elapsed = now.duration_since(last_time).as_secs_f64();

        if elapsed >= 0.2 || transferred >= file_size {
            let byte_diff = transferred - last_bytes;
            let speed = if elapsed > 0.0 {
                (byte_diff as f64 / elapsed) as u64
            } else {
                0
            };
            let pct = if file_size > 0 {
                (transferred * 100 / file_size) as u32
            } else {
                100
            };

            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name.to_string(),
                    index: index + 1,
                    total,
                    percentage: pct.min(100),
                    speed: format_speed(speed),
                    status: "running".to_string(),
                    error_message: None,
                },
            )
            .ok();

            last_time = now;
            last_bytes = transferred;
        }
    }

    drop(stdin);
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Error waiting for process: {}", e))?;

    if !status.success() {
        return Err(format!("Failed to push '{}' to device", file_name));
    }

    Ok(())
}

async fn pull_file(
    adb: &str,
    device_id: &str,
    source: &str,
    dest_path: &str,
    app: &AppHandle,
    index: usize,
    total: usize,
    file_name: &str,
    file_size: u64,
) -> Result<(), String> {
    let adb_cmd = format!("cat {}", shell_escape(source));

    let mut child = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("exec-out")
        .arg(&adb_cmd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ADB: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut file = tokio::fs::File::create(dest_path)
        .await
        .map_err(|e| format!("Failed to create '{}': {}", dest_path, e))?;

    let mut buf = [0u8; 65536];
    let mut transferred: u64 = 0;
    let mut last_time = Instant::now();
    let mut last_bytes: u64 = 0;

    loop {
        let n = stdout
            .read(&mut buf)
            .await
            .map_err(|e| format!("Failed to read from device: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .await
            .map_err(|e| format!("Failed to write '{}': {}", dest_path, e))?;

        transferred += n as u64;
        let now = Instant::now();
        let elapsed = now.duration_since(last_time).as_secs_f64();

        if elapsed >= 0.2 || transferred >= file_size {
            let byte_diff = transferred - last_bytes;
            let speed = if elapsed > 0.0 {
                (byte_diff as f64 / elapsed) as u64
            } else {
                0
            };
            let pct = if file_size > 0 {
                (transferred * 100 / file_size) as u32
            } else {
                100
            };

            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name.to_string(),
                    index: index + 1,
                    total,
                    percentage: pct.min(100),
                    speed: format_speed(speed),
                    status: "running".to_string(),
                    error_message: None,
                },
            )
            .ok();

            last_time = now;
            last_bytes = transferred;
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Error waiting for process: {}", e))?;

    if !status.success() {
        return Err(format!("Failed to pull '{}' from device", file_name));
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_files(
    app: AppHandle,
    device_id: String,
    direction: String,
    sources: Vec<String>,
    destination: String,
) -> Result<(), String> {
    let adb = get_adb_path();
    let total = sources.len();

    let mut file_info: Vec<(String, u64)> = Vec::new();
    for source in &sources {
        let file_name = Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| source.clone());

        if direction == "push" {
            let meta = std::fs::metadata(source)
                .map_err(|e| format!("Cannot access '{}': {}", source, e))?;
            if meta.is_dir() {
                return Err("Cannot transfer directories. Select individual files.".to_string());
            }
        }

        let size = if direction == "push" {
            std::fs::metadata(source).map(|m| m.len()).unwrap_or(0)
        } else {
            get_remote_file_size(&adb, &device_id, source)
                .await
                .unwrap_or(0)
        };
        file_info.push((file_name, size));
    }

    for (index, source) in sources.iter().enumerate() {
        let (file_name, file_size) = &file_info[index];

        app.emit(
            "transfer-progress",
            ProgressPayload {
                current_file: file_name.clone(),
                index: index + 1,
                total,
                percentage: 0,
                speed: String::new(),
                status: "running".to_string(),
                error_message: None,
            },
        )
        .ok();

        let dest_path = format!("{}/{}", destination.trim_end_matches('/'), file_name);

        let result = if direction == "push" {
            push_file(
                &adb,
                &device_id,
                source,
                &dest_path,
                &app,
                index,
                total,
                file_name,
                *file_size,
            )
            .await
        } else {
            pull_file(
                &adb,
                &device_id,
                source,
                &dest_path,
                &app,
                index,
                total,
                file_name,
                *file_size,
            )
            .await
        };

        if let Err(e) = result {
            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name.clone(),
                    index: index + 1,
                    total,
                    percentage: 0,
                    speed: String::new(),
                    status: "error".to_string(),
                    error_message: Some(e.clone()),
                },
            )
            .ok();
            return Err(e);
        }

        app.emit(
            "transfer-progress",
            ProgressPayload {
                current_file: file_name.clone(),
                index: index + 1,
                total,
                percentage: 100,
                speed: String::new(),
                status: "running".to_string(),
                error_message: None,
            },
        )
        .ok();
    }

    app.emit(
        "transfer-progress",
        ProgressPayload {
            current_file: String::new(),
            index: total,
            total,
            percentage: 100,
            speed: String::new(),
            status: "completed".to_string(),
            error_message: None,
        },
    )
    .ok();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_speed() {
        assert_eq!(format_speed(0), "");
        assert_eq!(format_speed(500), "500 B/s");
        assert_eq!(format_speed(1500), "1.5 KB/s");
        assert_eq!(format_speed(2_500_000), "2.5 MB/s");
    }

    #[test]
    fn test_shell_escape() {
        assert_eq!(shell_escape("/simple/path"), "'/simple/path'");
        assert_eq!(shell_escape("/my 'file'.txt"), "'/my '\\''file'\\''.txt'");
    }
}
