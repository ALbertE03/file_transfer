use std::path::Path;
use tokio::process::Command;

use crate::types::Device;

pub fn get_adb_path() -> String {
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
