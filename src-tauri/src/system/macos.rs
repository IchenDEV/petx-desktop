use std::{
    net::{Ipv4Addr, SocketAddr},
    ptr::NonNull,
    sync::{Arc, Mutex},
};

use block2::RcBlock;
use objc2::runtime::{AnyClass, Bool};
use objc2_app_kit::NSWorkspace;
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFNumberType, CFString, CFType};
use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};
use objc2_foundation::{NSBundle, NSError, NSObjectProtocol, NSProcessInfo, NSString};
use objc2_io_kit::{
    IOPSCopyPowerSourcesInfo, IOPSCopyPowerSourcesList, IOPSGetPowerSourceDescription,
    IOPSGetProvidingPowerSourceType,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter,
};
use system_configuration::network_reachability::{ReachabilityFlags, SCNetworkReachability};
use tokio::sync::oneshot;

use super::model::{
    network_status_from_flags, normalize_power, notification_content, snapshot_from_readings,
    CompanionNotificationKind, CompanionNotificationPermission, NetworkStatus, PowerSnapshot,
    PowerSource, RawSystemReadings, SystemSnapshot, ThermalState,
};

const ANY_INPUT_EVENT_TYPE: CGEventType = CGEventType(u32::MAX);

pub(super) fn system_snapshot(
    observed_at_epoch_seconds: u64,
    include_desktop: bool,
    include_foreground: bool,
) -> SystemSnapshot {
    let (idle_seconds, power, network, low_power_mode, thermal_state) = if include_desktop {
        let process_info = NSProcessInfo::processInfo();
        (
            Some(CGEventSource::seconds_since_last_event_type(
                CGEventSourceStateID::CombinedSessionState,
                ANY_INPUT_EVENT_TYPE,
            )),
            power_snapshot(),
            network_status(),
            process_info
                .respondsToSelector(objc2::sel!(isLowPowerModeEnabled))
                .then(|| process_info.isLowPowerModeEnabled()),
            process_info
                .respondsToSelector(objc2::sel!(thermalState))
                .then(|| thermal_state(process_info.thermalState())),
        )
    } else {
        (
            None,
            PowerSnapshot::default(),
            NetworkStatus::Unknown,
            None,
            None,
        )
    };
    let readings = RawSystemReadings {
        idle_seconds,
        frontmost_app_name: if include_foreground {
            frontmost_app_name()
        } else {
            None
        },
        power,
        network,
        low_power_mode,
        thermal_state,
    };

    snapshot_from_readings(
        observed_at_epoch_seconds,
        include_desktop,
        include_foreground,
        readings,
    )
}

pub(super) async fn notification_permission() -> Result<CompanionNotificationPermission, String> {
    let Some(receiver) = begin_notification_status_request() else {
        return Ok(CompanionNotificationPermission::Unsupported);
    };

    receiver
        .await
        .map_err(|_| "The macOS notification status request was interrupted.".to_string())
}

pub(super) async fn request_notification_permission(
) -> Result<CompanionNotificationPermission, String> {
    let Some(receiver) = begin_notification_permission_request() else {
        return Ok(CompanionNotificationPermission::Unsupported);
    };

    receiver
        .await
        .map_err(|_| "The macOS notification permission request was interrupted.".to_string())??;

    notification_permission().await
}

pub(super) async fn send_notification(kind: CompanionNotificationKind) -> Result<(), String> {
    match notification_permission().await? {
        CompanionNotificationPermission::Authorized
        | CompanionNotificationPermission::Ephemeral
        | CompanionNotificationPermission::Provisional => {}
        CompanionNotificationPermission::NotDetermined => {
            return Err(
                "Notification permission has not been requested. Request it from settings first."
                    .to_string(),
            );
        }
        CompanionNotificationPermission::Denied => {
            return Err("Companion notifications are disabled in System Settings.".to_string());
        }
        CompanionNotificationPermission::Unknown | CompanionNotificationPermission::Unsupported => {
            return Err("Companion notification permission is unavailable.".to_string());
        }
    }

    begin_send_notification(kind)
        .await
        .map_err(|_| "The macOS notification request was interrupted.".to_string())?
}

fn frontmost_app_name() -> Option<String> {
    let application = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    if application
        .bundleIdentifier()
        .is_some_and(|identifier| identifier.to_string() == "dev.ichen.petx.desktop")
    {
        return None;
    }
    application.localizedName().map(|name| name.to_string())
}

