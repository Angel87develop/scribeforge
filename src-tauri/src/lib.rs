//! ScribeForge application entry point.
//!
//! Wires the Tauri runtime, registers the command surface and shared state,
//! and installs the global error logger.

mod commands;
pub mod errors;
pub mod project;
pub mod settings;
mod state;
pub mod storage;
pub mod templates;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialise logging early so backend diagnostics are captured to a file
    // in the OS log/temp directory. We never log manuscript contents.
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .try_init();

    let app_state = AppState::init().unwrap_or_else(|e| {
        log::error!("Failed to initialise application state: {e}");
        AppState::default()
    });

    tauri::Builder::default()
        .manage(app_state)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window '{}' close requested", window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_categories,
            commands::list_templates,
            commands::get_template_preview,
            commands::list_recent_projects,
            commands::remove_recent_project,
            commands::open_existing_file_dialog,
            commands::open_project_at_path,
            commands::create_project,
            commands::get_current_project,
            commands::get_document,
            commands::save_current_project,
            commands::autosave_project,
            commands::save_project_as,
            commands::close_project,
            commands::is_project_dirty,
            commands::create_document,
            commands::rename_document,
            commands::duplicate_document,
            commands::move_document,
            commands::move_to_trash,
            commands::restore_from_trash,
            commands::purge_document,
            commands::empty_trash,
            commands::update_document,
            commands::search_project,
            commands::add_image_attachment,
            commands::list_image_attachments,
            commands::resize_image_attachment,
            commands::remove_image_attachment,
            commands::export_image_attachment,
            commands::pick_directory,
            commands::get_default_project_dir,
            commands::project_path_exists,
            commands::pick_save_file,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScribeForge");
}
