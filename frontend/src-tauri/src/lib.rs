use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

const DEEP_LINK_SCHEMES: &[&str] = &["chronos://", "chronos-dev://"];
const DEEP_LINK_EVENT: &str = "deep-link://new-url";
const MAIN_WINDOW: &str = "main";

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let urls: Vec<String> = argv
        .into_iter()
        .filter(|arg| DEEP_LINK_SCHEMES.iter().any(|scheme| arg.starts_with(scheme)))
        .collect();

      if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
        if !urls.is_empty() {
          let _ = window.emit(DEEP_LINK_EVENT, urls);
        }
      }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let handle = app.handle().clone();
      app.deep_link().on_open_url(move |_event| {
        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
          let _ = window.show();
          let _ = window.set_focus();
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
