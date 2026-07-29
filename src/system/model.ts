export type NetworkReachability =
  | 'reachable'
  | 'unreachable'
  | 'unknown';

export type PowerSource = 'ac' | 'battery' | 'ups' | 'unknown';

export type ThermalState =
  | 'nominal'
  | 'fair'
  | 'serious'
  | 'critical'
  | 'unknown';

export interface SystemPowerSnapshot {
  source: PowerSource;
  percent: number | null;
  charging: boolean | null;
}

export interface SystemResourceSnapshot {
  /** Whole-system CPU usage, intentionally rounded to an integer percent. */
  cpuPercent: number | null;
  /** Aggregate non-loopback traffic; no domains, URLs, or request contents. */
  networkReceivedBytesPerSecond: number | null;
  networkTransmittedBytesPerSecond: number | null;
  /** Bytes observed since this opt-in monitoring session started. */
  sessionReceivedBytes: number;
  sessionTransmittedBytes: number;
}

/**
 * A deliberately small, ephemeral view of the current desktop.
 *
 * It never contains window titles, document names, notification contents,
 * bundle identifiers, or history. Consumers must not persist it.
 */
export interface SystemSnapshot {
  observedAtEpochSeconds: number;
  idleSeconds: number | null;
  frontmostAppName: string | null;
  power: SystemPowerSnapshot;
  network: NetworkReachability;
  lowPowerMode: boolean | null;
  thermalState: ThermalState | null;
  resources: SystemResourceSnapshot | null;
}

export type CompanionNotificationStatus =
  | 'notDetermined'
  | 'authorized'
  | 'denied'
  | 'ephemeral'
  | 'provisional'
  | 'unknown'
  | 'unsupported';

export type CompanionNotificationReason =
  | 'test'
  | 'welcome-back'
  | 'low-battery';

export function companionNotificationIsAllowed(
  status: CompanionNotificationStatus,
) {
  return (
    status === 'authorized' ||
    status === 'ephemeral' ||
    status === 'provisional'
  );
}

export interface SystemPreferences {
  /**
   * Lets the companion react to aggregate idle time, power, and reachability.
   * These signals are sampled locally and are never added to relationship
   * memories.
   */
  desktopAwareness: boolean;
  /**
   * An explicit opt-in because even an application name can be sensitive.
   * Window titles and document names are never sampled.
   */
  foregroundAppAwareness: boolean;
  /** PetX's own optional notifications; never notifications from other apps. */
  companionNotifications: boolean;
}

export const SYSTEM_PREFERENCES_STORAGE_KEY =
  'petx-desktop:system-preferences';
export const SYSTEM_PREFERENCES_CHANGED_EVENT =
  'petx://system-preferences-changed';

export function createDefaultSystemPreferences(): SystemPreferences {
  return {
    desktopAwareness: false,
    foregroundAppAwareness: false,
    companionNotifications: false,
  };
}

export function loadSystemPreferences(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): SystemPreferences {
  const defaults = createDefaultSystemPreferences();
  if (storage === null) return defaults;

  try {
    const serialized = storage.getItem(SYSTEM_PREFERENCES_STORAGE_KEY);
    if (serialized === null) return defaults;
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return defaults;
    return {
      desktopAwareness: booleanOr(
        value.desktopAwareness,
        defaults.desktopAwareness,
      ),
      foregroundAppAwareness: booleanOr(
        value.foregroundAppAwareness,
        defaults.foregroundAppAwareness,
      ),
      companionNotifications: booleanOr(
        value.companionNotifications,
        defaults.companionNotifications,
      ),
    };
  } catch {
    return defaults;
  }
}

export function saveSystemPreferences(
  preferences: SystemPreferences,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(
      SYSTEM_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
