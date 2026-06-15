#[derive(serde::Serialize, Clone, Debug)]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub status: String,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: String,
    pub link_target: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct LocalFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DiskInfo {
    pub name: String,
    pub path: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub pct: u32,
    pub is_removable: bool,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct StorageSpace {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub pct: u32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ProgressPayload {
    pub current_file: String,
    pub index: usize,
    pub total: usize,
    pub percentage: u32,
    pub status: String,
    pub error_message: Option<String>,
}
