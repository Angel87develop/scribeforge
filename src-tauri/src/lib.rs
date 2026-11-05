//! ScribeForge application entry point.
//!
//! Wires the Tauri runtime, registers the command surface and shared state,
//! and installs the global error logger.

mod commands;
pub mod compile;
pub mod errors;
pub mod format_profiles;
pub mod import;
pub mod organization;
pub mod project;
pub mod settings;
mod state;
pub mod storage;
pub mod sync;
pub mod templates;
pub mod writing;

use state::AppState;
use tauri::Manager;

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
                // Save and tell other computers the project is closed here.
                window.state::<AppState>().release_on_exit();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_categories,
            commands::list_templates,
            commands::get_template_preview,
            commands::list_recent_projects,
            commands::remove_recent_project,
            commands::pick_project_file,
            commands::pick_scrivener_project,
            commands::import_scrivener,
            commands::check_project_open,
            commands::list_conflict_copies,
            commands::get_sync_status,
            commands::sync_poll,
            commands::reload_from_disk,
            commands::get_sync_conflict,
            commands::sync_conflict_diff,
            commands::resolve_sync_conflict,
            commands::cancel_sync_conflict,
            commands::trash_conflict_copy,
            commands::sync_take_over,
            commands::list_local_backups,
            commands::restore_local_backup,
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
            commands::list_compile_presets,
            commands::list_format_profiles,
            commands::compile_project,
            commands::compile_preview,
            commands::get_preferences,
            commands::update_preferences,
            commands::set_wallpaper,
            commands::get_wallpaper,
            commands::get_writing_goals,
            commands::set_writing_goals,
            commands::reset_writing_session,
            commands::get_writing_stats,
            commands::create_snapshot,
            commands::list_snapshots,
            commands::get_snapshot,
            commands::rename_snapshot,
            commands::delete_snapshot,
            commands::restore_snapshot,
            commands::diff_snapshot,
            commands::get_spelling,
            commands::set_spell_language,
            commands::add_to_dictionary,
            commands::remove_from_dictionary,
            commands::spell_check,
            commands::spell_suggest,
            commands::find_in_project,
            commands::replace_in_project,
            commands::get_organization,
            commands::set_organization,
            commands::list_collections,
            commands::save_collection,
            commands::delete_collection,
            commands::move_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::collection_items,
            commands::get_links,
            commands::get_timeline,
            commands::save_timeline_event,
            commands::delete_timeline_event,
            commands::reset_card_positions,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScribeForge");
}
