import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Device, LocalFile, RemoteFile, ProgressPayload, DiskInfo } from "./interfaces";


// App State
let localPath = "";
let remotePath = "";
let selectedDeviceSerial = "";
let devices: Device[] = [];

let localFiles: LocalFile[] = [];
let remoteFiles: RemoteFile[] = [];

const selectedLocalPaths = new Set<string>();
const selectedRemotePaths = new Set<string>();


// DOM Elements
let deviceSelectEl: HTMLSelectElement;
let statusBadgeEl: HTMLElement;
let statusTextEl: HTMLElement;
let btnRefreshEl: HTMLButtonElement;
let btnWifiEl: HTMLButtonElement;

let localPathInputEl: HTMLInputElement;
let localUpBtnEl: HTMLButtonElement;
let localFileListEl: HTMLTableSectionElement;
let localSelectionInfoEl: HTMLElement;
let localBreadcrumbsEl: HTMLElement;

let localDrivesEl: HTMLElement;

let remotePathInputEl: HTMLInputElement;
let remoteUpBtnEl: HTMLButtonElement;
let remoteFileListEl: HTMLTableSectionElement;
let remoteSelectionInfoEl: HTMLElement;
let remoteBreadcrumbsEl: HTMLElement;

let remoteDrivesEl: HTMLElement;

let btnPushEl: HTMLButtonElement;
let btnPullEl: HTMLButtonElement;

let onboardingOverlayEl: HTMLElement;
let progressOverlayEl: HTMLElement;
let progressTitleEl: HTMLElement;
let progressCountEl: HTMLElement;
let progressFileEl: HTMLElement;
let progressFillEl: HTMLElement;
let progressPercentEl: HTMLElement;

// Pane Action Elements
let btnLocalNewFolder: HTMLButtonElement;
let btnLocalRename: HTMLButtonElement;
let btnLocalDelete: HTMLButtonElement;

let btnRemoteNewFolder: HTMLButtonElement;
let btnRemoteRename: HTMLButtonElement;
let btnRemoteDelete: HTMLButtonElement;

