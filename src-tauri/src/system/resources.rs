use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use sysinfo::{Networks, System, IS_SUPPORTED_SYSTEM};

use super::model::SystemResourceSnapshot;

#[derive(Default)]
pub struct SystemResourceState {
    sampler: Mutex<ResourceSampler>,
}

impl SystemResourceState {
    pub fn sample(&self, enabled: bool) -> Option<SystemResourceSnapshot> {
        let mut sampler = self.sampler.lock().ok()?;
        sampler.sample(enabled)
    }
}

#[derive(Default)]
struct ResourceSampler {
    system: Option<System>,
    networks: Option<Networks>,
    previous_network_totals: HashMap<String, (u64, u64)>,
    last_sample_at: Option<Instant>,
    session_received_bytes: u64,
    session_transmitted_bytes: u64,
}

impl ResourceSampler {
    fn sample(&mut self, enabled: bool) -> Option<SystemResourceSnapshot> {
        if !enabled {
            self.reset();
            return None;
        }
        if !IS_SUPPORTED_SYSTEM {
            return None;
        }
        if self.system.is_none() || self.networks.is_none() {
            return Some(self.prime());
        }

        let now = Instant::now();
        let elapsed = self
            .last_sample_at
            .map(|previous| now.saturating_duration_since(previous));
        let system = self.system.as_mut()?;
        let networks = self.networks.as_mut()?;
        system.refresh_cpu_usage();
        networks.refresh(true);

        let current_totals = network_totals(networks);
        let (received_delta, transmitted_delta) =
            network_delta(&self.previous_network_totals, &current_totals);
        self.previous_network_totals = current_totals;
        self.last_sample_at = Some(now);
        self.session_received_bytes = self.session_received_bytes.saturating_add(received_delta);
        self.session_transmitted_bytes = self
            .session_transmitted_bytes
            .saturating_add(transmitted_delta);

        Some(SystemResourceSnapshot {
            cpu_percent: normalize_cpu_percent(system.global_cpu_usage()),
            network_received_bytes_per_second: elapsed
                .and_then(|duration| bytes_per_second(received_delta, duration)),
            network_transmitted_bytes_per_second: elapsed
                .and_then(|duration| bytes_per_second(transmitted_delta, duration)),
            session_received_bytes: self.session_received_bytes,
            session_transmitted_bytes: self.session_transmitted_bytes,
        })
    }

    fn prime(&mut self) -> SystemResourceSnapshot {
        let mut system = System::new();
        system.refresh_cpu_usage();
        let networks = Networks::new_with_refreshed_list();
        self.previous_network_totals = network_totals(&networks);
        self.system = Some(system);
        self.networks = Some(networks);
        self.last_sample_at = Some(Instant::now());
        self.session_received_bytes = 0;
        self.session_transmitted_bytes = 0;

        SystemResourceSnapshot {
            cpu_percent: None,
            network_received_bytes_per_second: None,
            network_transmitted_bytes_per_second: None,
            session_received_bytes: 0,
            session_transmitted_bytes: 0,
        }
    }

    fn reset(&mut self) {
        self.system = None;
        self.networks = None;
        self.previous_network_totals.clear();
        self.last_sample_at = None;
        self.session_received_bytes = 0;
        self.session_transmitted_bytes = 0;
    }
}

fn network_totals(networks: &Networks) -> HashMap<String, (u64, u64)> {
    networks
        .iter()
        .filter(|(name, data)| !is_loopback_interface(name, data.ip_networks()))
        .map(|(name, data)| {
            (
                name.clone(),
                (data.total_received(), data.total_transmitted()),
            )
        })
        .collect()
}

fn network_delta(
    previous: &HashMap<String, (u64, u64)>,
    current: &HashMap<String, (u64, u64)>,
) -> (u64, u64) {
    current
        .iter()
        .filter_map(|(name, &(received, transmitted))| {
            let &(previous_received, previous_transmitted) = previous.get(name)?;
            Some((
                received.saturating_sub(previous_received),
                transmitted.saturating_sub(previous_transmitted),
            ))
        })
        .fold((0_u64, 0_u64), |accumulator, delta| {
            (
                accumulator.0.saturating_add(delta.0),
                accumulator.1.saturating_add(delta.1),
            )
        })
}

