export interface Device {
  serial: string;
  model: string;
  status: string;
}

export interface LocalFile {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface RemoteFile {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: string;
  permissions: string;
  link_target: string | null;
}

export interface ProgressPayload {
  current_file: string;
  index: number;
  total: number;
  percentage: number;
  speed: string;
  status: "running" | "file_ok" | "file_error" | "completed" | "error" | "paused";
  error_message: string | null;
}

export interface DiskInfo {
  name: string;
  path: string;
  total: number;
  free: number;
  used: number;
  pct: number;
  is_removable: boolean;
}

export interface QueueItem {
  source: string;
  destPath: string;
  deviceId: string;
  direction: "push" | "pull";
  status: "pending" | "running" | "paused" | "completed" | "cancelled" | "error";
  lastPct: number;
}
