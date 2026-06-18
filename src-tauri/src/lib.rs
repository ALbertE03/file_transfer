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
            fs::list_local_files_recursive,
            fs::list_remote_files_recursive,
            fs::is_local_dir,
            fs::is_remote_dir,
            transfer::copy_files,
            transfer::cancel_file,
            transfer::pause_file,
            transfer::resume_file,
            transfer::clear_tracking,
            disks::get_local_disks,
            disks::get_remote_disks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
