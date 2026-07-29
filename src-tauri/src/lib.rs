use tauri_plugin_autostart::MacosLauncher;

#[cfg(desktop)]
mod library;

#[cfg(desktop)]
mod desktop {
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        thread,
        time::Duration,
    };

    use tauri::{
        menu::{Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem},
        tray::TrayIconBuilder,
        App, AppHandle, Manager, Window, WindowEvent,
    };

    const MAIN_WINDOW_LABEL: &str = "main";
    const SETTINGS_WINDOW_LABEL: &str = "settings";
    const LIBRARY_WINDOW_LABEL: &str = "library";
    const TRAY_ID: &str = "petx";

    const SHOW_PET_MENU_ID: &str = "show-pet";
    const OPEN_LIBRARY_MENU_ID: &str = "open-library";
    const QUIET_FOR_ONE_HOUR_MENU_ID: &str = "quiet-for-one-hour";
    const OPEN_SETTINGS_MENU_ID: &str = "open-settings";
    const QUIT_MENU_ID: &str = "quit";

    const QUIET_DURATION: Duration = Duration::from_secs(60 * 60);

    #[derive(Default)]
    pub struct QuietState {
        generation: AtomicU64,
    }

    impl QuietState {
        fn advance(&self) -> u64 {
            self.generation
                .fetch_add(1, Ordering::SeqCst)
                .wrapping_add(1)
        }

        fn is_current(&self, generation: u64) -> bool {
            self.generation.load(Ordering::SeqCst) == generation
        }
    }

    pub fn setup(app: &mut App) -> tauri::Result<()> {
        let show_pet = MenuItemBuilder::with_id(SHOW_PET_MENU_ID, "显示宠物").build(app)?;
        let open_library =
            MenuItemBuilder::with_id(OPEN_LIBRARY_MENU_ID, "发现新伙伴…").build(app)?;
        let quiet_for_one_hour =
            MenuItemBuilder::with_id(QUIET_FOR_ONE_HOUR_MENU_ID, "安静一小时").build(app)?;
        let open_settings =
            MenuItemBuilder::with_id(OPEN_SETTINGS_MENU_ID, "打开设置").build(app)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItemBuilder::with_id(QUIT_MENU_ID, "退出").build(app)?;
        let menu = Menu::with_items(
            app,
            &[
                &show_pet,
                &open_library,
                &quiet_for_one_hour,
                &open_settings,
                &separator,
                &quit,
            ],
        )?;

        let mut tray = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .tooltip("PetX Desktop")
            .show_menu_on_left_click(true)
            .icon_as_template(cfg!(target_os = "macos"))
            .on_menu_event(handle_menu_event);

        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }

        tray.build(app)?;
        Ok(())
    }

    pub fn handle_window_event(window: &Window, event: &WindowEvent) {
        let is_managed_window = matches!(
            window.label(),
            MAIN_WINDOW_LABEL | SETTINGS_WINDOW_LABEL | LIBRARY_WINDOW_LABEL
        );

        if is_managed_window {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("failed to hide {} window: {error}", window.label());
                }
            }
        }
    }

    #[tauri::command]
    pub fn quit_app(app: AppHandle) {
        app.exit(0);
    }

    #[tauri::command]
    pub fn set_main_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "main companion window is unavailable".to_string())?;

        window
            .set_always_on_top(always_on_top)
            .map_err(|error| format!("failed to update the main companion window: {error}"))
    }

    #[tauri::command]
    pub fn quiet_for_one_hour(app: AppHandle) -> Result<(), String> {
        begin_quiet_period(&app).map_err(|error| error.to_string())
    }

    fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
        let result = match event.id().as_ref() {
            SHOW_PET_MENU_ID => show_pet(app),
            OPEN_LIBRARY_MENU_ID => open_library(app),
            QUIET_FOR_ONE_HOUR_MENU_ID => begin_quiet_period(app),
            OPEN_SETTINGS_MENU_ID => open_settings(app),
            QUIT_MENU_ID => {
                app.exit(0);
                Ok(())
            }
            _ => Ok(()),
        };

        if let Err(error) = result {
            eprintln!(
                "failed to handle tray menu item {}: {error}",
                event.id().as_ref()
            );
        }
    }

    fn show_pet(app: &AppHandle) -> tauri::Result<()> {
        app.state::<QuietState>().advance();

        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            window.show()?;
            window.unminimize()?;
        }

        Ok(())
    }

    fn begin_quiet_period(app: &AppHandle) -> tauri::Result<()> {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return Ok(());
        };

        window.hide()?;
        let generation = app.state::<QuietState>().advance();
        let app_handle = app.clone();

        thread::spawn(move || {
            thread::sleep(QUIET_DURATION);

            if app_handle.state::<QuietState>().is_current(generation) {
                if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    if let Err(error) = window.show() {
                        eprintln!("failed to restore pet after quiet period: {error}");
                    }
                }
            }
        });

        Ok(())
    }

    fn open_settings(app: &AppHandle) -> tauri::Result<()> {
        if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }

        Ok(())
    }

    fn open_library(app: &AppHandle) -> tauri::Result<()> {
        if let Some(window) = app.get_webview_window(LIBRARY_WINDOW_LABEL) {
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }

        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ));

    #[cfg(desktop)]
    let builder = builder
        .manage(desktop::QuietState::default())
        .manage(library::LibraryState::new().expect("failed to initialize pet library"))
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            desktop::quit_app,
            desktop::set_main_always_on_top,
            desktop::quiet_for_one_hour,
            library::get_petdex_catalog,
            library::get_petdex_preview,
            library::install_petdex_pet,
            library::list_installed_pets,
        ]);

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(desktop)]
            desktop::setup(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PetX Desktop");
}
