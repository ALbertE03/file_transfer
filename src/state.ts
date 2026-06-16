import { Device, LocalFile, RemoteFile } from "./types";

export let localPath = "";
export let remotePath = "";
export let selectedDeviceSerial = "";
export let devices: Device[] = [];

export let localFiles: LocalFile[] = [];
export let remoteFiles: RemoteFile[] = [];

export const selectedLocalPaths = new Set<string>();
export const selectedRemotePaths = new Set<string>();

export let deviceSelectEl: HTMLSelectElement;
export let statusBadgeEl: HTMLElement;
export let statusTextEl: HTMLElement;
export let btnRefreshEl: HTMLButtonElement;

export let localPathInputEl: HTMLInputElement;
export let localUpBtnEl: HTMLButtonElement;
export let localFileListEl: HTMLTableSectionElement;
export let localSelectionInfoEl: HTMLElement;
export let localBreadcrumbsEl: HTMLElement;
export let localDrivesEl: HTMLElement;

export let remotePathInputEl: HTMLInputElement;
export let remoteUpBtnEl: HTMLButtonElement;
export let remoteFileListEl: HTMLTableSectionElement;
export let remoteSelectionInfoEl: HTMLElement;
export let remoteBreadcrumbsEl: HTMLElement;
export let remoteDrivesEl: HTMLElement;

export let btnPushEl: HTMLButtonElement;
export let btnPullEl: HTMLButtonElement;

export let onboardingOverlayEl: HTMLElement;
export let progressOverlayEl: HTMLElement;
export let progressCountEl: HTMLElement;
export let progressListEl: HTMLElement;

export let btnLocalNewFolder: HTMLButtonElement;
export let btnLocalRename: HTMLButtonElement;
export let btnLocalDelete: HTMLButtonElement;

export let btnRemoteNewFolder: HTMLButtonElement;
export let btnRemoteRename: HTMLButtonElement;
export let btnRemoteDelete: HTMLButtonElement;

export function updatePath(newLocal: string, newRemote: string) {
  localPath = newLocal;
  remotePath = newRemote;
}

export function setLocalPath(p: string) { localPath = p; }
export function setRemotePath(p: string) { remotePath = p; }
export function setSelectedDeviceSerial(s: string) { selectedDeviceSerial = s; }
export function setDevices(d: Device[]) { devices = d; }
export function setLocalFiles(f: LocalFile[]) { localFiles = f; }
export function setRemoteFiles(f: RemoteFile[]) { remoteFiles = f; }

export type Theme = "dark" | "light" | "system";
export let theme: Theme = "system";
export let themeSelectEl: HTMLSelectElement;

export function setTheme(t: Theme) {
  theme = t;
  localStorage.setItem("file-transfer-theme", t);
  applyTheme(t);
  if (themeSelectEl) themeSelectEl.value = t;
}

export function applyTheme(t: Theme) {
  const effective = t === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : t;
  document.documentElement.setAttribute("data-theme", effective);
}

export function initDom() {
  deviceSelectEl = document.querySelector("#device-select") as HTMLSelectElement;
  statusBadgeEl = document.querySelector("#status-badge") as HTMLElement;
  statusTextEl = document.querySelector("#status-text") as HTMLElement;
  btnRefreshEl = document.querySelector("#btn-refresh") as HTMLButtonElement;

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
  progressCountEl = document.querySelector("#progress-count") as HTMLElement;
  progressListEl = document.querySelector("#progress-list") as HTMLElement;

  btnLocalNewFolder = document.querySelector("#btn-local-new-folder") as HTMLButtonElement;
  btnLocalRename = document.querySelector("#btn-local-rename") as HTMLButtonElement;
  btnLocalDelete = document.querySelector("#btn-local-delete") as HTMLButtonElement;

  btnRemoteNewFolder = document.querySelector("#btn-remote-new-folder") as HTMLButtonElement;
  btnRemoteRename = document.querySelector("#btn-remote-rename") as HTMLButtonElement;
  btnRemoteDelete = document.querySelector("#btn-remote-delete") as HTMLButtonElement;

  themeSelectEl = document.querySelector("#theme-select") as HTMLSelectElement;
}
