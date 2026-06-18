import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgressPayload, QueueItem } from "./types";
import {
  selectedLocalPaths, selectedRemotePaths, selectedDeviceSerial, localPath, remotePath,
  btnPushEl, btnPullEl,
  localProgressEl, localProgressCountEl, localProgressListEl,
  remoteProgressEl, remoteProgressCountEl, remoteProgressListEl,
} from "./state";
import { loadLocalFiles } from "./local";
import { loadRemoteFiles } from "./remote";


let pushQueue: QueueItem[] = [];
let pullQueue: QueueItem[] = [];
let pushRunning = 0;
let pullRunning = 0;
const MAX_CONCURRENT = 5;

function getFileName(item: QueueItem): string {
  return item.source.split("/").pop() || item.source;
}

function getQueue(dir: "push" | "pull"): QueueItem[] {
  return dir === "push" ? pushQueue : pullQueue;
}

function getPaneEl(dir: "push" | "pull") {
  if (dir === "push") return { el: remoteProgressEl, count: remoteProgressCountEl, list: remoteProgressListEl };
  return { el: localProgressEl, count: localProgressCountEl, list: localProgressListEl };
}

function closePanesIfIdle() {
  const remaining = pushQueue.filter(i => i.status === "pending" || i.status === "running").length +
    pullQueue.filter(i => i.status === "pending" || i.status === "running").length;
  if (remaining > 0) return;

  const hide = (dir: "push" | "pull") => {
    const p = getPaneEl(dir);
    const q = getQueue(dir);
    if (q.every(i => i.status === "completed" || i.status === "cancelled" || i.status === "error")) {
      p.el.hidden = true;
      p.list.innerHTML = "";
      q.length = 0;
    }
  };
  hide("push");
  hide("pull");

  pushRunning = 0;
  pullRunning = 0;
  invoke("clear_tracking").catch(() => { });
  loadLocalFiles(localPath, true);
  loadRemoteFiles(remotePath, true);
}

async function expandItems(items: string[], direction: "push" | "pull", destBase: string): Promise<{ source: string, destPath: string }[]> {
  const result: { source: string, destPath: string }[] = [];
  for (const item of items) {
    const itemName = item.split("/").pop() || item;
    const isDir = direction === "push"
      ? await invoke<boolean>("is_local_dir", { path: item })
      : await invoke<boolean>("is_remote_dir", { deviceId: selectedDeviceSerial, path: item });

    if (isDir) {
      const files = direction === "push"
        ? await invoke<string[]>("list_local_files_recursive", { path: item })
        : await invoke<string[]>("list_remote_files_recursive", { deviceId: selectedDeviceSerial, path: item });

      if (files.length === 0) {
        result.push({ source: item, destPath: `${destBase}/${itemName}` });
        continue;
      }
      const base = item.replace(/\/$/, '');
      for (const file of files) {
        const rel = file.startsWith(base + '/') ? file.slice(base.length + 1) : file;
        result.push({ source: file, destPath: `${destBase}/${itemName}/${rel}` });
      }
    } else {
      result.push({ source: item, destPath: `${destBase}/${itemName}` });
    }
  }
  return result;
}

async function ensureParentDir(destPath: string, direction: "push" | "pull") {
  const parent = destPath.substring(0, destPath.lastIndexOf('/'));
  if (!parent) return;
  if (direction === "push") {
    await invoke("create_remote_directory", { deviceId: selectedDeviceSerial, path: parent });
  } else {
    await invoke("create_local_directory", { path: parent });
  }
}

function createRow(file: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "progress-row";
  row.dataset.file = file;

  const header = document.createElement("div");
  header.className = "progress-row-header";

  const dot = document.createElement("span");
  dot.className = "progress-row-status-dot";

  const nameSpan = document.createElement("span");
  nameSpan.className = "progress-row-file";
  nameSpan.textContent = file;

  const statusSpan = document.createElement("span");
  statusSpan.className = "progress-row-status";
  statusSpan.textContent = "Queued";

  const btnGroup = document.createElement("span");
  btnGroup.className = "progress-row-btns";

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "btn-row-pause";
  pauseBtn.title = "Pause";
  pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-row-cancel";
  cancelBtn.title = "Cancel";
  cancelBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

  btnGroup.appendChild(pauseBtn);
  btnGroup.appendChild(cancelBtn);

  header.appendChild(dot);
  header.appendChild(nameSpan);
  header.appendChild(statusSpan);
  header.appendChild(btnGroup);
  row.appendChild(header);

  const track = document.createElement("div");
  track.className = "progress-row-track";
  const fill = document.createElement("div");
  fill.className = "progress-row-fill";
  track.appendChild(fill);
  row.appendChild(track);

  return row;
}

