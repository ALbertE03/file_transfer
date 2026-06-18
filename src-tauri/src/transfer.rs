use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt, AsyncSeekExt, SeekFrom};
use tokio::process::{Child, Command};
use tauri::{AppHandle, Emitter};

use crate::adb::get_adb_path;
use crate::types::ProgressPayload;

const CHUNK_SIZE: usize = 8_388_608;

fn cancelled_set() -> &'static Mutex<Vec<String>> {
    static SET: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(Vec::new()))
}

fn paused_set() -> &'static Mutex<Vec<String>> {
    static SET: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(Vec::new()))
}

fn kill_map() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_kill_flag(file: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    kill_map().lock().unwrap().insert(file.to_string(), flag.clone());
    flag
}

fn unregister_kill_flag(file: &str) {
    kill_map().lock().unwrap().remove(file);
}

/// Signal a transfer to stop. Sets the flag so the loop picks it up on the
/// very next iteration (no need to wait for a chunk to finish).
fn signal_stop(file: &str) {
    if let Some(flag) = kill_map().lock().unwrap().get(file) {
        flag.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn cancel_file(file_name: String) {
    cancelled_set().lock().unwrap().push(file_name.clone());
    signal_stop(&file_name);
}

#[tauri::command]
pub fn pause_file(file_name: String) {
    paused_set().lock().unwrap().push(file_name.clone());
    signal_stop(&file_name);
}

#[tauri::command]
pub fn resume_file(file_name: String) {
    let mut set = paused_set().lock().unwrap();
    set.retain(|f| f != &file_name);
}

#[tauri::command]
pub fn clear_tracking() {
    cancelled_set().lock().unwrap().clear();
    paused_set().lock().unwrap().clear();
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
    String::from_utf8_lossy(&output.stdout).trim().parse::<u64>().ok()
}

async fn delete_remote_file(adb: &str, device_id: &str, path: &str) {
    let _ = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("shell")
        .arg(format!("rm -f {}", shell_escape(path)))
        .output()
        .await;
}

#[inline]
fn should_report(last_pct: u32, pct: u32) -> bool {
    pct != last_pct && (pct % 5 == 0 || pct == 100)
}

fn is_cancelled(file: &str) -> bool {
    cancelled_set().lock().unwrap().iter().any(|f| f == file)
}

fn is_paused(file: &str) -> bool {
    paused_set().lock().unwrap().iter().any(|f| f == file)
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
    let resume_offset = get_remote_file_size(adb, device_id, dest_path)
        .await
        .unwrap_or(0);
    let cmd = if resume_offset > 0 {
        format!("cat >> {}", shell_escape(dest_path))
    } else {
        format!("cat > {}", shell_escape(dest_path))
    };

    let mut child: Child = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("shell")
        .arg(&cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ADB: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("No stdin")?;
    let kill_flag = register_kill_flag(file_name);

    let mut file = tokio::fs::File::open(source)
        .await
        .map_err(|e| format!("Open '{}': {}", source, e))?;

    if resume_offset > 0 {
        file.seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|e| format!("Seek: {}", e))?;
    }

    let mut transferred = resume_offset;
    let mut last_pct = u32::MAX;
    let mut buf = vec![0u8; CHUNK_SIZE];

    let result = loop {
        if kill_flag.load(Ordering::SeqCst) {
            if is_cancelled(file_name) {
                let _ = child.kill().await;
                let _ = child.wait().await;
                delete_remote_file(adb, device_id, dest_path).await;
                break Err(format!("Cancelled: {}", file_name));
            }
            if is_paused(file_name) {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break Err(format!("Paused: {}", file_name));
            }
        }

        let n = match file.read(&mut buf).await {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(e) => break Err(format!("Read: {}", e)),
        };

        stdin
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write: {}", e))?;

        transferred += n as u64;
        let pct = (if file_size > 0 {
            (transferred * 100 / file_size) as u32
        } else {
            100
        })
        .min(100);
        if should_report(last_pct, pct) {
            last_pct = pct;
            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name.to_string(),
                    index: index + 1,
                    total,
                    percentage: pct,
                    speed: String::new(),
                    status: "running".to_string(),
                    error_message: None,
                },
            )
            .ok();
        }
    };

    unregister_kill_flag(file_name);
    drop(stdin);
    if result.is_ok() {
        let status = child
            .wait()
            .await
            .map_err(|e| format!("Wait: {}", e))?;
        if !status.success() {
            return Err(format!("Push failed '{}'", file_name));
        }
    }
    result
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
    let resume_offset = std::fs::metadata(dest_path).map(|m| m.len()).unwrap_or(0);
    let cmd = if resume_offset > 0 {
        format!("tail -c +{} {}", resume_offset + 1, shell_escape(source))
    } else {
        format!("cat {}", shell_escape(source))
    };

    let mut child = Command::new(adb)
        .arg("-s")
        .arg(device_id)
        .arg("exec-out")
        .arg(&cmd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ADB: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("No stdout")?;
    let kill_flag = register_kill_flag(file_name);

    let mut file = if resume_offset > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(dest_path)
            .await
            .map_err(|e| format!("Open '{}': {}", dest_path, e))?
    } else {
        tokio::fs::File::create(dest_path)
            .await
            .map_err(|e| format!("Create '{}': {}", dest_path, e))?
    };

    let mut transferred = resume_offset;
    let mut last_pct = u32::MAX;
    let mut buf = vec![0u8; CHUNK_SIZE];

    let result = loop {
        if kill_flag.load(Ordering::SeqCst) {
            if is_cancelled(file_name) {
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = tokio::fs::remove_file(dest_path).await;
                break Err(format!("Cancelled: {}", file_name));
            }
            if is_paused(file_name) {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break Err(format!("Paused: {}", file_name));
            }
        }

        let n = match stdout.read(&mut buf).await {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(e) => break Err(format!("Read ADB: {}", e)),
        };

        file.write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write '{}': {}", dest_path, e))?;

        transferred += n as u64;
        let pct = (if file_size > 0 {
            (transferred * 100 / file_size) as u32
        } else {
            100
        })
        .min(100);
        if should_report(last_pct, pct) {
            last_pct = pct;
            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name.to_string(),
                    index: index + 1,
                    total,
                    percentage: pct,
                    speed: String::new(),
                    status: "running".to_string(),
                    error_message: None,
                },
            )
            .ok();
        }
    };

    unregister_kill_flag(file_name);
    drop(file);
    if result.is_ok() {
        let status = child
            .wait()
            .await
            .map_err(|e| format!("Wait: {}", e))?;
        if !status.success() {
            return Err(format!("Pull failed '{}'", file_name));
        }
    }
    result
}

