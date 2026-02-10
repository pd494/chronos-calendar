use serde::Deserialize;
use tauri::{Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

const DEEP_LINK_EVENT: &str = "deep-link://new-url";
const MAIN_WINDOW: &str = "main";

#[derive(Debug, Deserialize)]
struct DeepLinkPluginConfig {
  desktop: Option<DeepLinkDesktopConfig>,
}

#[derive(Debug, Deserialize)]
struct DeepLinkDesktopConfig {
  schemes: Option<Vec<String>>,
}

fn configured_deep_link_schemes<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
  let Some(value) = app.config().plugins.0.get("deep-link") else {
    return Vec::new();
  };
  let Ok(cfg) = serde_json::from_value::<DeepLinkPluginConfig>(value.clone()) else {
    return Vec::new();
  };
  cfg.desktop
    .and_then(|d| d.schemes)
    .unwrap_or_default()
    .into_iter()
    .filter(|s| !s.trim().is_empty())
    .collect()
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let schemes = configured_deep_link_schemes(app);
      let urls: Vec<String> = argv
        .into_iter()
        .filter(|arg| {
          schemes.is_empty()
            || Url::parse(arg)
              .ok()
              .is_some_and(|url| schemes.iter().any(|scheme| scheme == url.scheme()))
        })
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
    .plugin(tauri_plugin_keyring::init())
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