// Init App
window.addEventListener("DOMContentLoaded", async () => {
  // Query Elements
  deviceSelectEl = document.querySelector("#device-select") as HTMLSelectElement;
  statusBadgeEl = document.querySelector("#status-badge") as HTMLElement;
  statusTextEl = document.querySelector("#status-text") as HTMLElement;
  btnRefreshEl = document.querySelector("#btn-refresh") as HTMLButtonElement;
  btnWifiEl = document.querySelector("#btn-wifi") as HTMLButtonElement;

  localPathInputEl = document.querySelector("#local-path-input") as HTMLInputElement;
  localUpBtnEl = document.querySelector("#local-up-btn") as HTMLButtonElement;
  localFileListEl = document.querySelector("#local-file-list") as HTMLTableSectionElement;
  localSelectionInfoEl = document.querySelector("#local-selection-info") as HTMLElement;
  localBreadcrumbsEl = document.querySelector("#local-breadcrumbs") as HTMLElement;
  localDrivesEl = document.querySelector("#local-drives") as HTMLElement;

  remotePathInputEl = document.querySelector("#remote-path-input") as HTMLInputElement;
  remoteUpBtnEl = document.querySelector("#remote-up-btn") as HTMLButtonElement;
  remoteFileListEl = document.querySelector("#remote-file-list") as HTMLTableSectionElement;
  remoteSelectionInfoEl = document.querySelector("#remote-selection-info") as HTMLElement;
  remoteBreadcrumbsEl = document.querySelector("#remote-breadcrumbs") as HTMLElement;
  remoteDrivesEl = document.querySelector("#remote-drives") as HTMLElement;

  btnPushEl = document.querySelector("#btn-push") as HTMLButtonElement;
  btnPullEl = document.querySelector("#btn-pull") as HTMLButtonElement;

  onboardingOverlayEl = document.querySelector("#onboarding-overlay") as HTMLElement;
  progressOverlayEl = document.querySelector("#progress-overlay") as HTMLElement;
  progressTitleEl = document.querySelector("#progress-title") as HTMLElement;
  progressCountEl = document.querySelector("#progress-count") as HTMLElement;
  progressFileEl = document.querySelector("#progress-file") as HTMLElement;
  progressFillEl = document.querySelector("#progress-fill") as HTMLElement;
  progressPercentEl = document.querySelector("#progress-percent") as HTMLElement;

  btnLocalNewFolder = document.querySelector("#btn-local-new-folder") as HTMLButtonElement;
  btnLocalRename = document.querySelector("#btn-local-rename") as HTMLButtonElement;
  btnLocalDelete = document.querySelector("#btn-local-delete") as HTMLButtonElement;

  btnRemoteNewFolder = document.querySelector("#btn-remote-new-folder") as HTMLButtonElement;
  btnRemoteRename = document.querySelector("#btn-remote-rename") as HTMLButtonElement;
  btnRemoteDelete = document.querySelector("#btn-remote-delete") as HTMLButtonElement;

  // Bind Events
  btnRefreshEl.addEventListener("click", refreshDevices);
  btnWifiEl.addEventListener("click", showWifiConnectionModal);
  deviceSelectEl.addEventListener("change", handleDeviceSelectionChange);

  localPathInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadLocalFiles(localPathInputEl.value);
  });
  localUpBtnEl.addEventListener("click", navigateLocalUp);

  remotePathInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadRemoteFiles(remotePathInputEl.value);
  });
  remoteUpBtnEl.addEventListener("click", navigateRemoteUp);

  // Bind Local Footer Actions
  btnLocalNewFolder.addEventListener("click", () => showCreateFolderModal(true));
  btnLocalRename.addEventListener("click", () => showRenameModal(true));
  btnLocalDelete.addEventListener("click", () => showDeleteConfirmModal(true));

  // Bind Remote Footer Actions
  btnRemoteNewFolder.addEventListener("click", () => showCreateFolderModal(false));
  btnRemoteRename.addEventListener("click", () => showRenameModal(false));
  btnRemoteDelete.addEventListener("click", () => showDeleteConfirmModal(false));
  // pull and push
  btnPushEl.addEventListener('click', () => handlePush())
  btnPullEl.addEventListener('click', () => handlePull())
  // Bind Path Edit Toggling
  setupPathEditing(true);
  setupPathEditing(false);

  // Register Tauri Event Listeners
  setupProgressChannel();

  // Load initial configurations
  try {
    const [localHome, remoteHome] = await invoke<[string, string]>("get_home_directories");
    localPath = localHome;
    remotePath = remoteHome;

    localPathInputEl.value = localPath;
    remotePathInputEl.value = remotePath;

    // Load local list first
    await loadLocalFiles(localPath);
    // Refresh connected devices list
    await refreshDevices();
  } catch (err) {
    console.error("Initialization error:", err);
  }
});

// Setup Tauri transfer progress listener
async function setupProgressChannel() {
  await listen<ProgressPayload>("transfer-progress", (event) => {
    const payload = event.payload;

    if (payload.status === "running") {
      progressOverlayEl.style.display = "block";
      progressTitleEl.textContent = payload.total > 1 ? "Transferring files..." : "Transferring file...";
      progressCountEl.textContent = `${payload.index} / ${payload.total}`;
      progressFileEl.textContent = payload.current_file;
      progressFillEl.style.width = `${payload.percentage}%`;
      progressPercentEl.textContent = `${payload.percentage}%`;
    } else if (payload.status === "completed") {
      progressOverlayEl.style.display = "none";
      // Refresh listings
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
    } else if (payload.status === "error") {
      progressOverlayEl.style.display = "none";
      alert(`Transfer Error:\n${payload.error_message}`);
      // Refresh listings
      loadLocalFiles(localPath);
      loadRemoteFiles(remotePath);
    }
  });
}

