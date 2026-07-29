import {
  COMPANION_STATE_VERSION,
  MAX_COMPANION_MEMORIES,
  createDefaultCompanionCare,
  createDefaultCompanionState,
  normalizeCompanionSize,
  normalizeNickname,
  type CompanionCare,
  type CompanionMemory,
  type CompanionPreferences,
  type CompanionState,
  type DailyProactivity,
  type IsoTimestamp,
  type LocalDate,
  type Mood,
  type ProactiveFrequency,
} from './model';

export const COMPANION_STORAGE_KEY = 'petx-desktop:companion-state';
export const COMPANION_PREFERENCES_STORAGE_KEY =
  'petx-desktop:companion-preferences';
export const LEGACY_SETTINGS_STORAGE_KEY = 'petx-desktop:settings';
export const DEFAULT_COMPANION_PROFILE_KEY = 'builtin:frieren';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadCompanionState(
  storage: StorageLike | null = browserStorage(),
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
  defaultNickname = 'Frieren',
): CompanionState {
  if (storage === null) return createDefaultCompanionState(defaultNickname);

  try {
    const storageKey = companionStateStorageKey(profileKey);
    const serialized = storage.getItem(storageKey);
    if (serialized !== null) {
      if (isNewerCompanionState(serialized)) {
        return withStoredPreferences(
          createDefaultCompanionState(defaultNickname),
          storage,
        );
      }
      const restored = decodeCompanionState(serialized, defaultNickname);
      if (restored !== null) {
        return withStoredPreferences(restored, storage);
      }
    }

    const migrated =
      profileKey === DEFAULT_COMPANION_PROFILE_KEY
        ? migrateLegacySettings(storage.getItem(LEGACY_SETTINGS_STORAGE_KEY))
        : null;
    if (migrated !== null) {
      storage.setItem(storageKey, serializeCompanionState(migrated));
      return withStoredPreferences(migrated, storage);
    }
  } catch {
    // localStorage can be unavailable in private or restricted environments.
  }

  const defaults = createDefaultCompanionState(defaultNickname);
  return storage === null ? defaults : withStoredPreferences(defaults, storage);
}

