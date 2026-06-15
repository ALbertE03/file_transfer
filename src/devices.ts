import { invoke } from "@tauri-apps/api/core";
import { Device } from "./types";
import {
  selectedDeviceSerial, remotePath,
  deviceSelectEl, statusBadgeEl, statusTextEl, onboardingOverlayEl, remoteFileListEl,
  setDevices, setSelectedDeviceSerial,
} from "./state";
import { updateActionStates } from "./ui";
import { loadRemoteFiles } from "./remote";

export async function refreshDevices() {
  try {
    const devs = await invoke<Device[]>("get_adb_devices");
    setDevices(devs);

    deviceSelectEl.innerHTML = "";

    if (devs.length === 0) {
      statusBadgeEl.className = "status-badge disconnected";
      statusTextEl.textContent = "Disconnected";
      onboardingOverlayEl.style.display = "flex";
      setSelectedDeviceSerial("");
      remoteFileListEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No devices connected</td></tr>';
      updateActionStates();
      return;
    }

    devs.forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = dev.serial;
      opt.textContent = `${dev.model} (${dev.serial})`;
      if (dev.serial === selectedDeviceSerial) opt.selected = true;
      deviceSelectEl.appendChild(opt);
    });

    const stillExists = devs.some(d => d.serial === selectedDeviceSerial);
    if (!stillExists) setSelectedDeviceSerial(devs[0].serial);

    const currentDevice = devs.find(d => d.serial === selectedDeviceSerial)!;

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

export async function handleDeviceSelectionChange() {
  setSelectedDeviceSerial(deviceSelectEl.value);
  await refreshDevices();
}
