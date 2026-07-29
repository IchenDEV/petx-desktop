mod model;
mod resources;

#[cfg(not(target_os = "macos"))]
mod fallback;
#[cfg(target_os = "macos")]
mod macos;

use std::time::{SystemTime, UNIX_EPOCH};

pub use model::{CompanionNotificationKind, CompanionNotificationPermission, SystemSnapshot};
pub use resources::SystemResourceState;

#[cfg(not(target_os = "macos"))]
use fallback as platform;
#[cfg(target_os = "macos")]
use macos as platform;

#[tauri::command]
pub fn get_system_snapshot(
    resource_state: tauri::State<'_, SystemResourceState>,
    include_desktop: bool,
    include_foreground: bool,
) -> SystemSnapshot {
    let observed_at_epoch_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    let mut snapshot = platform::system_snapshot(
        observed_at_epoch_seconds,
        include_desktop,
        include_foreground,
    );
    snapshot.resources = resource_state.sample(include_desktop);
    snapshot
}

#[tauri::command]
pub async fn get_companion_notification_status() -> Result<CompanionNotificationPermission, String>
{
    platform::notification_permission().await
}

#[tauri::command]
pub async fn request_companion_notification_permission(
) -> Result<CompanionNotificationPermission, String> {
    platform::request_notification_permission().await
}

#[tauri::command]
pub async fn send_companion_notification(kind: CompanionNotificationKind) -> Result<(), String> {
    platform::send_notification(kind).await
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn privacy_disabled_snapshot_runs_without_foreground_collection() {
        let resource_state = SystemResourceState::default();
        let snapshot = platform::system_snapshot(42, false, false);

        assert_eq!(snapshot.version, model::SYSTEM_SNAPSHOT_VERSION);
        assert!(snapshot.frontmost_app_name.is_none());
        assert!(snapshot.idle_seconds.is_none());
        assert_eq!(snapshot.power, model::PowerSnapshot::default());
        assert_eq!(snapshot.network, model::NetworkStatus::Unknown);
        assert!(snapshot.low_power_mode.is_none());
        assert!(snapshot.thermal_state.is_none());
        assert!(snapshot.resources.is_none());
        assert!(resource_state.sample(false).is_none());
    }
}
