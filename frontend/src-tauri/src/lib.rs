use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

fn focus_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let urls: Vec<String> = argv
        .into_iter()
        .filter(|arg| arg.starts_with("chronos://"))
        .collect();

      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        if !urls.is_empty() {
          let _ = window.emit("deep-link://new-url", urls);
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
        focus_main_window(&handle);
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