// Device Management
async function refreshDevices() {
  try {
    devices = await invoke<Device[]>("get_adb_devices");

    // Clear list
    deviceSelectEl.innerHTML = "";

    if (devices.length === 0) {
      statusBadgeEl.className = "status-badge disconnected";
      statusTextEl.textContent = "Disconnected";
      onboardingOverlayEl.style.display = "flex";
      selectedDeviceSerial = "";
      remoteFileListEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No devices connected</td></tr>';
      updateActionStates();
      return;
    }

    // Add options
    devices.forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = dev.serial;
      opt.textContent = `${dev.model} (${dev.serial})`;
      if (dev.serial === selectedDeviceSerial) {
        opt.selected = true;
      }
      deviceSelectEl.appendChild(opt);
    });

    // Pick first device if none selected or the selected one vanished
    const stillExists = devices.some(d => d.serial === selectedDeviceSerial);
    if (!stillExists) {
      selectedDeviceSerial = devices[0].serial;
    }

    const currentDevice = devices.find(d => d.serial === selectedDeviceSerial)!;

    if (currentDevice.status === "device") {
      statusBadgeEl.className = "status-badge connected";
      statusTextEl.textContent = "Connected";
      onboardingOverlayEl.style.display = "none";
      await loadRemoteFiles(remotePath);
    } else if (currentDevice.status === "unauthorized") {
      statusBadgeEl.className = "status-badge unauthorized";
      statusTextEl.textContent = "Unauthorized";
      onboardingOverlayEl.style.display = "none";
      remoteFileListEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--warning);">Device unauthorized. Please accept authorization prompt on Android screen.</td></tr>';
    } else {
      statusBadgeEl.className = "status-badge disconnected";
      statusTextEl.textContent = currentDevice.status;
      onboardingOverlayEl.style.display = "none";
      remoteFileListEl.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Device status: ${currentDevice.status}</td></tr>`;
    }
    updateActionStates();
  } catch (err) {
    console.error("Failed to load devices:", err);
  }
}

async function handleDeviceSelectionChange() {
  selectedDeviceSerial = deviceSelectEl.value;
  await refreshDevices();
}

// Local File Exploration
async function loadLocalFiles(path: string) {
  try {
    const list = await invoke<LocalFile[]>("list_local_files", { path });
    localFiles = list;
    localPath = path;
    localPathInputEl.value = path;
    selectedLocalPaths.clear();
    renderLocalTable();
    updateActionStates();
    renderBreadcrumbs(path, localBreadcrumbsEl, true);
    loadLocalDisks();
  } catch (err) {
    alert(`Failed to list local directory:\n${err}`);
  }
}

function renderLocalTable() {
  localFileListEl.innerHTML = "";

  if (localFiles.length === 0) {
    localFileListEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Empty folder</td></tr>';
    return;
  }

  localFiles.forEach((file) => {
    const tr = document.createElement("tr");
    tr.dataset.path = file.path;
    tr.dataset.isDir = String(file.is_dir);

    // Double click to enter directory
    tr.addEventListener("dblclick", () => {
      if (file.is_dir) {
        loadLocalFiles(file.path);
      }
    });

    // Click to select
    tr.addEventListener("click", () => {
      // Toggle select
      const isSelected = selectedLocalPaths.has(file.path);
      if (isSelected) {
        selectedLocalPaths.delete(file.path);
        tr.classList.remove("selected");
        const chk = tr.querySelector("input") as HTMLInputElement;
        if (chk) chk.checked = false;
      } else {
        selectedLocalPaths.add(file.path);
        tr.classList.add("selected");
        const chk = tr.querySelector("input") as HTMLInputElement;
        if (chk) chk.checked = true;
      }
      updateActionStates();
    });

    const chkCol = document.createElement("td");
    chkCol.className = "col-checkbox";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = selectedLocalPaths.has(file.path);
    // Prevent checkbox click from double triggering click handler
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      const isChecked = chk.checked;
      if (isChecked) {
        selectedLocalPaths.add(file.path);
        tr.classList.add("selected");
      } else {
        selectedLocalPaths.delete(file.path);
        tr.classList.remove("selected");
      }
      updateActionStates();
    });
    chkCol.appendChild(chk);

    const nameCol = document.createElement("td");
    nameCol.className = "col-name";

    const nameDiv = document.createElement("div");
    nameDiv.className = "file-item-name";

    // SVG Icons
    const iconSvg = file.is_dir ? getFolderIcon() : getFileIcon();
    nameDiv.innerHTML = iconSvg;

    const spanName = document.createElement("span");
    spanName.textContent = file.name;
    nameDiv.appendChild(spanName);
    nameCol.appendChild(nameDiv);

    const sizeCol = document.createElement("td");
    sizeCol.className = "col-size";
    sizeCol.textContent = file.is_dir ? "--" : formatBytes(file.size);

    const dateCol = document.createElement("td");
    dateCol.className = "col-modified";
    dateCol.textContent = file.modified || "--";

    tr.appendChild(chkCol);
    tr.appendChild(nameCol);
    tr.appendChild(sizeCol);
    tr.appendChild(dateCol);

    localFileListEl.appendChild(tr);
  });
}

function navigateLocalUp() {
  if (!localPath || localPath === "/") return;
  const parts = localPath.split("/");
  parts.pop();
  let parent = parts.join("/");
  if (!parent) parent = "/";
  loadLocalFiles(parent);
}

// Remote File Exploration
async function loadRemoteFiles(path: string) {
  if (!selectedDeviceSerial) return;
  try {
    const list = await invoke<RemoteFile[]>("list_remote_files", {
      deviceId: selectedDeviceSerial,
      path
    });
    remoteFiles = list;
    remotePath = path;
    remotePathInputEl.value = path;
    selectedRemotePaths.clear();
    renderRemoteTable();
    updateActionStates();
    renderBreadcrumbs(path, remoteBreadcrumbsEl, false);
    loadRemoteDisks();
  } catch (err) {
    alert(`Failed to list remote directory:\n${err}`);
  }
}

function renderRemoteTable() {
  remoteFileListEl.innerHTML = "";

  if (remoteFiles.length === 0) {
    remoteFileListEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Empty folder</td></tr>';
    return;
  }

  remoteFiles.forEach((file) => {
    const tr = document.createElement("tr");
    tr.dataset.path = file.path;
    tr.dataset.isDir = String(file.is_dir);

    // Double click to enter directory
    tr.addEventListener("dblclick", () => {
      if (file.is_dir) {
        loadRemoteFiles(file.path);
      }
    });

    // Click to select
    tr.addEventListener("click", () => {
      const isSelected = selectedRemotePaths.has(file.path);
      if (isSelected) {
        selectedRemotePaths.delete(file.path);
        tr.classList.remove("selected");
        const chk = tr.querySelector("input") as HTMLInputElement;
        if (chk) chk.checked = false;
      } else {
        selectedRemotePaths.add(file.path);
        tr.classList.add("selected");
        const chk = tr.querySelector("input") as HTMLInputElement;
        if (chk) chk.checked = true;
      }
      updateActionStates();
    });

    const chkCol = document.createElement("td");
    chkCol.className = "col-checkbox";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = selectedRemotePaths.has(file.path);
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      const isChecked = chk.checked;
      if (isChecked) {
        selectedRemotePaths.add(file.path);
        tr.classList.add("selected");
      } else {
        selectedRemotePaths.delete(file.path);
        tr.classList.remove("selected");
      }
      updateActionStates();
    });
    chkCol.appendChild(chk);

    const nameCol = document.createElement("td");
    nameCol.className = "col-name";

    const nameDiv = document.createElement("div");
    nameDiv.className = "file-item-name";

    let iconSvg = "";
    if (file.is_dir) {
      iconSvg = getFolderIcon();
    } else if (file.is_symlink) {
      iconSvg = getSymlinkIcon();
    } else {
      iconSvg = getFileIcon();
    }
    nameDiv.innerHTML = iconSvg;

    const spanName = document.createElement("span");
    spanName.textContent = file.name + (file.is_symlink && file.link_target ? ` ➔ ${file.link_target}` : "");
    nameDiv.appendChild(spanName);
    nameCol.appendChild(nameDiv);

    const sizeCol = document.createElement("td");
    sizeCol.className = "col-size";
    sizeCol.textContent = file.is_dir ? "--" : formatBytes(file.size);

    const dateCol = document.createElement("td");
    dateCol.className = "col-modified";
    dateCol.textContent = file.modified || "--";

    tr.appendChild(chkCol);
    tr.appendChild(nameCol);
    tr.appendChild(sizeCol);
    tr.appendChild(dateCol);

    remoteFileListEl.appendChild(tr);
  });
}

function navigateRemoteUp() {
  if (!remotePath || remotePath === "/" || remotePath === "/storage") return;
  if (remotePath === "/storage/emulated/0") {
    loadRemoteFiles("/storage");
    return;
  }
  const parts = remotePath.split("/");
  parts.pop();
  let parent = parts.join("/");
  if (!parent) parent = "/";
  loadRemoteFiles(parent);
}

// Action Handlers
async function handlePush() {
  if (selectedLocalPaths.size === 0 || !selectedDeviceSerial) return;
  const sources = Array.from(selectedLocalPaths);
  const dest = remotePath;

  try {
    btnPushEl.disabled = true;
    btnPullEl.disabled = true;

    await invoke("copy_files", {
      app: null, // Tauri will inject AppHandle internally
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

async function handlePull() {
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

// Local/Remote Create Folder, Rename, Delete Modals
function showCreateFolderModal(isLocal: boolean) {
  const title = isLocal ? "New Folder in macOS" : "New Folder in Android";
  const modal = createModal(title, "Folder Name", "Create", async (inputVal) => {
    if (!inputVal.trim()) return;
    try {
      const fullPath = isLocal
        ? `${localPath}/${inputVal.trim()}`
        : `${remotePath}/${inputVal.trim()}`;

      if (isLocal) {
        await invoke("create_local_directory", { path: fullPath });
        loadLocalFiles(localPath);
      } else {
        await invoke("create_remote_directory", {
          deviceId: selectedDeviceSerial,
          path: fullPath
        });
        loadRemoteFiles(remotePath);
      }
    } catch (err) {
      alert(`Error creating directory:\n${err}`);
    }
  });
  document.body.appendChild(modal);
}

function showRenameModal(isLocal: boolean) {
  const selectedPaths = isLocal ? selectedLocalPaths : selectedRemotePaths;
  if (selectedPaths.size !== 1) return;

  const oldPath = Array.from(selectedPaths)[0];
  const oldName = oldPath.split("/").pop() || "";
  const title = isLocal ? `Rename "${oldName}" (macOS)` : `Rename "${oldName}" (Android)`;

  const modal = createModal(title, "New Name", "Rename", async (newName) => {
    if (!newName.trim() || newName === oldName) return;
    try {
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${parentDir}/${newName.trim()}`;

      if (isLocal) {
        await invoke("rename_local_item", { oldPath, newPath });
        loadLocalFiles(localPath);
      } else {
        await invoke("rename_remote_item", {
          deviceId: selectedDeviceSerial,
          oldPath,
          newPath
        });
        loadRemoteFiles(remotePath);
      }
    } catch (err) {
      alert(`Error renaming:\n${err}`);
    }
  });
  document.body.appendChild(modal);
}

