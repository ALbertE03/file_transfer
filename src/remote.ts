import { invoke } from "@tauri-apps/api/core";
import { RemoteFile, DiskInfo } from "./types";
import {
  remoteFiles, remotePath, selectedRemotePaths, selectedDeviceSerial,
  remotePathInputEl, remoteFileListEl, remoteBreadcrumbsEl, remoteDrivesEl,
  setRemoteFiles, setRemotePath,
} from "./state";
import { formatBytes, getFolderIcon, getFileIcon, getSymlinkIcon, updateActionStates, renderBreadcrumbs, renderDisks } from "./ui";

export async function loadRemoteFiles(path: string) {
  if (!selectedDeviceSerial) return;
  try {
    const list = await invoke<RemoteFile[]>("list_remote_files", {
      deviceId: selectedDeviceSerial,
      path
    });
    setRemoteFiles(list);
    setRemotePath(path);
    remotePathInputEl.value = path;
    selectedRemotePaths.clear();
    renderRemoteTable();
    updateActionStates();
    renderBreadcrumbs(path, remoteBreadcrumbsEl, false, loadRemoteFiles);
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

    tr.addEventListener("dblclick", () => {
      if (file.is_dir) loadRemoteFiles(file.path);
    });

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
      if (chk.checked) {
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
    if (file.is_dir) iconSvg = getFolderIcon();
    else if (file.is_symlink) iconSvg = getSymlinkIcon();
    else iconSvg = getFileIcon();
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

export function navigateRemoteUp() {
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

async function loadRemoteDisks() {
  if (!selectedDeviceSerial) {
    remoteDrivesEl.innerHTML = "";
    return;
  }
  try {
    const disks = await invoke<DiskInfo[]>("get_remote_disks", { deviceId: selectedDeviceSerial });
    renderDisks(disks, remoteDrivesEl, remotePath, loadRemoteFiles);
  } catch (err) {
    console.error("Error loading remote disks:", err);
  }
}
