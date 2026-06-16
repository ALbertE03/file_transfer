import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgressPayload } from "./types";
import {
  selectedLocalPaths, selectedRemotePaths, selectedDeviceSerial, localPath, remotePath,
  btnPushEl, btnPullEl,
  progressOverlayEl, progressCountEl, progressListEl,
} from "./state";
import { loadLocalFiles } from "./local";
import { loadRemoteFiles } from "./remote";

let activeTransfers = new Map<string, "push" | "pull">();

function createRow(file: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "progress-row";
  row.dataset.file = file;

  const header = document.createElement("div");
  header.className = "progress-row-header";

  const nameSpan = document.createElement("span");
  nameSpan.className = "progress-row-file";
  nameSpan.textContent = file;

  const statusSpan = document.createElement("span");
  statusSpan.className = "progress-row-status";
  statusSpan.textContent = "0%";

  header.appendChild(nameSpan);
  header.appendChild(statusSpan);

  const track = document.createElement("div");
  track.className = "progress-row-track";

  const fill = document.createElement("div");
  fill.className = "progress-row-fill";

  track.appendChild(fill);
  row.appendChild(header);
  row.appendChild(track);

  return row;
}

function updateRow(file: string, pct: number, speed?: string) {
  const row = progressListEl.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  if (fill) fill.style.width = `${pct}%`;
  if (status) status.textContent = speed ? `${pct}% · ${speed}` : `${pct}%`;
}

function markRowDone(file: string) {
  const row = progressListEl.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  if (fill) { fill.style.width = "100%"; fill.classList.add("ok"); }
  if (status) status.textContent = "✅";
}

function markRowError(file: string) {
  const row = progressListEl.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  if (fill) { fill.classList.add("error"); }
  if (status) status.textContent = "❌";
}

export async function setupProgressChannel() {
  await listen<ProgressPayload>("transfer-progress", (event) => {
    const p = event.payload;
    const dir = activeTransfers.get(p.current_file) || "push";

    if (p.status === "running") {
      progressOverlayEl.style.display = "block";
      if (!progressListEl.querySelector(`[data-file="${CSS.escape(p.current_file)}"]`)) {
        activeTransfers.set(p.current_file, dir);
        progressListEl.appendChild(createRow(p.current_file));
      }
      progressCountEl.textContent = `${p.index} / ${p.total}`;
      updateRow(p.current_file, p.percentage, p.speed);
    } else if (p.status === "file_ok") {
      markRowDone(p.current_file);
      progressCountEl.textContent = `${p.index} / ${p.total}`;
      if (dir === "push") loadRemoteFiles(remotePath, true);
      else loadLocalFiles(localPath, true);
      activeTransfers.delete(p.current_file);
    } else if (p.status === "file_error") {
      markRowError(p.current_file);
      progressCountEl.textContent = `${p.index} / ${p.total}`;
      console.error("File error:", p.error_message);
      if (dir === "push") loadRemoteFiles(remotePath, true);
      else loadLocalFiles(localPath, true);
      activeTransfers.delete(p.current_file);
    } else if (p.status === "completed") {
      progressOverlayEl.style.display = "none";
      progressListEl.innerHTML = "";
      activeTransfers.clear();
      loadLocalFiles(localPath, true);
      loadRemoteFiles(remotePath, true);
      if (p.error_message) {
        setTimeout(() => alert(`Transfer completed with errors:\n${p.error_message}`), 100);
      }
    } else if (p.status === "error") {
      progressOverlayEl.style.display = "none";
      progressListEl.innerHTML = "";
      activeTransfers.clear();
      alert(`Transfer Error:\n${p.error_message}`);
      loadLocalFiles(localPath, true);
      loadRemoteFiles(remotePath, true);
    }
  });
}

export async function handlePush() {
  if (selectedLocalPaths.size === 0 || !selectedDeviceSerial) return;
  const sources = Array.from(selectedLocalPaths);
  const dest = remotePath;

  sources.forEach(s => {
    const name = s.split("/").pop() || s;
    activeTransfers.set(name, "push");
  });

  try {
    btnPushEl.disabled = true;
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
  }
}

export async function handlePull() {
  if (selectedRemotePaths.size === 0 || !selectedDeviceSerial) return;
  const sources = Array.from(selectedRemotePaths);
  const dest = localPath;

  sources.forEach(s => {
    const name = s.split("/").pop() || s;
    activeTransfers.set(name, "pull");
  });

  try {
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
    btnPullEl.disabled = false;
  }
}