function showDeleteConfirmModal(isLocal: boolean) {
  const selectedPaths = isLocal ? selectedLocalPaths : selectedRemotePaths;
  if (selectedPaths.size === 0) return;

  const count = selectedPaths.size;
  const msg = `Are you sure you want to delete ${count} selected item(s)?\nThis action cannot be undone.`;
  if (confirm(msg)) {
    const paths = Array.from(selectedPaths);

    (async () => {
      try {
        if (isLocal) {
          await invoke("delete_local_items", { paths });
          loadLocalFiles(localPath);
        } else {
          await invoke("delete_remote_items", {
            deviceId: selectedDeviceSerial,
            paths
          });
          loadRemoteFiles(remotePath);
        }
      } catch (err) {
        alert(`Error deleting items:\n${err}`);
      }
    })();
  }
}

// Modal helper builder
function createModal(title: string, placeholder: string, actionLabel: string, callback: (val: string) => Promise<void>): HTMLDivElement {
  const modalDiv = document.createElement("div");
  modalDiv.className = "modal";

  const content = document.createElement("div");
  content.className = "modal-content";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  content.appendChild(h3);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "modal-input";
  input.placeholder = placeholder;
  content.appendChild(input);

  const buttons = document.createElement("div");
  buttons.className = "modal-buttons";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-modal";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => modalDiv.remove());
  buttons.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-modal confirm";
  confirmBtn.textContent = actionLabel;

  const runCallback = async () => {
    confirmBtn.disabled = true;
    await callback(input.value);
    modalDiv.remove();
  };

  confirmBtn.addEventListener("click", runCallback);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runCallback();
  });

  buttons.appendChild(confirmBtn);
  content.appendChild(buttons);
  modalDiv.appendChild(content);

  // Focus input automatically
  setTimeout(() => input.focus(), 50);

  return modalDiv;
}

