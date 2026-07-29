use super::model::{
    snapshot_from_readings, CompanionNotificationKind, CompanionNotificationPermission,
    NetworkStatus, PowerSnapshot, RawSystemReadings, SystemSnapshot,
};

pub(super) fn system_snapshot(
    observed_at_epoch_seconds: u64,
    include_desktop: bool,
    include_foreground: bool,
) -> SystemSnapshot {
    snapshot_from_readings(
        observed_at_epoch_seconds,
        include_desktop,
        include_foreground,
        RawSystemReadings {
            idle_seconds: None,
            frontmost_app_name: None,
            power: PowerSnapshot::default(),
            network: NetworkStatus::Unknown,
            low_power_mode: None,
            thermal_state: None,
        },
    )
}

pub(super) async fn notification_permission() -> Result<CompanionNotificationPermission, String> {
    Ok(CompanionNotificationPermission::Unsupported)
}

pub(super) async fn request_notification_permission(
) -> Result<CompanionNotificationPermission, String> {
    Ok(CompanionNotificationPermission::Unsupported)
}

pub(super) async fn send_notification(_kind: CompanionNotificationKind) -> Result<(), String> {
    Err("Companion notifications are not supported on this platform.".to_string())
}
