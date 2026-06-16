import { invoke } from "@tauri-apps/api/core";
import { initDom, localPath, remotePath, localPathInputEl, remotePathInputEl, btnRefreshEl, deviceSelectEl, localUpBtnEl, remoteUpBtnEl, btnLocalNewFolder, btnLocalRename, btnLocalDelete, btnRemoteNewFolder, btnRemoteRename, btnRemoteDelete, btnPushEl, btnPullEl, themeSelectEl, setTheme, applyTheme, setLocalPath, setRemotePath, theme, Theme } from "./state";
import { setupPathEditing } from "./ui";
import { loadLocalFiles, navigateLocalUp } from "./local";
import { loadRemoteFiles, navigateRemoteUp } from "./remote";
import { refreshDevices, handleDeviceSelectionChange } from "./devices";
import { handlePush, handlePull, setupProgressChannel } from "./transfers";
import { showCreateFolderModal, showRenameModal, showDeleteConfirmModal } from "./modals";

window.addEventListener("DOMContentLoaded", async () => {
  initDom();

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
