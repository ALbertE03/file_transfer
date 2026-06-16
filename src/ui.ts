import { DiskInfo } from "./types";
import {
  selectedLocalPaths, selectedRemotePaths, selectedDeviceSerial, devices,
  localSelectionInfoEl, remoteSelectionInfoEl,
  btnPushEl, btnPullEl,
  btnLocalRename, btnLocalDelete,
  btnRemoteRename, btnRemoteDelete,
  localSelectAllEl, remoteSelectAllEl,
  localFileListEl, remoteFileListEl,
} from "./state";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function getFolderIcon(): string {
  return `<svg class="file-item-icon folder" viewBox="0 0 24 24"><path d="M10 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></svg>`;
}

export function getFileIcon(): string {
  return `<svg class="file-item-icon file" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
}

export function getSymlinkIcon(): string {
  return `<svg class="file-item-icon symlink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
}

export function updateActionStates() {
  btnPushEl.disabled = selectedLocalPaths.size === 0 || !selectedDeviceSerial || devices.length === 0 || devices.find(d => d.serial === selectedDeviceSerial)?.status !== "device";
  btnPullEl.disabled = selectedRemotePaths.size === 0 || !selectedDeviceSerial || devices.length === 0 || devices.find(d => d.serial === selectedDeviceSerial)?.status !== "device";

  localSelectionInfoEl.textContent = `${selectedLocalPaths.size} selected`;
  remoteSelectionInfoEl.textContent = `${selectedRemotePaths.size} selected`;

  btnLocalRename.disabled = selectedLocalPaths.size !== 1;
  btnLocalDelete.disabled = selectedLocalPaths.size === 0;

  btnRemoteRename.disabled = selectedRemotePaths.size !== 1;
  btnRemoteDelete.disabled = selectedRemotePaths.size === 0;

  const localChecks = localFileListEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  const remoteChecks = remoteFileListEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  localSelectAllEl.checked = localChecks.length > 0 && Array.from(localChecks).every(c => c.checked);
  remoteSelectAllEl.checked = remoteChecks.length > 0 && Array.from(remoteChecks).every(c => c.checked);
}

export function renderBreadcrumbs(
  path: string,
  container: HTMLElement,
  isLocal: boolean,
  onNavigate: (path: string) => void
) {
  container.innerHTML = "";

  if (!path) path = "/";

  let segments: string[] = [];
  if (path === "/") {
    segments = [""];
  } else {
    segments = path.split("/");
    if (segments[0] === "") segments[0] = "";
  }

  let cumulativePath = "";

  segments.forEach((seg, index) => {
    if (index === 0) {
      cumulativePath = isLocal ? "/" : "/storage";
    } else {
      if (cumulativePath === "/") {
        cumulativePath = "/" + seg;
      } else if (cumulativePath === "/storage" && !isLocal && index === 1 && seg === "storage") {
        return;
      } else {
        cumulativePath = cumulativePath + "/" + seg;
      }
    }

    const currentCumulative = cumulativePath;
    let label = seg;
    if (index === 0) label = isLocal ? "Macintosh HD" : "Dispositivo";

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
      item.addEventListener("click", () => onNavigate(currentCumulative));
      container.appendChild(item);
    }
  });
}

export function setupPathEditing(isLocal: boolean) {
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
    if (e.key === "Enter" || e.key === "Escape") {
      inputEl.style.display = "none";
      breadcrumbsEl.style.display = "flex";
    }
  });
}

export function renderDisks(
  disks: DiskInfo[],
  container: HTMLElement,
  currentPath: string,
  onNavigate: (path: string) => void
) {
  container.innerHTML = "";
  if (disks.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";

  disks.forEach(disk => {
    const card = document.createElement("div");
    card.className = "drive-card";

    const isActive = currentPath === disk.path || currentPath.startsWith(disk.path + "/");
    if (isActive) card.classList.add("active");

    card.addEventListener("click", () => onNavigate(disk.path));

    const icon = document.createElement("div");
    icon.className = "drive-icon-wrapper";
    icon.innerHTML = disk.is_removable
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-5h2v5zm0-6h-2V7h2v3z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 15v4H5v-4h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 17c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>`;

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
    spaceInfo.textContent = `${formatBytes(disk.free)} libres de ${formatBytes(disk.total)}`;

    details.appendChild(name);
    details.appendChild(spaceBar);
    details.appendChild(spaceInfo);

    card.appendChild(icon);
    card.appendChild(details);
    container.appendChild(card);
  });
}
