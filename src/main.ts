import { invoke } from "@tauri-apps/api/core";
import { initDom, localPath, remotePath, localPathInputEl, remotePathInputEl, btnRefreshEl, deviceSelectEl, localUpBtnEl, remoteUpBtnEl, btnLocalNewFolder, btnLocalRename, btnLocalDelete, btnRemoteNewFolder, btnRemoteRename, btnRemoteDelete, btnPushEl, btnPullEl, themeSelectEl, setTheme, applyTheme, setLocalPath, setRemotePath, theme, Theme, localViewMode, remoteViewMode, btnLocalViewToggle, btnRemoteViewToggle, setLocalViewMode, setRemoteViewMode } from "./state";
import { setupPathEditing } from "./ui";
import { loadLocalFiles, navigateLocalUp, setupLocalSelectAll } from "./local";
import { loadRemoteFiles, navigateRemoteUp, setupRemoteSelectAll } from "./remote";
import { refreshDevices, handleDeviceSelectionChange } from "./devices";
import { handlePush, handlePull, setupProgressChannel } from "./transfers";
import { showCreateFolderModal, showRenameModal, showDeleteConfirmModal } from "./modals";

window.addEventListener("DOMContentLoaded", async () => {
  initDom();
  setupLocalSelectAll();
  setupRemoteSelectAll();

  const saved = localStorage.getItem("file-transfer-theme") as Theme | null;
  if (saved) setTheme(saved);
  else setTheme("system");

  themeSelectEl.addEventListener("change", () => setTheme(themeSelectEl.value as Theme));

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (theme === "system") applyTheme("system");
  });

  btnRefreshEl.addEventListener("click", refreshDevices);
  deviceSelectEl.addEventListener("change", handleDeviceSelectionChange);

  localPathInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadLocalFiles(localPathInputEl.value);
  });
  localUpBtnEl.addEventListener("click", navigateLocalUp);

  remotePathInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadRemoteFiles(remotePathInputEl.value);
  });
  remoteUpBtnEl.addEventListener("click", navigateRemoteUp);

  btnLocalNewFolder.addEventListener("click", () => showCreateFolderModal(true));
  btnLocalRename.addEventListener("click", () => showRenameModal(true));
  btnLocalDelete.addEventListener("click", () => showDeleteConfirmModal(true));

  btnRemoteNewFolder.addEventListener("click", () => showCreateFolderModal(false));
  btnRemoteRename.addEventListener("click", () => showRenameModal(false));
  btnRemoteDelete.addEventListener("click", () => showDeleteConfirmModal(false));

  btnPushEl.addEventListener("click", handlePush);
  btnPullEl.addEventListener("click", handlePull);

  setupPathEditing(true);
  setupPathEditing(false);

  setupProgressChannel();

  // Grid/list view toggle
  const savedLocalView = localStorage.getItem("file-transfer-view-local") as "list" | "grid" | null;
  const savedRemoteView = localStorage.getItem("file-transfer-view-remote") as "list" | "grid" | null;
  if (savedLocalView) setLocalViewMode(savedLocalView);
  if (savedRemoteView) setRemoteViewMode(savedRemoteView);

  btnLocalViewToggle.addEventListener("click", () => {
    const next = localViewMode === "list" ? "grid" : "list";
    setLocalViewMode(next);
    localStorage.setItem("file-transfer-view-local", next);
    loadLocalFiles(localPath, true);
  });
  btnRemoteViewToggle.addEventListener("click", () => {
    const next = remoteViewMode === "list" ? "grid" : "list";
    setRemoteViewMode(next);
    localStorage.setItem("file-transfer-view-remote", next);
    loadRemoteFiles(remotePath, true);
  });

  try {
    const [localHome, remoteHome] = await invoke<[string, string]>("get_home_directories");
    setLocalPath(localHome);
    setRemotePath(remoteHome);

    localPathInputEl.value = localPath;
    remotePathInputEl.value = remotePath;

    await loadLocalFiles(localPath);
    await refreshDevices();
  } catch (err) {
    console.error("Initialization error:", err);
  }
});
