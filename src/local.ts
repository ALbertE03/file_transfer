import { invoke } from "@tauri-apps/api/core";
import { LocalFile, DiskInfo } from "./types";
import {
  localFiles, localPath, selectedLocalPaths,
  localPathInputEl, localFileListEl, localBreadcrumbsEl, localDrivesEl,
  setLocalFiles, setLocalPath,
} from "./state";
import { formatBytes, getFolderIcon, getFileIcon, updateActionStates, renderBreadcrumbs, renderDisks } from "./ui";

export async function loadLocalFiles(path: string) {
  try {
    const list = await invoke<LocalFile[]>("list_local_files", { path });
    setLocalFiles(list);
    setLocalPath(path);
    localPathInputEl.value = path;
    selectedLocalPaths.clear();
    renderLocalTable();
    updateActionStates();
    renderBreadcrumbs(path, localBreadcrumbsEl, true, loadLocalFiles);
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

    tr.addEventListener("dblclick", () => {
      if (file.is_dir) loadLocalFiles(file.path);
    });

    tr.addEventListener("click", () => {
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
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      if (chk.checked) {
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
    nameDiv.innerHTML = file.is_dir ? getFolderIcon() : getFileIcon();
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

export function navigateLocalUp() {
  if (!localPath || localPath === "/") return;
  const parts = localPath.split("/");
  parts.pop();
  let parent = parts.join("/");
  if (!parent) parent = "/";
  loadLocalFiles(parent);
}

async function loadLocalDisks() {
  try {
    const disks = await invoke<DiskInfo[]>("get_local_disks");
    renderDisks(disks, localDrivesEl, localPath, loadLocalFiles);
  } catch (err) {
    console.error("Error loading local disks:", err);
  }
}