// Update UI state based on selections and device connection
function updateActionStates() {
  // Transfer buttons
  btnPushEl.disabled = selectedLocalPaths.size === 0 || !selectedDeviceSerial || devices.length === 0 || devices.find(d => d.serial === selectedDeviceSerial)?.status !== "device";
  btnPullEl.disabled = selectedRemotePaths.size === 0 || !selectedDeviceSerial || devices.length === 0 || devices.find(d => d.serial === selectedDeviceSerial)?.status !== "device";

  // Selection Info text
  localSelectionInfoEl.textContent = `${selectedLocalPaths.size} selected`;
  remoteSelectionInfoEl.textContent = `${selectedRemotePaths.size} selected`;

  // Local actions buttons state
  btnLocalRename.disabled = selectedLocalPaths.size !== 1;
  btnLocalDelete.disabled = selectedLocalPaths.size === 0;

  // Remote actions buttons state
  btnRemoteRename.disabled = selectedRemotePaths.size !== 1;
  btnRemoteDelete.disabled = selectedRemotePaths.size === 0;
}

// Icon Helpers (Crisp inline SVG markup)
function getFolderIcon(): string {
  return `<svg class="file-item-icon folder" viewBox="0 0 24 24"><path d="M10 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></svg>`;
}

function getFileIcon(): string {
  return `<svg class="file-item-icon file" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
}

function getSymlinkIcon(): string {
  return `<svg class="file-item-icon symlink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
}

