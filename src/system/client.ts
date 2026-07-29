import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../platform';
import type {
  CompanionNotificationReason,
  CompanionNotificationStatus,
  SystemSnapshot,
} from './model';

export async function fetchSystemSnapshot(
  includeDesktop: boolean,
  includeForeground: boolean,
): Promise<SystemSnapshot> {
  if (isTauri) {
    const snapshot = await invoke<
      Omit<SystemSnapshot, 'frontmostAppName' | 'resources'> & {
        frontmostAppName?: string | null;
        resources?: SystemSnapshot['resources'];
      }
    >('get_system_snapshot', {
      includeDesktop,
      includeForeground,
    });
    return {
      ...snapshot,
      frontmostAppName: snapshot.frontmostAppName ?? null,
      thermalState: snapshot.thermalState ?? null,
      resources: snapshot.resources ?? null,
    };
  }

  return {
    observedAtEpochSeconds: Date.now() / 1000,
    idleSeconds: null,
    frontmostAppName: null,
    power: {
      source: 'unknown',
      percent: null,
      charging: null,
    },
    network: includeDesktop
      ? navigator.onLine
        ? 'reachable'
        : 'unreachable'
      : 'unknown',
    lowPowerMode: null,
    thermalState: 'unknown',
    resources: null,
  };
}

export async function getCompanionNotificationStatus(): Promise<CompanionNotificationStatus> {
  if (!isTauri) return 'unsupported';
  return invoke<CompanionNotificationStatus>(
    'get_companion_notification_status',
  );
}

export async function requestCompanionNotificationPermission(): Promise<CompanionNotificationStatus> {
  if (!isTauri) return 'unsupported';
  return invoke<CompanionNotificationStatus>(
    'request_companion_notification_permission',
  );
}

export async function sendCompanionNotification(
  reason: CompanionNotificationReason,
): Promise<void> {
  if (!isTauri) {
    throw new Error('系统通知只在 PetX 桌面版中可用。');
  }
  const kind = {
    test: 'gentleCheckIn',
    'welcome-back': 'welcomeBack',
    'low-battery': 'restReminder',
  } as const;
  await invoke('send_companion_notification', { kind: kind[reason] });
}