export function saveCompanionState(
  state: CompanionState,
  storage: StorageLike | null = browserStorage(),
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
): boolean {
  if (storage === null) return false;

  try {
    const storageKey = companionStateStorageKey(profileKey);
    const serialized = storage.getItem(storageKey);
    if (isNewerCompanionState(serialized)) return false;
    storage.setItem(storageKey, serializeCompanionState(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists relationship activity from the companion window while retaining
 * the freshest preferences written by the independently mounted settings
 * window.
 */
export function saveCompanionRelationshipState(
  state: CompanionState,
  storage: StorageLike | null = browserStorage(),
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
): boolean {
  if (storage === null) return false;

  try {
    const storageKey = companionStateStorageKey(profileKey);
    const serialized = storage.getItem(storageKey);
    if (isNewerCompanionState(serialized)) return false;
    const nextState = withStoredPreferences(state, storage);
    storage.setItem(
      storageKey,
      serializeCompanionState(nextState),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists preferences from the settings window while retaining the freshest
 * relationship activity written by the companion window.
 */
export function saveCompanionPreferences(
  preferences: CompanionPreferences,
  storage: StorageLike | null = browserStorage(),
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
  defaultNickname = 'Frieren',
): CompanionState | null {
  if (storage === null) return null;

  try {
    const serialized = storage.getItem(companionStateStorageKey(profileKey));
    if (isNewerCompanionState(serialized)) return null;
    const storedState =
      serialized === null
        ? createDefaultCompanionState(defaultNickname)
        : decodeCompanionState(serialized, defaultNickname);
    const nextState = {
      ...(storedState ?? createDefaultCompanionState(defaultNickname)),
      preferences,
    };
    storage.setItem(
      COMPANION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
    return nextState;
  } catch {
    return null;
  }
}

export function clearCompanionState(
  storage: StorageLike | null = browserStorage(),
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
): boolean {
  if (storage === null) return false;

  try {
    storage.removeItem(companionStateStorageKey(profileKey));
    storage.removeItem(COMPANION_PREFERENCES_STORAGE_KEY);
    // Prevent a subsequent load from resurrecting settings from the pre-v1 key.
    storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function serializeCompanionState(state: CompanionState): string {
  return JSON.stringify(state);
}

export function deserializeCompanionState(serialized: string): CompanionState {
  return decodeCompanionState(serialized, 'Frieren') ??
    createDefaultCompanionState();
}

export function companionStateStorageKey(
  profileKey = DEFAULT_COMPANION_PROFILE_KEY,
): string {
  return profileKey === DEFAULT_COMPANION_PROFILE_KEY
    ? COMPANION_STORAGE_KEY
    : `${COMPANION_STORAGE_KEY}:profile:${encodeURIComponent(profileKey)}`;
}

function decodeCompanionState(
  serialized: string,
  defaultNickname: string,
): CompanionState | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== COMPANION_STATE_VERSION)
  ) {
    return null;
  }

  const defaults = createDefaultCompanionState(defaultNickname);
  const preferences = parsePreferences(value.preferences, defaults.preferences);
  const memories = Array.isArray(value.memories)
    ? value.memories
        .map(parseMemory)
        .filter((memory): memory is CompanionMemory => memory !== null)
        .slice(-MAX_COMPANION_MEMORIES)
    : defaults.memories;
  const meaningfulInteractionDates = Array.isArray(
    value.meaningfulInteractionDates,
  )
    ? [
        ...new Set(
          value.meaningfulInteractionDates.filter(isLocalDate),
        ),
      ]
    : defaults.meaningfulInteractionDates;

  return {
    version: COMPANION_STATE_VERSION,
    nickname: parseNickname(value.nickname, defaults.nickname),
    mood: isMood(value.mood) ? value.mood : defaults.mood,
    energy: finiteNumber(value.energy, defaults.energy, 0, 100),
    bond: finiteNumber(value.bond, defaults.bond, 0, 100),
    firstInteractionAt: nullableTimestamp(value.firstInteractionAt),
    lastInteractionAt: nullableTimestamp(value.lastInteractionAt),
    meaningfulInteractionDates,
    memories,
    care:
      value.version === 1
        ? createDefaultCompanionCare()
        : parseCare(value.care, defaults.care),
    proactivity: parseProactivity(value.proactivity),
    preferences,
  };
}

function isNewerCompanionState(serialized: string | null): boolean {
  if (serialized === null) return false;
  try {
    const value: unknown = JSON.parse(serialized);
    return (
      isRecord(value) &&
      typeof value.version === 'number' &&
      value.version > COMPANION_STATE_VERSION
    );
  } catch {
    return false;
  }
}

function withStoredPreferences(
  state: CompanionState,
  storage: StorageLike,
): CompanionState {
  const serialized = storage.getItem(COMPANION_PREFERENCES_STORAGE_KEY);
  if (serialized === null) return state;

  try {
    const value: unknown = JSON.parse(serialized);
    return {
      ...state,
      preferences: parsePreferences(value, state.preferences),
    };
  } catch {
    return state;
  }
}

function migrateLegacySettings(serialized: string | null): CompanionState | null {
  if (serialized === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const state = createDefaultCompanionState();
  const size =
    typeof value.size === 'number'
      ? normalizeCompanionSize(value.size)
      : state.preferences.size;
  const alwaysOnTop =
    typeof value.alwaysOnTop === 'boolean'
      ? value.alwaysOnTop
      : state.preferences.alwaysOnTop;

  return {
    ...state,
    preferences: {
      ...state.preferences,
      size,
      alwaysOnTop,
    },
  };
}

function parsePreferences(
  value: unknown,
  defaults: CompanionPreferences,
): CompanionPreferences {
  if (!isRecord(value)) return defaults;

  const quietHours = isRecord(value.quietHours)
    ? {
        enabled: booleanValue(
          value.quietHours.enabled,
          defaults.quietHours.enabled,
        ),
        startMinute: integer(
          value.quietHours.startMinute,
          defaults.quietHours.startMinute,
          0,
          24 * 60 - 1,
        ),
        endMinute: integer(
          value.quietHours.endMinute,
          defaults.quietHours.endMinute,
          0,
          24 * 60 - 1,
        ),
      }
    : defaults.quietHours;

  const sound = isRecord(value.sound)
    ? {
        enabled: booleanValue(value.sound.enabled, defaults.sound.enabled),
        volume: finiteNumber(value.sound.volume, defaults.sound.volume, 0, 1),
      }
    : defaults.sound;

  return {
    proactiveFrequency: isProactiveFrequency(value.proactiveFrequency)
      ? value.proactiveFrequency
      : defaults.proactiveFrequency,
    quietHours,
    sound,
    alwaysOnTop: booleanValue(value.alwaysOnTop, defaults.alwaysOnTop),
    launchAtLogin: booleanValue(
      value.launchAtLogin,
      defaults.launchAtLogin,
    ),
    size:
      typeof value.size === 'number'
        ? normalizeCompanionSize(value.size)
        : defaults.size,
  };
}

function parseProactivity(value: unknown): DailyProactivity {
  const defaults: DailyProactivity = {
    localDate: null,
    shownCount: 0,
    ignoredCount: 0,
    lastShownAt: null,
    pendingSince: null,
  };
  if (!isRecord(value)) return defaults;

  return {
    localDate:
      value.localDate === null || isLocalDate(value.localDate)
        ? value.localDate
        : null,
    shownCount: integer(value.shownCount, 0, 0, Number.MAX_SAFE_INTEGER),
    ignoredCount: integer(
      value.ignoredCount,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    lastShownAt: nullableTimestamp(value.lastShownAt),
    pendingSince: nullableTimestamp(value.pendingSince),
  };
}

function parseCare(
  value: unknown,
  defaults: CompanionCare,
): CompanionCare {
  if (!isRecord(value)) return defaults;

  return {
    satiety: finiteNumber(value.satiety, defaults.satiety, 50, 100),
    satietyUpdatedAt: nullableTimestamp(value.satietyUpdatedAt),
    lastFedAt: nullableTimestamp(value.lastFedAt),
    lastPlayedAt: nullableTimestamp(value.lastPlayedAt),
    lastRestedAt: nullableTimestamp(value.lastRestedAt),
  };
}

function parseMemory(value: unknown): CompanionMemory | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isTimestamp(value.occurredAt) ||
    !isLocalDate(value.localDate)
  ) {
    return null;
  }

  const base = {
    id: value.id,
    occurredAt: value.occurredAt,
    localDate: value.localDate,
  };

  switch (value.kind) {
    case 'first-interaction':
    case 'shared-day':
      if (!isMeaningfulInteraction(value.interaction)) return null;
      return {
        ...base,
        kind: value.kind,
        interaction: value.interaction,
      };
    case 'rename':
      if (
        typeof value.previousNickname !== 'string' ||
        typeof value.nickname !== 'string'
      ) {
        return null;
      }
      return {
        ...base,
        kind: 'rename',
        previousNickname: value.previousNickname,
        nickname: value.nickname,
      };
    case 'keepsake':
      if (
        typeof value.keepsakeId !== 'string' ||
        typeof value.name !== 'string' ||
        (value.note !== undefined && typeof value.note !== 'string')
      ) {
        return null;
      }
      return {
        ...base,
        kind: 'keepsake',
        keepsakeId: value.keepsakeId,
        name: value.name,
        ...(value.note === undefined ? {} : { note: value.note }),
      };
    default:
      return null;
  }
}

function parseNickname(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try {
    return normalizeNickname(value);
  } catch {
    return fallback;
  }
}

function nullableTimestamp(value: unknown): IsoTimestamp | null {
  return value === null || isTimestamp(value) ? value : null;
}

function isTimestamp(value: unknown): value is IsoTimestamp {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMood(value: unknown): value is Mood {
  return (
    value === 'calm' ||
    value === 'curious' ||
    value === 'content' ||
    value === 'playful' ||
    value === 'sleepy'
  );
}

function isProactiveFrequency(value: unknown): value is ProactiveFrequency {
  return (
    value === 'off' ||
    value === 'quiet' ||
    value === 'balanced' ||
    value === 'lively'
  );
}

function isMeaningfulInteraction(
  value: unknown,
): value is 'greet' | 'pet' | 'play' | 'feed' | 'rest' | 'rename' {
  return (
    value === 'greet' ||
    value === 'pet' ||
    value === 'play' ||
    value === 'feed' ||
    value === 'rest' ||
    value === 'rename'
  );
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.trunc(finiteNumber(value, fallback, minimum, maximum));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
