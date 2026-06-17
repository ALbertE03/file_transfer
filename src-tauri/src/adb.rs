use std::path::Path;

use crate::types::Device;

pub fn get_adb_path() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("adb");
            if bundled.exists() {
                return bundled.to_string_lossy().to_string();
            }
            let resources = dir.join("Resources").join("adb");
            if resources.exists() {
                return resources.to_string_lossy().to_string();
            }
        }
    }
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

            devices.push(Device { serial, model, status });
        }
    }

    Ok(devices)
}
