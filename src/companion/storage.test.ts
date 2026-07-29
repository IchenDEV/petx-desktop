import { describe, expect, it } from 'vitest';
import {
  COMPANION_STORAGE_KEY,
  deserializeCompanionState,
  loadCompanionState,
  saveCompanionState,
  type StorageLike,
} from './storage';
import {
  COMPANION_STATE_VERSION,
  createDefaultCompanionState,
  greet,
} from './model';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('companion state migration', () => {
  it('upgrades a full v1 relationship without inventing historical care debt', () => {
    const at = new Date('2026-02-14T08:00:00.000Z');
    const current = greet(createDefaultCompanionState(), at);
    const { care: _care, ...withoutCare } = current;
    const legacy = {
      ...withoutCare,
      version: 1,
      nickname: '小芙',
      bond: 25,
    };

    const migrated = deserializeCompanionState(JSON.stringify(legacy));

    expect(migrated.version).toBe(COMPANION_STATE_VERSION);
    expect(migrated.nickname).toBe('小芙');
    expect(migrated.bond).toBe(25);
    expect(migrated.firstInteractionAt).toBe(current.firstInteractionAt);
    expect(migrated.meaningfulInteractionDates).toEqual(
      current.meaningfulInteractionDates,
    );
    expect(migrated.memories).toEqual(current.memories);
    expect(migrated.care).toEqual(createDefaultCompanionState().care);
  });

  it('round-trips migrated v1 data as an equivalent v2 state', () => {
    const original = createDefaultCompanionState();
    const { care: _care, ...withoutCare } = original;
    const migrated = deserializeCompanionState(
      JSON.stringify({ ...withoutCare, version: 1 }),
    );

    expect(
      deserializeCompanionState(JSON.stringify(migrated)),
    ).toEqual(migrated);
  });

  it('clamps malformed v2 care independently of relationship data', () => {
    const state = createDefaultCompanionState();
    const malformed = {
      ...state,
      nickname: '保留下来的名字',
      care: {
        satiety: -200,
        satietyUpdatedAt: 'not-a-date',
        lastFedAt: [],
        lastPlayedAt: '2026-02-14T08:00:00.000Z',
        lastRestedAt: null,
      },
    };

    const restored = deserializeCompanionState(JSON.stringify(malformed));

    expect(restored.nickname).toBe('保留下来的名字');
    expect(restored.care).toEqual({
      satiety: 50,
      satietyUpdatedAt: null,
      lastFedAt: null,
      lastPlayedAt: '2026-02-14T08:00:00.000Z',
      lastRestedAt: null,
    });
  });

  it('uses default care when the v2 care object is missing', () => {
    const state = createDefaultCompanionState();
    const { care: _care, ...withoutCare } = state;

    expect(
      deserializeCompanionState(JSON.stringify(withoutCare)).care,
    ).toEqual(state.care);
  });

  it('refuses to overwrite a future companion-state version', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      COMPANION_STORAGE_KEY,
      JSON.stringify({ version: COMPANION_STATE_VERSION + 1 }),
    );

    expect(loadCompanionState(storage)).toEqual(createDefaultCompanionState());
    expect(saveCompanionState(createDefaultCompanionState(), storage)).toBe(
      false,
    );
    expect(JSON.parse(storage.getItem(COMPANION_STORAGE_KEY) ?? '{}')).toEqual({
      version: COMPANION_STATE_VERSION + 1,
    });
  });
});
