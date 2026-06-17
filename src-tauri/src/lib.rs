mod types;
mod adb;
mod fs;
mod transfer;
mod disks;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            adb::get_adb_devices,
            fs::list_local_files,
            fs::list_remote_files,
            fs::create_local_directory,
            fs::create_remote_directory,
            fs::delete_local_items,
            fs::delete_remote_items,
            fs::rename_local_item,
            fs::rename_remote_item,
            fs::get_home_directories,
            transfer::copy_files,
            disks::get_local_disks,
            disks::get_remote_disks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
