import { describe, expect, it } from 'vitest';
import {
  createDefaultSystemPreferences,
  loadSystemPreferences,
  saveSystemPreferences,
  SYSTEM_PREFERENCES_STORAGE_KEY,
  type SystemPreferences,
} from './model';

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('system preferences', () => {
  it('keeps foreground app awareness opt-in', () => {
    expect(createDefaultSystemPreferences()).toEqual({
      desktopAwareness: false,
      foregroundAppAwareness: false,
      companionNotifications: false,
    });
  });

  it('round trips independently from relationship state', () => {
    const storage = new MemoryStorage();
    const preferences: SystemPreferences = {
      desktopAwareness: false,
      foregroundAppAwareness: true,
      companionNotifications: true,
    };

    expect(saveSystemPreferences(preferences, storage)).toBe(true);
    expect(loadSystemPreferences(storage)).toEqual(preferences);
    expect(storage.values.has(SYSTEM_PREFERENCES_STORAGE_KEY)).toBe(true);
  });

  it('falls back field by field for malformed stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SYSTEM_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        desktopAwareness: false,
        foregroundAppAwareness: 'yes',
      }),
    );

    expect(loadSystemPreferences(storage)).toEqual({
      desktopAwareness: false,
      foregroundAppAwareness: false,
      companionNotifications: false,
    });
  });
});