function findItem(file: string): QueueItem | undefined {
  return [...pushQueue, ...pullQueue].find(i => getFileName(i) === file);
}

function togglePauseItem(item: QueueItem) {
  if (item.status === "pending") item.status = "paused";
  else if (item.status === "paused") {
    item.status = "pending";
    invoke("resume_file", { fileName: getFileName(item) }).catch(() => { });
    if (item.direction === "push") pushRunning++;
    else pullRunning++;
    processOne(item);
  } else if (item.status === "running") {
    item.status = "paused";
    invoke("pause_file", { fileName: getFileName(item) }).catch(() => { });
  }
  refreshPaneUI(item.direction);
  closePanesIfIdle();
}

function cancelItem(item: QueueItem) {
  const fname = getFileName(item);
  if (item.status === "pending" || item.status === "paused") item.status = "cancelled";
  else if (item.status === "running") {
    item.status = "cancelled";
    invoke("cancel_file", { fileName: fname }).catch(() => { });
  }
  refreshPaneUI(item.direction);
  closePanesIfIdle();
}

function updateRow(file: string, pct: number) {
  const item = findItem(file);
  if (!item) return;
  const p = getPaneEl(item.direction);
  const row = p.list.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  if (fill) fill.style.width = `${pct}%`;
  if (status) status.textContent = `${pct}%`;
  item.lastPct = pct;
}

function markRowDone(file: string) {
  const item = findItem(file);
  if (!item) return;
  const p = getPaneEl(item.direction);
  const row = p.list.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  const dot = row.querySelector(".progress-row-status-dot") as HTMLElement;
  if (fill) { fill.style.width = "100%"; fill.classList.add("ok"); }
  if (status) status.textContent = "Done";
  if (dot) dot.className = "progress-row-status-dot ok";
}

function markRowItem(file: string, label: string) {
  const item = findItem(file);
  if (!item) return;
  const p = getPaneEl(item.direction);
  const row = p.list.querySelector(`[data-file="${CSS.escape(file)}"]`) as HTMLElement;
  if (!row) return;
  const fill = row.querySelector(".progress-row-fill") as HTMLElement;
  const status = row.querySelector(".progress-row-status") as HTMLElement;
  const dot = row.querySelector(".progress-row-status-dot") as HTMLElement;
  const isCancelled = label.includes("Cancelled");
  if (fill) fill.classList.add(isCancelled ? "cancelled" : "error");
  if (dot) dot.className = `progress-row-status-dot ${isCancelled ? "cancelled" : "error"}`;
  if (status) { status.textContent = isCancelled ? "Cancelled" : "Error"; status.className = "progress-row-status cancelled"; }
}

function updateCount(q: QueueItem[], countEl: HTMLElement) {
  const total = q.length;
  const done = q.filter(i => i.status === "completed" || i.status === "cancelled" || i.status === "error").length;
  countEl.textContent = `${done} / ${total}`;
}

