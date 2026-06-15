import { invoke } from "@tauri-apps/api/core";
import {
  localPath, remotePath, selectedDeviceSerial,
  selectedLocalPaths, selectedRemotePaths,
} from "./state";
import { loadLocalFiles } from "./local";
import { loadRemoteFiles } from "./remote";

function createModal(
  title: string,
  placeholder: string,
  actionLabel: string,
  callback: (val: string) => Promise<void>
): HTMLDivElement {
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

  setTimeout(() => input.focus(), 50);

  return modalDiv;
}

export function showCreateFolderModal(isLocal: boolean) {
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

export function showRenameModal(isLocal: boolean) {
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

function showConfirmModal(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modalDiv = document.createElement("div");
    modalDiv.className = "modal";

    const content = document.createElement("div");
    content.className = "modal-content";
    content.style.width = "400px";

    const p = document.createElement("p");
    p.textContent = message;
    p.style.marginBottom = "1.25rem";
    p.style.lineHeight = "1.5";
    p.style.whiteSpace = "pre-line";
    content.appendChild(p);

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-modal";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      modalDiv.remove();
      resolve(false);
    });
    buttons.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-modal confirm";
    confirmBtn.textContent = "Delete";
    confirmBtn.addEventListener("click", () => {
      modalDiv.remove();
      resolve(true);
    });
    buttons.appendChild(confirmBtn);

    content.appendChild(buttons);
    modalDiv.appendChild(content);
    document.body.appendChild(modalDiv);
  });
}

export async function showDeleteConfirmModal(isLocal: boolean) {
  const selectedPaths = isLocal ? selectedLocalPaths : selectedRemotePaths;
  if (selectedPaths.size === 0) return;

  const count = selectedPaths.size;
  const msg = `Are you sure you want to delete ${count} selected item(s)?\nThis action cannot be undone.`;
  const confirmed = await showConfirmModal(msg);
  if (!confirmed) return;

  const paths = Array.from(selectedPaths);
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
}