// Utility Formatter
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Local / Remote drives rendering
async function loadLocalDisks() {
  try {
    const disks = await invoke<DiskInfo[]>("get_local_disks");
    renderDisks(disks, localDrivesEl, true);
  } catch (err) {
    console.error("Error loading local disks:", err);
  }
}

async function loadRemoteDisks() {
  if (!selectedDeviceSerial) {
    remoteDrivesEl.innerHTML = "";
    return;
  }
  try {
    const disks = await invoke<DiskInfo[]>("get_remote_disks", { deviceId: selectedDeviceSerial });
    renderDisks(disks, remoteDrivesEl, false);
  } catch (err) {
    console.error("Error loading remote disks:", err);
  }
}

function renderDisks(disks: DiskInfo[], container: HTMLElement, isLocal: boolean) {
  container.innerHTML = "";
  if (disks.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";

  disks.forEach(disk => {
    const card = document.createElement("div");
    card.className = "drive-card";
    const currentPath = isLocal ? localPath : remotePath;

    const isActive = currentPath === disk.path || currentPath.startsWith(disk.path + "/");
    if (isActive) {
      card.classList.add("active");
    }

    card.addEventListener("click", () => {
      if (isLocal) {
        loadLocalFiles(disk.path);
      } else {
        loadRemoteFiles(disk.path);
      }
    });

    const icon = document.createElement("div");
    icon.className = "drive-icon-wrapper";
    icon.innerHTML = disk.is_removable
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-5h2v5zm0-6h-2V7h2v3z"/></svg>` // SD / USB Icon
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 15v4H5v-4h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 17c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>`; // Hard Disk Icon

    const details = document.createElement("div");
    details.className = "drive-details";

    const name = document.createElement("div");
    name.className = "drive-name";
    name.textContent = disk.name;

    const spaceBar = document.createElement("div");
    spaceBar.className = "drive-space-bar";
    const spaceFill = document.createElement("div");
    spaceFill.className = "drive-space-fill";
    spaceFill.style.width = `${disk.pct}%`;
    if (disk.pct > 90) spaceFill.classList.add("danger");
    else if (disk.pct > 75) spaceFill.classList.add("warning");
    spaceBar.appendChild(spaceFill);

    const spaceInfo = document.createElement("div");
    spaceInfo.className = "drive-space-info";
    const freeStr = formatBytes(disk.free);
    const totalStr = formatBytes(disk.total);
    spaceInfo.textContent = `${freeStr} libres de ${totalStr}`;

    details.appendChild(name);
    details.appendChild(spaceBar);
    details.appendChild(spaceInfo);

    card.appendChild(icon);
    card.appendChild(details);
    container.appendChild(card);
  });
}

// Breadcrumbs logic
function renderBreadcrumbs(path: string, container: HTMLElement, isLocal: boolean) {
  container.innerHTML = "";

  if (!path) {
    path = "/";
  }

  let segments: string[] = [];
  if (path === "/") {
    segments = [""];
  } else {
    segments = path.split("/");
    if (segments[0] === "") {
      segments[0] = "";
    }
  }

  let cumulativePath = "";

  segments.forEach((seg, index) => {
    if (index === 0) {
      cumulativePath = isLocal ? "/" : "/storage";
    } else {
      if (cumulativePath === "/") {
        cumulativePath = "/" + seg;
      } else if (cumulativePath === "/storage" && !isLocal && index === 1 && seg === "storage") {
        // Skip redundant storage segment in /storage/storage
        return;
      } else {
        cumulativePath = cumulativePath + "/" + seg;
      }
    }

    const currentCumulative = cumulativePath;
    let label = seg;
    if (index === 0) {
      label = isLocal ? "Macintosh HD" : "Dispositivo";
    }

    if (index > 0 && seg) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "❯";
      container.appendChild(sep);
    }

    if (seg || index === 0) {
      const item = document.createElement("span");
      item.className = "breadcrumb-item";
      item.textContent = label || "/";

      item.addEventListener("click", () => {
        if (isLocal) {
          loadLocalFiles(currentCumulative);
        } else {
          loadRemoteFiles(currentCumulative);
        }
      });

      container.appendChild(item);
    }
  });
}

function setupPathEditing(isLocal: boolean) {
  const prefix = isLocal ? "local" : "remote";
  const breadcrumbsEl = document.querySelector(`#${prefix}-breadcrumbs`) as HTMLElement;
  const inputEl = document.querySelector(`#${prefix}-path-input`) as HTMLInputElement;
  const editBtn = document.querySelector(`#${prefix}-btn-edit-path`) as HTMLButtonElement;

  editBtn.addEventListener("click", () => {
    breadcrumbsEl.style.display = "none";
    inputEl.style.display = "block";
    inputEl.focus();
    inputEl.select();
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      inputEl.style.display = "none";
      breadcrumbsEl.style.display = "flex";
    }, 200);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      inputEl.style.display = "none";
      breadcrumbsEl.style.display = "flex";
    } else if (e.key === "Escape") {
      inputEl.style.display = "none";
      breadcrumbsEl.style.display = "flex";
    }
  });
}