fn power_snapshot() -> PowerSnapshot {
    let Some(information) = IOPSCopyPowerSourcesInfo() else {
        return PowerSnapshot::default();
    };

    let source = unsafe { IOPSGetProvidingPowerSourceType(Some(&information)) }
        .map(|value| match value.to_string().as_str() {
            "AC Power" => PowerSource::Ac,
            "Battery Power" => PowerSource::Battery,
            _ => PowerSource::Unknown,
        })
        .unwrap_or(PowerSource::Unknown);

    let Some(sources) = (unsafe { IOPSCopyPowerSourcesList(Some(&information)) }) else {
        return normalize_power(source, None, None, None);
    };
    let sources = unsafe { sources.cast_unchecked::<CFType>() };

    let mut selected = None;
    for power_source in sources.iter() {
        let Some(description) =
            (unsafe { IOPSGetPowerSourceDescription(Some(&information), Some(&power_source)) })
        else {
            continue;
        };
        let description = unsafe { description.cast_unchecked::<CFString, CFType>() };
        let is_internal_battery =
            cf_string(description, "Type").as_deref() == Some("InternalBattery");
        if is_internal_battery || selected.is_none() {
            selected = Some((
                cf_integer(description, "Current Capacity"),
                cf_integer(description, "Max Capacity"),
                cf_boolean(description, "Is Charging"),
            ));
        }
        if is_internal_battery {
            break;
        }
    }

    let (current, maximum, charging) = selected.unwrap_or((None, None, None));
    normalize_power(source, current, maximum, charging)
}

fn cf_string(dictionary: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
    dictionary
        .get(&CFString::from_str(key))?
        .downcast::<CFString>()
        .ok()
        .map(|value| value.to_string())
}

fn cf_integer(dictionary: &CFDictionary<CFString, CFType>, key: &str) -> Option<i64> {
    let number = dictionary
        .get(&CFString::from_str(key))?
        .downcast::<CFNumber>()
        .ok()?;
    let mut value = 0_i64;
    let succeeded =
        unsafe { number.value(CFNumberType::SInt64Type, (&mut value as *mut i64).cast()) };
    succeeded.then_some(value)
}

fn cf_boolean(dictionary: &CFDictionary<CFString, CFType>, key: &str) -> Option<bool> {
    dictionary
        .get(&CFString::from_str(key))?
        .downcast::<CFBoolean>()
        .ok()
        .map(|value| value.value())
}

fn network_status() -> NetworkStatus {
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0));
    let reachability = SCNetworkReachability::from(address);
    match reachability.reachability() {
        Ok(flags) => network_status_from_flags(
            flags.contains(ReachabilityFlags::REACHABLE),
            flags.contains(ReachabilityFlags::INTERVENTION_REQUIRED),
        ),
        Err(_) => NetworkStatus::Unknown,
    }
}

fn thermal_state(state: objc2_foundation::NSProcessInfoThermalState) -> ThermalState {
    use objc2_foundation::NSProcessInfoThermalState;

    if state == NSProcessInfoThermalState::Nominal {
        ThermalState::Nominal
    } else if state == NSProcessInfoThermalState::Fair {
        ThermalState::Fair
    } else if state == NSProcessInfoThermalState::Serious {
        ThermalState::Serious
    } else if state == NSProcessInfoThermalState::Critical {
        ThermalState::Critical
    } else {
        ThermalState::Unknown
    }
}

fn begin_notification_status_request() -> Option<oneshot::Receiver<CompanionNotificationPermission>>
{
    if !notifications_are_available() {
        return None;
    }

    let (sender, receiver) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let callback_sender = sender.clone();
    let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let permission =
            notification_permission_from_status(unsafe { settings.as_ref() }.authorizationStatus());
        if let Ok(mut sender) = callback_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(permission);
            }
        }
    });

    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&callback);
    Some(receiver)
}

fn begin_notification_permission_request() -> Option<oneshot::Receiver<Result<(), String>>> {
    if !notifications_are_available() {
        return None;
    }

    let (sender, receiver) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let callback_sender = sender.clone();
    let callback = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
        let result = error_message(error).map_or(Ok(()), Err);
        if let Ok(mut sender) = callback_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(result);
            }
        }
    });

    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert,
            &callback,
        );
    Some(receiver)
}

fn begin_send_notification(
    kind: CompanionNotificationKind,
) -> oneshot::Receiver<Result<(), String>> {
    let (sender, receiver) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let callback_sender = sender.clone();
    let callback = RcBlock::new(move |error: *mut NSError| {
        let result = error_message(error).map_or(Ok(()), Err);
        if let Ok(mut sender) = callback_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(result);
            }
        }
    });

    let copy = notification_content(kind);
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(copy.title));
    content.setBody(&NSString::from_str(copy.body));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(copy.identifier),
        &content,
        None,
    );
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
    receiver
}

fn notification_permission_from_status(
    status: UNAuthorizationStatus,
) -> CompanionNotificationPermission {
    if status == UNAuthorizationStatus::Authorized {
        CompanionNotificationPermission::Authorized
    } else if status == UNAuthorizationStatus::Denied {
        CompanionNotificationPermission::Denied
    } else if status == UNAuthorizationStatus::NotDetermined {
        CompanionNotificationPermission::NotDetermined
    } else if status == UNAuthorizationStatus::Provisional {
        CompanionNotificationPermission::Provisional
    } else if status == UNAuthorizationStatus::Ephemeral {
        CompanionNotificationPermission::Ephemeral
    } else {
        CompanionNotificationPermission::Unknown
    }
}

fn notifications_are_available() -> bool {
    AnyClass::get(c"UNUserNotificationCenter").is_some()
        && NSBundle::mainBundle().bundleIdentifier().is_some()
}

fn error_message(error: *mut NSError) -> Option<String> {
    unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string())
}
