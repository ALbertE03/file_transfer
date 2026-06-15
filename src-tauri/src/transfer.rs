use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tauri::{AppHandle, Emitter};

use crate::types::ProgressPayload;
use crate::adb::get_adb_path;

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
    direction: String,
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

        app.emit("transfer-progress", ProgressPayload {
            current_file: file_name.clone(),
            index: index + 1,
            total,
            percentage: 0,
            status: "running".to_string(),
            error_message: None,
        }).ok();

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

        app.emit("transfer-progress", ProgressPayload {
            current_file: file_name.clone(),
            index: index + 1,
            total,
            percentage: 100,
            status: "running".to_string(),
            error_message: None,
        }).ok();
    }

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
    fn test_parse_percentage() {
        assert_eq!(parse_percentage("[ 50%] /sdcard/file.bin"), Some(50));
        assert_eq!(parse_percentage("[  9%] /sdcard/file.bin"), Some(9));
        assert_eq!(parse_percentage("[100%] /sdcard/file.bin"), Some(100));
        assert_eq!(parse_percentage("some noise [ 75%] other noise"), Some(75));
    }
}
