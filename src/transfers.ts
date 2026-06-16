import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgressPayload } from "./types";
import {
  selectedLocalPaths, selectedRemotePaths, selectedDeviceSerial, localPath, remotePath,
  btnPushEl, btnPullEl,
  progressOverlayEl, progressTitleEl, progressCountEl, progressFileEl, progressFillEl, progressPercentEl, progressSpeedEl,
} from "./state";
import { loadLocalFiles } from "./local";
import { loadRemoteFiles } from "./remote";

export async function setupProgressChannel() {
  await listen<ProgressPayload>("transfer-progress", (event) => {
    const payload = event.payload;

    if (payload.status === "running") {
      progressOverlayEl.style.display = "block";
      progressTitleEl.textContent = payload.total > 1 ? "Transferring files..." : "Transferring file...";
      progressCountEl.textContent = `${payload.index} / ${payload.total}`;
      progressFileEl.textContent = payload.current_file;
      progressFillEl.style.width = `${payload.percentage}%`;
      progressPercentEl.textContent = `${payload.percentage}%`;
      progressSpeedEl.textContent = payload.speed ? `Speed: ${payload.speed}` : "";
    } else if (payload.status === "file_ok") {
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
      progressCountEl.textContent = `${payload.index} / ${payload.total}`;
    } else if (payload.status === "file_error") {
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
      console.error("File error:", payload.error_message);
    } else if (payload.status === "completed") {
      progressOverlayEl.style.display = "none";
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
      if (payload.error_message) {
        alert(`Transfer completed with errors:\n${payload.error_message}`);
      }
    } else if (payload.status === "error") {
      progressOverlayEl.style.display = "none";
      alert(`Transfer Error:\n${payload.error_message}`);
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
    }
  });
}

export async function handlePush() {
  if (selectedLocalPaths.size === 0 || !selectedDeviceSerial) return;
  const sources = Array.from(selectedLocalPaths);
  const dest = remotePath;

  try {
    btnPushEl.disabled = true;
    btnPullEl.disabled = true;

    await invoke("copy_files", {
      app: null,
      deviceId: selectedDeviceSerial,
      direction: "push",
      sources,
      destination: dest
    });
  } catch (err) {
    console.error("Push invocation error:", err);
  } finally {
    btnPushEl.disabled = false;
    btnPullEl.disabled = false;
  }
}

export async function handlePull() {
  if (selectedRemotePaths.size === 0 || !selectedDeviceSerial) return;
  const sources = Array.from(selectedRemotePaths);
  const dest = localPath;

  try {
    btnPushEl.disabled = true;
    btnPullEl.disabled = true;

    await invoke("copy_files", {
      app: null,
      deviceId: selectedDeviceSerial,
      direction: "pull",
      sources,
      destination: dest
    });
  } catch (err) {
    console.error("Pull invocation error:", err);
  } finally {
    btnPushEl.disabled = false;
    btnPullEl.disabled = false;
  }
}
