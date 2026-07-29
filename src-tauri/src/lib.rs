use tauri_plugin_autostart::MacosLauncher;

#[cfg(desktop)]
mod library;
#[cfg(desktop)]
mod system;

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
        App, AppHandle, Emitter, Manager, Window, WindowEvent,
    };

    const MAIN_WINDOW_LABEL: &str = "main";
    const SETTINGS_WINDOW_LABEL: &str = "settings";
    const LIBRARY_WINDOW_LABEL: &str = "library";
    const TRAY_ID: &str = "petx";

    const SHOW_PET_MENU_ID: &str = "show-pet";
    const OPEN_PRESENCE_MENU_ID: &str = "open-presence";
    const OPEN_LIBRARY_MENU_ID: &str = "open-library";
    const QUIET_FOR_ONE_HOUR_MENU_ID: &str = "quiet-for-one-hour";
    const OPEN_SETTINGS_MENU_ID: &str = "open-settings";
    const QUIT_MENU_ID: &str = "quit";

    const QUIET_DURATION: Duration = Duration::from_secs(60 * 60);

    #[derive(Default)]
    pub struct QuietState {
        generation: AtomicU64,
        active_generation: AtomicU64,
    }

    impl QuietState {
        fn begin(&self) -> u64 {
            let generation = self
                .generation
                .fetch_add(1, Ordering::SeqCst)
                .wrapping_add(1);
            self.active_generation.store(generation, Ordering::SeqCst);
            generation
        }

        fn cancel(&self) -> bool {
            self.active_generation.swap(0, Ordering::SeqCst) != 0
        }

        fn finish(&self, generation: u64) -> bool {
            self.active_generation
                .compare_exchange(generation, 0, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        }

        fn is_active(&self) -> bool {
            self.active_generation.load(Ordering::SeqCst) != 0
        }
    }

    pub fn setup(app: &mut App) -> tauri::Result<()> {
        let show_pet = MenuItemBuilder::with_id(SHOW_PET_MENU_ID, "显示宠物").build(app)?;
        let open_presence =
            MenuItemBuilder::with_id(OPEN_PRESENCE_MENU_ID, "桌面札记…").build(app)?;
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
                &open_presence,
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

    #[tauri::command]
    pub fn is_quiet_period_active(app: AppHandle) -> bool {
        app.state::<QuietState>().is_active()
    }

    fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
        let result = match event.id().as_ref() {
            SHOW_PET_MENU_ID => show_pet(app),
            OPEN_PRESENCE_MENU_ID => open_presence(app),
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
        let quiet_cancelled = app.state::<QuietState>().cancel();

        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            window.show()?;
            window.unminimize()?;
            if quiet_cancelled {
                window.emit("petx://quiet-period-changed", false)?;
            }
        }

        Ok(())
    }

    fn begin_quiet_period(app: &AppHandle) -> tauri::Result<()> {
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return Ok(());
        };

        window.hide()?;
        let generation = app.state::<QuietState>().begin();
        if let Err(error) = window.emit("petx://quiet-period-changed", true) {
            eprintln!("failed to notify the pet about quiet time: {error}");
        }
        let app_handle = app.clone();

        thread::spawn(move || {
            thread::sleep(QUIET_DURATION);

            if app_handle.state::<QuietState>().finish(generation) {
                if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    if let Err(error) = window.emit("petx://quiet-period-changed", false) {
                        eprintln!("failed to finish the pet quiet-time event: {error}");
                    }
                    if let Err(error) = window.show() {
                        eprintln!("failed to restore pet after quiet period: {error}");
                    }
                }
            }
        });

        Ok(())
    }

    fn open_presence(app: &AppHandle) -> tauri::Result<()> {
        show_pet(app)?;
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            window.emit("petx://open-presence", ())?;
        }
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

    #[cfg(test)]
    mod tests {
        use super::QuietState;

        #[test]
        fn quiet_state_only_finishes_the_current_period() {
            let state = QuietState::default();
            let first = state.begin();
            let second = state.begin();

            assert!(state.is_active());
            assert!(!state.finish(first));
            assert!(state.is_active());
            assert!(state.finish(second));
            assert!(!state.is_active());
            assert!(!state.cancel());
        }
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
        .manage(system::SystemResourceState::default())
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            desktop::quit_app,
            desktop::set_main_always_on_top,
            desktop::quiet_for_one_hour,
            desktop::is_quiet_period_active,
            library::get_petdex_catalog,
            library::get_petdex_preview,
            library::get_petshare_catalog,
            library::get_petshare_preview,
            library::install_petdex_pet,
            library::install_petshare_pet,
            library::list_installed_pets,
            library::active::get_active_pet,
            library::active::set_active_pet,
            library::active::reset_active_pet,
            system::get_system_snapshot,
            system::get_companion_notification_status,
            system::request_companion_notification_permission,
            system::send_companion_notification,
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
