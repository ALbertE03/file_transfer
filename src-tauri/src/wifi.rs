use std::process::Command;

#[derive(serde::Serialize, Clone, Debug)]
pub struct WifiNetwork {
    pub ssid: String,
    pub bssid: String,
    pub rssi: String,
    pub channel: String,
    pub security: String,
}

fn get_airport_path() -> String {
    let path = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
    if std::path::Path::new(path).exists() {
        return path.to_string();
    }
    "airport".to_string()
}

#[tauri::command]
pub async fn scan_wifi_networks() -> Result<Vec<WifiNetwork>, String> {
    let airport = get_airport_path();
    let output = Command::new(&airport)
        .arg("-s")
        .output()
        .map_err(|e| format!("Failed to run airport scan: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut networks = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 5 {
            continue;
        }

        let mut bssid_idx = None;
        for (i, token) in tokens.iter().enumerate() {
            if token.len() == 17 && token.chars().filter(|&c| c == ':').count() == 5 {
                bssid_idx = Some(i);
                break;
            }
        }

        if let Some(idx) = bssid_idx {
            let ssid = tokens[..idx].join(" ");
            let bssid = tokens[idx].to_string();
            let rssi = tokens.get(idx + 1).unwrap_or(&"").to_string();
            let channel = tokens.get(idx + 2).unwrap_or(&"").to_string();
            let security = tokens.get(idx + 4..).map(|t| t.join(" ")).unwrap_or_default();

            networks.push(WifiNetwork {
                ssid,
                bssid,
                rssi,
                channel,
                security,
            });
        }
    }

    Ok(networks)
}

#[tauri::command]
pub async fn connect_to_wifi(ssid: String, password: String) -> Result<String, String> {
    let output = Command::new("networksetup")
        .arg("-listallhardwareports")
        .output()
        .map_err(|e| format!("Failed to list network interfaces: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut wifi_iface = None;
    let mut current_port = String::new();

    for line in stdout.lines() {
        if line.starts_with("Hardware Port:") {
            current_port = line.trim_start_matches("Hardware Port:").trim().to_string();
        }
        if line.starts_with("Device:") {
            if current_port.contains("Wi-Fi") || current_port.contains("AirPort") {
                wifi_iface = Some(line.trim_start_matches("Device:").trim().to_string());
                break;
            }
        }
    }

    let iface = wifi_iface.ok_or_else(|| "No se encontró interfaz WiFi en el sistema".to_string())?;

    let output = Command::new("networksetup")
        .arg("-setairportnetwork")
        .arg(&iface)
        .arg(&ssid)
        .arg(&password)
        .output()
        .map_err(|e| format!("Error al conectar a WiFi: {}", e))?;

    if output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Error") || stderr.contains("not find") || stderr.contains("Failed") {
            return Err(format!("Error al conectar a '{}': {}", ssid, stderr));
        }
        Ok(format!("Conectado a '{}' correctamente", ssid))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Error al conectar a '{}': {}", ssid, stderr))
    }
}