function showWifiConnectionModal() {
  const modalDiv = document.createElement("div");
  modalDiv.className = "modal";

  const content = document.createElement("div");
  content.className = "modal-content";
  content.style.width = "420px";

  const h3 = document.createElement("h3");
  h3.textContent = "Conectar a WiFi";
  h3.style.textAlign = "center";
  h3.style.marginBottom = "1.25rem";
  content.appendChild(h3);

  const formBody = document.createElement("div");
  formBody.style.minHeight = "150px";
  content.appendChild(formBody);

  let selectedWifiSsid = "";
  let scanning = false;

  const render = () => {
    formBody.innerHTML = `
      <div class="wifi-info-text">
        Escanea las redes WiFi disponibles y conéctate a la de tu teléfono.
      </div>
      <button class="btn-modal confirm" id="btn-start-scan" style="width:100%;margin-bottom:1rem;">
        ${scanning ? "Escaneando..." : "Escanear redes WiFi"}
      </button>
      <div id="wifi-scan-results" style="max-height:200px;overflow-y:auto;margin-bottom:0.5rem;"></div>
      <div id="wifi-scan-password-area" style="display:${selectedWifiSsid ? "block" : "none"};">
        <div class="wifi-form-group">
          <label>Red seleccionada</label>
          <div style="color:var(--text-primary);font-weight:600;font-size:0.9rem;" id="wifi-selected-ssid">${selectedWifiSsid}</div>
        </div>
        <div class="wifi-form-group">
          <label for="wifi-scan-password">Contraseña</label>
          <input type="text" id="wifi-scan-password" class="modal-input" placeholder="Contraseña de la red WiFi" style="margin-bottom:0;">
        </div>
      </div>
    `;
    setTimeout(() => document.getElementById("btn-start-scan")?.focus(), 50);

    const btnScan = document.getElementById("btn-start-scan") as HTMLButtonElement;
    btnScan.addEventListener("click", async () => {
      if (scanning) return;
      scanning = true;
      btnScan.disabled = true;
      btnScan.textContent = "Escaneando...";
      const resultsEl = document.getElementById("wifi-scan-results")!;
      resultsEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">Escaneando...</div>';
      try {
        const networks = await invoke<WifiNetwork[]>("scan_wifi_networks");
        if (networks.length === 0) {
          resultsEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No se encontraron redes WiFi</div>';
          return;
        }
        let html = '<div class="saved-connections">';
        networks.forEach((net) => {
          const rssiVal = parseInt(net.rssi) || -100;
          const bars = rssiVal > -50 ? "▂▄▆█" : rssiVal > -65 ? "▂▄▆" : rssiVal > -80 ? "▂▄" : "▂";
          const isSelected = net.ssid === selectedWifiSsid;
          html += `
            <div class="wifi-scan-item${isSelected ? " selected" : ""}" data-ssid="${net.ssid.replace(/"/g, "&quot;")}">
              <div class="saved-conn-info">
                <strong>${net.ssid}</strong>
                <span style="font-size:0.75em;color:var(--text-muted);">${net.security} · CH ${net.channel} · ${net.rssi} dBm</span>
              </div>
              <span style="font-size:1.1rem;letter-spacing:1px;color:var(--accent);">${bars}</span>
            </div>
          `;
        });
        html += '</div>';
        resultsEl.innerHTML = html;

        resultsEl.querySelectorAll(".wifi-scan-item").forEach((item) => {
          item.addEventListener("click", () => {
            selectedWifiSsid = (item as HTMLElement).dataset.ssid!;
            render();
            setTimeout(() => {
              const pwdInput = document.getElementById("wifi-scan-password") as HTMLInputElement;
              if (pwdInput) pwdInput.focus();
            }, 50);
          });
        });
      } catch (err) {
        resultsEl.innerHTML = `<div style="text-align:center;color:var(--danger);padding:1rem;">Error al escanear: ${err}</div>`;
      } finally {
        scanning = false;
        btnScan.disabled = false;
        btnScan.textContent = "Escanear redes WiFi";
      }
    });
  };

  interface WifiNetwork {
    ssid: string;
    bssid: string;
    rssi: string;
    channel: string;
    security: string;
  }

  render();

  const actionContainer = document.createElement("div");
  actionContainer.style.display = "flex";
  actionContainer.style.flexDirection = "column";
  actionContainer.style.gap = "0.75rem";
  actionContainer.style.marginTop = "1.25rem";

  const btnConnect = document.createElement("button");
  btnConnect.className = "btn-modal confirm";
  btnConnect.style.width = "100%";
  btnConnect.textContent = "Conectar a WiFi";
  actionContainer.appendChild(btnConnect);

  btnConnect.addEventListener("click", async () => {
    if (!selectedWifiSsid) {
      alert("Selecciona una red WiFi primero.");
      return;
    }
    const password = (document.getElementById("wifi-scan-password") as HTMLInputElement).value.trim();
    if (!password) {
      alert("Ingresa la contraseña de la red WiFi.");
      return;
    }
    btnConnect.disabled = true;
    btnConnect.textContent = "Conectando...";
    try {
      const response = await invoke<string>("connect_to_wifi", { ssid: selectedWifiSsid, password });
      alert(response);
      selectedWifiSsid = "";
      modalDiv.remove();
    } catch (err) {
      alert(`Error: ${err}`);
      btnConnect.disabled = false;
      btnConnect.textContent = "Conectar a WiFi";
    }
  });

  const btnCerrar = document.createElement("button");
  btnCerrar.className = "btn-modal";
  btnCerrar.style.width = "100%";
  btnCerrar.textContent = "Cerrar";
  btnCerrar.addEventListener("click", () => modalDiv.remove());
  actionContainer.appendChild(btnCerrar);

  content.appendChild(actionContainer);
  modalDiv.appendChild(content);

  document.body.appendChild(modalDiv);
}