function refreshPaneUI(dir: "push" | "pull") {
  const q = getQueue(dir);
  const p = getPaneEl(dir);

  if (q.length === 0) { p.el.hidden = true; return; }
  p.el.hidden = false;

  p.list.innerHTML = "";
  q.forEach(item => {
    const name = getFileName(item);
    const row = createRow(name);
    row.dataset.file = name;
    p.list.appendChild(row);

    const fill = row.querySelector(".progress-row-fill") as HTMLElement;
    const status = row.querySelector(".progress-row-status") as HTMLElement;
    const dot = row.querySelector(".progress-row-status-dot") as HTMLElement;
    const pauseBtn = row.querySelector(".btn-row-pause") as HTMLElement;
    const cancelBtn = row.querySelector(".btn-row-cancel") as HTMLElement;

    pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePauseItem(item); });
    cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); cancelItem(item); });

    const setDot = (cls: string) => { if (dot) dot.className = `progress-row-status-dot${cls ? ' ' + cls : ''}`; };
    const hideBtns = () => { if (pauseBtn) pauseBtn.style.display = "none"; if (cancelBtn) cancelBtn.style.display = "none"; };

    if (item.status === "pending") {
      setDot("");
      if (status) status.textContent = "Queued";
      if (pauseBtn) { pauseBtn.dataset.active = "true"; pauseBtn.title = "Pause"; }
    } else if (item.status === "paused") {
      setDot("paused");
      if (status) { status.textContent = "Paused"; status.className = "progress-row-status pending"; }
      if (fill) fill.style.width = `${Math.max(item.lastPct, 0)}%`;
      if (pauseBtn) { pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`; pauseBtn.title = "Resume"; pauseBtn.dataset.active = "true"; }
    } else if (item.status === "running") {
      setDot("");
      if (status) status.textContent = `${item.lastPct || 0}%`;
      if (fill) fill.style.width = `${item.lastPct || 0}%`;
      if (pauseBtn) { pauseBtn.dataset.active = "true"; pauseBtn.title = "Pause"; }
    } else if (item.status === "completed") {
      setDot("ok");
      if (fill) { fill.style.width = "100%"; fill.classList.add("ok"); }
      if (status) status.textContent = "Done";
      hideBtns();
    } else if (item.status === "error") {
      setDot("error");
      if (fill) fill.classList.add("error");
      if (status) status.textContent = "Error";
      hideBtns();
    } else if (item.status === "cancelled") {
      setDot("cancelled");
      if (fill) fill.classList.add("cancelled");
      if (status) { status.textContent = "Cancelled"; status.className = "progress-row-status cancelled"; }
      hideBtns();
    }
  });
  updateCount(q, p.count);
}

export async function enqueueTransfer(sources: string[], destination: string, direction: "push" | "pull") {
  if (sources.length === 0 || !selectedDeviceSerial) return;

  const expanded = await expandItems(sources, direction, destination);
  const q = getQueue(direction);
  for (const { source, destPath } of expanded) {
    q.push({ source, destPath, deviceId: selectedDeviceSerial!, direction, status: "pending", lastPct: 0 });
  }
  refreshPaneUI(direction);
  scheduleNext();
}

async function processOne(item: QueueItem) {
  item.status = "running";
  refreshPaneUI(item.direction);

  const isPush = item.direction === "push";
  try {
    if (isPush) btnPushEl.disabled = true;
    else btnPullEl.disabled = true;

    await ensureParentDir(item.destPath, item.direction);

    await invoke("copy_files", {
      deviceId: item.deviceId,
      direction: item.direction,
      sources: [item.source],
      destPaths: [item.destPath],
    });

    if (item.status === "running") item.status = "completed";
  } catch (err) {
    if (item.status === "running") {
      const msg = String(err);
      if (msg.includes("Paused")) {
        item.status = "paused";
      } else if (msg.includes("Cancelled")) {
        item.status = "cancelled";
      } else {
        item.status = "error";
      }
    }
  } finally {
    if (isPush) btnPushEl.disabled = false;
    else btnPullEl.disabled = false;
    if (isPush) pushRunning--;
    else pullRunning--;
  }

  refreshPaneUI(item.direction);
  scheduleNext();
  closePanesIfIdle();
}

function scheduleNext() {
  for (const dir of ["push", "pull"] as const) {
    const q = getQueue(dir);
    while (true) {
      const r = dir === "push" ? pushRunning : pullRunning;
      if (r >= MAX_CONCURRENT) break;
      const next = q.find(i => i.status === "pending");
      if (!next) break;
      if (dir === "push") pushRunning++;
      else pullRunning++;
      processOne(next);
    }
  }
}

export async function setupProgressChannel() {
  await listen<ProgressPayload>("transfer-progress", (event) => {
    const p = event.payload;
    if (p.status === "running") {
      updateRow(p.current_file, p.percentage);
    } else if (p.status === "file_ok") {
      const item = findItem(p.current_file);
      if (item) item.status = "completed";
      markRowDone(p.current_file);
    } else if (p.status === "paused") {
      const item = findItem(p.current_file);
      if (!item) return;
      item.status = "paused";
      const pane = getPaneEl(item.direction);
      const row = pane.list.querySelector(`[data-file="${CSS.escape(p.current_file)}"]`) as HTMLElement;
      if (row) {
        const status = row.querySelector(".progress-row-status") as HTMLElement;
        if (status) { status.textContent = "⏸ Paused"; status.className = "progress-row-status pending"; }
      }
    } else if (p.status === "file_error") {
      const msg = p.error_message || "";
      const item = findItem(p.current_file);
      if (item) item.status = msg.startsWith("Cancelled:") ? "cancelled" : "error";
      markRowItem(p.current_file, msg.startsWith("Cancelled:") ? "✕ Cancelled" : "❌");
    }
  });
}

export async function handlePush() {
  if (selectedLocalPaths.size === 0 || !selectedDeviceSerial) return;
  await enqueueTransfer(Array.from(selectedLocalPaths), remotePath, "push");
}

export async function handlePull() {
  if (selectedRemotePaths.size === 0 || !selectedDeviceSerial) return;
  await enqueueTransfer(Array.from(selectedRemotePaths), localPath, "pull");
}
