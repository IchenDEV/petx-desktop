import { describe, expect, it } from 'vitest';
import {
  createDefaultCompanionState,
  decideIdleBehavior,
  feed,
  getCareSnapshot,
  getRelationshipStage,
  play,
  rename,
  rest,
} from './model';

describe('companion care', () => {
  it('starts from a comfortable, non-urgent state', () => {
    const state = createDefaultCompanionState();

    expect(state.care).toEqual({
      satiety: 72,
      satietyUpdatedAt: null,
      lastFedAt: null,
      lastPlayedAt: null,
      lastRestedAt: null,
    });
    expect(getCareSnapshot(state, new Date('2026-01-01T08:00:00Z'))).toEqual({
      satiety: 72,
      energy: 70,
      mood: 'calm',
    });
  });

  it('settles only to a neutral satiety floor while energy recovers', () => {
    const state = {
      ...createDefaultCompanionState(),
      energy: 8,
      bond: 35,
      lastInteractionAt: '2026-01-01T08:00:00.000Z',
      care: {
        ...createDefaultCompanionState().care,
        satiety: 84,
        satietyUpdatedAt: '2026-01-01T08:00:00.000Z',
      },
    };

    const snapshot = getCareSnapshot(
      state,
      new Date('2026-06-01T08:00:00.000Z'),
    );

    expect(snapshot.satiety).toBe(50);
    expect(snapshot.energy).toBe(100);
    expect(state.bond).toBe(35);
  });

  it('does not change care when the system clock moves backwards', () => {
    const state = {
      ...createDefaultCompanionState(),
      care: {
        ...createDefaultCompanionState().care,
        satiety: 68,
        satietyUpdatedAt: '2026-01-02T08:00:00.000Z',
      },
    };

    expect(
      getCareSnapshot(state, new Date('2026-01-01T08:00:00.000Z')).satiety,
    ).toBe(68);
  });

  it('feeds with bounded satiety and records the care moment', () => {
    const at = new Date('2026-03-02T08:00:00.000Z');
    const state = {
      ...createDefaultCompanionState(),
      energy: 99,
      care: {
        ...createDefaultCompanionState().care,
        satiety: 92,
        satietyUpdatedAt: at.toISOString(),
      },
    };

    const next = feed(state, at);

    expect(next.care.satiety).toBe(100);
    expect(next.care.lastFedAt).toBe(at.toISOString());
    expect(next.energy).toBe(100);
    expect(next.mood).toBe('content');
    expect(next.meaningfulInteractionDates).toEqual(['2026-03-02']);
  });

  it('lets play consume energy and a little satiety without crossing bounds', () => {
    const at = new Date('2026-03-02T08:00:00.000Z');
    const state = {
      ...createDefaultCompanionState(),
      energy: 5,
      lastInteractionAt: at.toISOString(),
      care: {
        ...createDefaultCompanionState().care,
        satiety: 52,
        satietyUpdatedAt: at.toISOString(),
      },
    };

    const next = play(state, at);

    expect(next.energy).toBe(0);
    expect(next.care.satiety).toBe(50);
    expect(next.care.lastPlayedAt).toBe(at.toISOString());
    expect(next.mood).toBe('playful');
  });

  it('rests from recovered energy and briefly presents a sleeping behavior', () => {
    const at = new Date('2026-03-02T12:00:00.000Z');
    const state = {
      ...createDefaultCompanionState(),
      energy: 70,
      lastInteractionAt: '2026-03-02T08:00:00.000Z',
    };

    const next = rest(state, at);

    expect(next.energy).toBe(100);
    expect(next.care.lastRestedAt).toBe(at.toISOString());
    expect(next.mood).toBe('sleepy');
    expect(decideIdleBehavior(next, at)).toBe('napping');
  });

  it('does not let rest reset the pending satiety settlement interval', () => {
    const baseline = new Date('2026-03-02T08:00:00.000Z');
    const justBeforeSettlement = new Date('2026-03-02T10:59:00.000Z');
    const justAfterSettlement = new Date('2026-03-02T11:01:00.000Z');
    const state = {
      ...createDefaultCompanionState(),
      care: {
        ...createDefaultCompanionState().care,
        satiety: 70,
        satietyUpdatedAt: baseline.toISOString(),
      },
    };

    const rested = rest(state, justBeforeSettlement);

    expect(rested.care.satietyUpdatedAt).toBe(baseline.toISOString());
    expect(getCareSnapshot(rested, justAfterSettlement).satiety).toBe(69);
  });

  it('keeps care and relationship clocks monotonic during a clock rollback', () => {
    const currentTime = new Date('2026-03-02T08:00:00.000Z');
    const rolledBackTime = new Date('2026-03-01T08:00:00.000Z');
    const current = feed(createDefaultCompanionState(), currentTime);

    const next = feed(current, rolledBackTime);

    expect(next.lastInteractionAt).toBe(currentTime.toISOString());
    expect(next.care.satietyUpdatedAt).toBe(currentTime.toISOString());
    expect(next.meaningfulInteractionDates).toEqual(['2026-03-02']);
    expect(next.bond).toBe(5);
  });

  it('keeps automatically recovered energy when the companion is renamed', () => {
    const at = new Date('2026-03-02T12:00:00.000Z');
    const state = {
      ...createDefaultCompanionState(),
      energy: 0,
      lastInteractionAt: '2026-03-02T08:00:00.000Z',
    };

    expect(rename(state, '小芙', at).energy).toBe(32);
  });

  it('grows the relationship once per shared local day, not per action', () => {
    const morning = new Date(2026, 2, 2, 8);
    const noon = new Date(2026, 2, 2, 12);
    const evening = new Date(2026, 2, 2, 20);
    const nextMorning = new Date(2026, 2, 3, 8);

    let state = createDefaultCompanionState();
    state = feed(state, morning);
    state = play(state, noon);
    state = rest(state, evening);

    expect(state.bond).toBe(5);
    expect(state.meaningfulInteractionDates).toHaveLength(1);
    expect(state.memories).toHaveLength(1);
    expect(getRelationshipStage(state)).toBe('new');

    state = rest(state, nextMorning);
    expect(state.bond).toBe(10);
    expect(state.meaningfulInteractionDates).toHaveLength(2);
    expect(state.memories).toHaveLength(2);
    expect(getRelationshipStage(state)).toBe('familiar');
  });
});