#[tauri::command]
pub async fn copy_files(
    app: AppHandle,
    device_id: String,
    direction: String,
    sources: Vec<String>,
    dest_paths: Vec<String>,
) -> Result<(), String> {
    let adb = get_adb_path();
    let total = sources.len();
    let mut join_set = tokio::task::JoinSet::new();

    for (index, source) in sources.iter().enumerate() {
        let file_name = Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| source.clone());
        let dest_path = dest_paths[index].clone();
        let size = if direction == "push" {
            std::fs::metadata(source).map(|m| m.len()).unwrap_or(0)
        } else {
            get_remote_file_size(&adb, &device_id, source)
                .await
                .unwrap_or(0)
        };

        let adb = adb.clone();
        let device_id = device_id.clone();
        let direction = direction.clone();
        let source = source.clone();
        let file_name = file_name.clone();
        let app = app.clone();

        join_set.spawn(async move {
            let result = if direction == "push" {
                push_file(
                    &adb, &device_id, &source, &dest_path, &app, index, total, &file_name, size,
                )
                .await
            } else {
                pull_file(
                    &adb, &device_id, &source, &dest_path, &app, index, total, &file_name, size,
                )
                .await
            };
            let status = match &result {
                Ok(_) => "file_ok",
                Err(e) => {
                    if e.starts_with("Paused:") {
                        "paused"
                    } else {
                        "file_error"
                    }
                }
            };
            app.emit(
                "transfer-progress",
                ProgressPayload {
                    current_file: file_name,
                    index: index + 1,
                    total,
                    percentage: 0,
                    speed: String::new(),
                    status: status.to_string(),
                    error_message: result.as_ref().err().cloned(),
                },
            )
            .ok();
            result
        });
    }

    let mut final_result: Result<(), String> = Ok(());
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(inner) => {
                if let Err(e) = inner {
                    if final_result.is_ok() {
                        final_result = Err(e);
                    }
                }
            }
            Err(e) => {
                if final_result.is_ok() {
                    final_result = Err(format!("Task failed: {}", e));
                }
            }
        }
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
    final_result
}