fn is_loopback_interface(name: &str, networks: &[sysinfo::IpNetwork]) -> bool {
    if !networks.is_empty() {
        return networks.iter().all(|network| network.addr.is_loopback());
    }
    let normalized = name.to_ascii_lowercase();
    let numbered_loopback = normalized.strip_prefix("lo").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
    });
    let aliased_loopback = normalized.strip_prefix("lo:").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
    });
    normalized == "lo"
        || numbered_loopback
        || aliased_loopback
        || normalized.starts_with("loopback pseudo-interface ")
}

fn normalize_cpu_percent(value: f32) -> Option<u8> {
    value
        .is_finite()
        .then(|| value.clamp(0.0, 100.0).round() as u8)
}

fn bytes_per_second(bytes: u64, elapsed: Duration) -> Option<u64> {
    let elapsed_seconds = elapsed.as_secs_f64();
    if elapsed_seconds < 0.1 {
        return None;
    }
    Some((bytes as f64 / elapsed_seconds).round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_loopback_interfaces_without_hiding_normal_links() {
        for name in ["lo", "lo0", "lo:1", "Loopback Pseudo-Interface 1"] {
            assert!(
                is_loopback_interface(name, &[]),
                "{name} should be excluded"
            );
        }
        for name in ["en0", "eth0", "utun3", "Wi-Fi", "global-link"] {
            assert!(
                !is_loopback_interface(name, &[]),
                "{name} should be included"
            );
        }
        let loopback_networks = ["127.0.0.1/8".parse().unwrap(), "::1/128".parse().unwrap()];
        assert!(is_loopback_interface("custom0", &loopback_networks));
        let mixed_networks = [
            "127.0.0.1/8".parse().unwrap(),
            "192.0.2.10/24".parse().unwrap(),
        ];
        assert!(!is_loopback_interface("lo0", &mixed_networks));
    }

    #[test]
    fn network_delta_ignores_new_and_reset_interfaces() {
        let previous = HashMap::from([
            ("en0".to_string(), (1_000, 500)),
            ("old".to_string(), (200, 100)),
            ("reset".to_string(), (100, 100)),
        ]);
        let current = HashMap::from([
            ("en0".to_string(), (1_300, 650)),
            ("new".to_string(), (10_000, 20_000)),
            ("reset".to_string(), (1, 1)),
        ]);

        assert_eq!(network_delta(&previous, &current), (300, 150));
    }

    #[test]
    fn resource_values_are_bounded_and_rate_uses_elapsed_time() {
        assert_eq!(normalize_cpu_percent(f32::NAN), None);
        assert_eq!(normalize_cpu_percent(-5.0), Some(0));
        assert_eq!(normalize_cpu_percent(42.6), Some(43));
        assert_eq!(normalize_cpu_percent(140.0), Some(100));
        assert_eq!(bytes_per_second(1_000, Duration::from_secs(2)), Some(500));
        assert_eq!(bytes_per_second(1_000, Duration::ZERO), None);
    }

    #[test]
    fn disabling_monitoring_discards_its_session() {
        let mut sampler = ResourceSampler {
            system: Some(System::new()),
            networks: Some(Networks::new()),
            previous_network_totals: HashMap::from([("en0".to_string(), (100, 200))]),
            last_sample_at: Some(Instant::now()),
            session_received_bytes: 42,
            session_transmitted_bytes: 24,
        };

        assert_eq!(sampler.sample(false), None);
        assert_eq!(sampler.session_received_bytes, 0);
        assert_eq!(sampler.session_transmitted_bytes, 0);
        assert!(sampler.system.is_none());
        assert!(sampler.networks.is_none());
        assert!(sampler.previous_network_totals.is_empty());
        assert!(sampler.last_sample_at.is_none());
    }
}
