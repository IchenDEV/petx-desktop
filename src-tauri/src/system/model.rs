use serde::{Deserialize, Serialize};

pub const SYSTEM_SNAPSHOT_VERSION: u8 = 1;
const MAX_IDLE_SECONDS: f64 = 30.0 * 24.0 * 60.0 * 60.0;
const MAX_APP_NAME_CHARACTERS: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub version: u8,
    pub observed_at_epoch_seconds: u64,
    pub idle_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmost_app_name: Option<String>,
    pub power: PowerSnapshot,
    pub network: NetworkStatus,
    pub low_power_mode: Option<bool>,
    pub thermal_state: Option<ThermalState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<SystemResourceSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResourceSnapshot {
    pub cpu_percent: Option<u8>,
    pub network_received_bytes_per_second: Option<u64>,
    pub network_transmitted_bytes_per_second: Option<u64>,
    pub session_received_bytes: u64,
    pub session_transmitted_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSnapshot {
    pub source: PowerSource,
    pub percent: Option<u8>,
    pub charging: Option<bool>,
}

impl Default for PowerSnapshot {
    fn default() -> Self {
        Self {
            source: PowerSource::Unknown,
            percent: None,
            charging: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerSource {
    Ac,
    Battery,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkStatus {
    Reachable,
    Unreachable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThermalState {
    Nominal,
    Fair,
    Serious,
    Critical,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompanionNotificationKind {
    GentleCheckIn,
    RestReminder,
    WelcomeBack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompanionNotificationPermission {
    Authorized,
    Denied,
    Ephemeral,
    NotDetermined,
    Provisional,
    Unknown,
    Unsupported,
}

pub(super) struct RawSystemReadings {
    pub idle_seconds: Option<f64>,
    pub frontmost_app_name: Option<String>,
    pub power: PowerSnapshot,
    pub network: NetworkStatus,
    pub low_power_mode: Option<bool>,
    pub thermal_state: Option<ThermalState>,
}

pub(super) struct NotificationContent {
    pub identifier: &'static str,
    pub title: &'static str,
    pub body: &'static str,
}

pub(super) fn snapshot_from_readings(
    observed_at_epoch_seconds: u64,
    include_desktop: bool,
    include_foreground: bool,
    readings: RawSystemReadings,
) -> SystemSnapshot {
    SystemSnapshot {
        version: SYSTEM_SNAPSHOT_VERSION,
        observed_at_epoch_seconds,
        idle_seconds: include_desktop
            .then(|| normalize_idle_seconds(readings.idle_seconds))
            .flatten(),
        frontmost_app_name: if include_foreground {
            sanitize_app_name(readings.frontmost_app_name)
        } else {
            None
        },
        power: if include_desktop {
            readings.power
        } else {
            PowerSnapshot::default()
        },
        network: if include_desktop {
            readings.network
        } else {
            NetworkStatus::Unknown
        },
        low_power_mode: include_desktop.then_some(readings.low_power_mode).flatten(),
        thermal_state: include_desktop.then_some(readings.thermal_state).flatten(),
        resources: None,
    }
}

pub(super) fn normalize_idle_seconds(seconds: Option<f64>) -> Option<u64> {
    let seconds = seconds?;
    if !seconds.is_finite() || seconds.is_sign_negative() {
        return None;
    }
    let seconds = seconds.min(MAX_IDLE_SECONDS).floor() as u64;
    Some(match seconds {
        0..=29 => 0,
        30..=59 => 30,
        60..=299 => seconds / 60 * 60,
        300..=3_599 => seconds / 300 * 300,
        _ => seconds / 1_800 * 1_800,
    })
}

pub(super) fn normalize_power(
    source: PowerSource,
    current_capacity: Option<i64>,
    maximum_capacity: Option<i64>,
    charging: Option<bool>,
) -> PowerSnapshot {
    let percent = match (current_capacity, maximum_capacity) {
        (Some(current), Some(maximum)) if current >= 0 && maximum > 0 => {
            let percentage = current.saturating_mul(100) / maximum;
            Some(percentage.clamp(0, 100) as u8)
        }
        _ => None,
    };

    PowerSnapshot {
        source,
        percent,
        charging,
    }
}

pub(super) fn network_status_from_flags(
    reachable: bool,
    intervention_required: bool,
) -> NetworkStatus {
    if !reachable || intervention_required {
        NetworkStatus::Unreachable
    } else {
        NetworkStatus::Reachable
    }
}

pub(super) fn notification_content(kind: CompanionNotificationKind) -> NotificationContent {
    match kind {
        CompanionNotificationKind::GentleCheckIn => NotificationContent {
            identifier: "petx.gentle-check-in",
            title: "PetX 在桌面等你",
            body: "有空的时候，来看看我吧。",
        },
        CompanionNotificationKind::RestReminder => NotificationContent {
            identifier: "petx.low-battery",
            title: "我们都该充会儿电了",
            body: "电脑电量不多了，顺手接上电源吧。",
        },
        CompanionNotificationKind::WelcomeBack => NotificationContent {
            identifier: "petx.welcome-back",
            title: "我还在这里",
            body: "欢迎回来。要不要一起待一会？",
        },
    }
}

fn sanitize_app_name(value: Option<String>) -> Option<String> {
    let value = value?;
    let without_controls = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = without_controls
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_APP_NAME_CHARACTERS)
        .collect::<String>();

    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_omits_foreground_name_when_collection_is_disabled() {
        let snapshot = snapshot_from_readings(
            42,
            true,
            false,
            RawSystemReadings {
                idle_seconds: Some(15.8),
                frontmost_app_name: Some("Private Editor".to_string()),
                power: PowerSnapshot::default(),
                network: NetworkStatus::Unknown,
                low_power_mode: None,
                thermal_state: None,
            },
        );
        let serialized = serde_json::to_value(snapshot).expect("snapshot should serialize");

        assert_eq!(serialized["observedAtEpochSeconds"], 42);
        assert_eq!(serialized["idleSeconds"], 0);
        assert!(serialized.get("frontmostAppName").is_none());
        assert!(serialized.get("bundleId").is_none());
        assert!(serialized.get("windowTitle").is_none());
        assert!(serialized.get("document").is_none());
    }

    #[test]
    fn foreground_name_is_presentable_but_strips_control_and_excess_text() {
        let raw_name = format!("  Code\nEditor\u{0007}  {}", "x".repeat(100));
        let snapshot = snapshot_from_readings(
            42,
            true,
            true,
            RawSystemReadings {
                idle_seconds: None,
                frontmost_app_name: Some(raw_name),
                power: PowerSnapshot::default(),
                network: NetworkStatus::Unknown,
                low_power_mode: None,
                thermal_state: None,
            },
        );
        let name = snapshot
            .frontmost_app_name
            .expect("sanitized name should remain");

        assert!(name.starts_with("Code Editor"));
        assert!(!name.chars().any(char::is_control));
        assert!(name.chars().count() <= MAX_APP_NAME_CHARACTERS);
    }

    #[test]
    fn idle_seconds_reject_invalid_values_and_clamp_extremes() {
        assert_eq!(normalize_idle_seconds(None), None);
        assert_eq!(normalize_idle_seconds(Some(f64::NAN)), None);
        assert_eq!(normalize_idle_seconds(Some(-1.0)), None);
        assert_eq!(normalize_idle_seconds(Some(8.9)), Some(0));
        assert_eq!(normalize_idle_seconds(Some(45.0)), Some(30));
        assert_eq!(normalize_idle_seconds(Some(125.0)), Some(120));
        assert_eq!(normalize_idle_seconds(Some(374.0)), Some(300));
        assert_eq!(
            normalize_idle_seconds(Some(MAX_IDLE_SECONDS * 2.0)),
            Some(MAX_IDLE_SECONDS as u64)
        );
    }

    #[test]
    fn desktop_disabled_snapshot_drops_desktop_readings_defensively() {
        let snapshot = snapshot_from_readings(
            42,
            false,
            true,
            RawSystemReadings {
                idle_seconds: Some(600.0),
                frontmost_app_name: Some("Xcode".to_string()),
                power: PowerSnapshot {
                    source: PowerSource::Battery,
                    percent: Some(10),
                    charging: Some(false),
                },
                network: NetworkStatus::Reachable,
                low_power_mode: Some(true),
                thermal_state: Some(ThermalState::Critical),
            },
        );

        assert_eq!(snapshot.frontmost_app_name.as_deref(), Some("Xcode"));
        assert_eq!(snapshot.idle_seconds, None);
        assert_eq!(snapshot.power, PowerSnapshot::default());
        assert_eq!(snapshot.network, NetworkStatus::Unknown);
        assert_eq!(snapshot.low_power_mode, None);
        assert_eq!(snapshot.thermal_state, None);
    }

    #[test]
    fn battery_percentage_is_bounded_and_rejects_invalid_capacity() {
        assert_eq!(
            normalize_power(PowerSource::Battery, Some(40), Some(80), Some(false)),
            PowerSnapshot {
                source: PowerSource::Battery,
                percent: Some(50),
                charging: Some(false),
            }
        );
        assert_eq!(
            normalize_power(PowerSource::Ac, Some(120), Some(100), Some(true)).percent,
            Some(100)
        );
        assert_eq!(
            normalize_power(PowerSource::Unknown, Some(1), Some(0), None).percent,
            None
        );
    }

    #[test]
    fn reachability_requires_a_path_without_manual_intervention() {
        assert_eq!(
            network_status_from_flags(true, false),
            NetworkStatus::Reachable
        );
        assert_eq!(
            network_status_from_flags(false, false),
            NetworkStatus::Unreachable
        );
        assert_eq!(
            network_status_from_flags(true, true),
            NetworkStatus::Unreachable
        );
    }

    #[test]
    fn notification_kind_accepts_only_fixed_product_messages() {
        for kind in [
            CompanionNotificationKind::GentleCheckIn,
            CompanionNotificationKind::RestReminder,
            CompanionNotificationKind::WelcomeBack,
        ] {
            let content = notification_content(kind);
            assert!(content.identifier.starts_with("petx."));
            assert!(!content.title.is_empty());
            assert!(!content.body.is_empty());
        }

        assert!(
            serde_json::from_str::<CompanionNotificationKind>(r#""arbitraryMessage""#).is_err()
        );
    }

    #[test]
    fn resource_snapshot_never_serializes_interface_or_request_identity() {
        let resource = SystemResourceSnapshot {
            cpu_percent: Some(42),
            network_received_bytes_per_second: Some(1_024),
            network_transmitted_bytes_per_second: Some(512),
            session_received_bytes: 8_192,
            session_transmitted_bytes: 4_096,
        };
        let serialized = serde_json::to_value(resource).unwrap();

        assert_eq!(serialized["cpuPercent"], 42);
        for forbidden in [
            "interfaceName",
            "ipAddress",
            "macAddress",
            "domain",
            "url",
            "port",
            "process",
        ] {
            assert!(serialized.get(forbidden).is_none());
        }
    }
}
