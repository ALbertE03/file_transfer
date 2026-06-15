mod adb;
mod wifi;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            adb::get_adb_devices,
            adb::list_local_files,
            adb::list_remote_files,
            adb::create_local_directory,
            adb::create_remote_directory,
            adb::delete_local_items,
            adb::delete_remote_items,
            adb::rename_local_item,
            adb::rename_remote_item,
            adb::get_home_directories,
            adb::copy_files,
            adb::get_local_disks,
            adb::get_remote_disks,
            adb::adb_connect,
            adb::adb_pair,
            adb::adb_enable_tcpip,
            wifi::scan_wifi_networks,
            wifi::connect_to_wifi
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
