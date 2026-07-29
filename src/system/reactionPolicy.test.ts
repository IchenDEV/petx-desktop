import { describe, expect, it } from 'vitest';
import type { SystemSnapshot } from './model';
import {
  createSystemReactionMemory,
  decideSystemReaction,
} from './reactionPolicy';

function snapshot(
  patch: Partial<SystemSnapshot> = {},
): SystemSnapshot {
  return {
    observedAtEpochSeconds: 1,
    idleSeconds: 0,
    frontmostAppName: null,
    power: {
      source: 'ac',
      percent: 80,
      charging: false,
    },
    network: 'reachable',
    lowPowerMode: false,
    thermalState: 'nominal',
    resources: null,
    ...patch,
  };
}

describe('decideSystemReaction', () => {
  it('welcomes the user back without mutating relationship state', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({ idleSeconds: 600 }),
      1_000,
    );
    const second = decideSystemReaction(
      first.memory,
      snapshot({ idleSeconds: 4 }),
      20_000,
    );

    expect(second.reaction?.kind).toBe('returned');
    expect(second.reaction?.notificationReason).toBe('welcome-back');
  });

  it('coalesces simultaneous return and charging changes', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({
        idleSeconds: 600,
        power: { source: 'battery', percent: 44, charging: false },
      }),
      1_000,
    );
    const second = decideSystemReaction(
      first.memory,
      snapshot({
        idleSeconds: 0,
        power: { source: 'ac', percent: 45, charging: true },
      }),
      120_000,
    );

    expect(second.reaction?.kind).toBe('returned');
  });

  it('does not infer wake events when desktop activity is unavailable', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({ observedAtEpochSeconds: 1, idleSeconds: null }),
      1_000,
    );
    const later = decideSystemReaction(
      first.memory,
      snapshot({ observedAtEpochSeconds: 200, idleSeconds: null }),
      200_000,
    );

    expect(later.reaction).toBeNull();
  });

  it('waits for a stable outage before reacting to recovery', () => {
    const start = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({ network: 'unreachable' }),
      1_000,
    );
    const tooSoon = decideSystemReaction(
      start.memory,
      snapshot({ network: 'reachable' }),
      20_000,
    );
    expect(tooSoon.reaction).toBeNull();

    const offlineAgain = decideSystemReaction(
      tooSoon.memory,
      snapshot({ network: 'unreachable' }),
      30_000,
    );
    const restored = decideSystemReaction(
      offlineAgain.memory,
      snapshot({ network: 'reachable' }),
      70_001,
    );
    expect(restored.reaction?.kind).toBe('network-restored');
  });

  it('only comments after dwelling in the same foreground app', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({ frontmostAppName: 'Xcode' }),
      1_000,
    );
    const early = decideSystemReaction(
      first.memory,
      snapshot({ frontmostAppName: 'Xcode' }),
      19 * 60 * 1_000,
    );
    expect(early.reaction).toBeNull();

    const ready = decideSystemReaction(
      early.memory,
      snapshot({ frontmostAppName: 'Xcode' }),
      20 * 60 * 1_000 + 1_001,
    );
    expect(ready.reaction?.kind).toBe('foreground-companion');
    expect(ready.reaction?.text).toContain('Xcode');
  });

  it('rearmer low battery only after recovery or charging', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({
        power: { source: 'battery', percent: 19, charging: false },
      }),
      1_000,
    );
    const low = decideSystemReaction(
      first.memory,
      snapshot({
        power: { source: 'battery', percent: 18, charging: false },
      }),
      2_000,
    );
    expect(low.reaction?.kind).toBe('low-battery');

    const repeated = decideSystemReaction(
      low.memory,
      snapshot({
        power: { source: 'battery', percent: 17, charging: false },
      }),
      20 * 60 * 1_000,
    );
    expect(repeated.reaction).toBeNull();
  });

  it('settles down when the system becomes hot', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({ thermalState: 'nominal' }),
      1_000,
    );
    const hot = decideSystemReaction(
      first.memory,
      snapshot({ thermalState: 'serious' }),
      20_000,
    );

    expect(hot.reaction?.kind).toBe('thermal-rest');
  });

  it('settles down when whole-system CPU becomes busy', () => {
    const first = decideSystemReaction(
      createSystemReactionMemory(),
      snapshot({
        resources: {
          cpuPercent: 30,
          networkReceivedBytesPerSecond: 0,
          networkTransmittedBytesPerSecond: 0,
          sessionReceivedBytes: 0,
          sessionTransmittedBytes: 0,
        },
      }),
      1_000,
    );
    const busy = decideSystemReaction(
      first.memory,
      snapshot({
        resources: {
          cpuPercent: 88,
          networkReceivedBytesPerSecond: 0,
          networkTransmittedBytesPerSecond: 0,
          sessionReceivedBytes: 0,
          sessionTransmittedBytes: 0,
        },
      }),
      20_000,
    );

    expect(busy.reaction?.kind).toBe('resource-rest');
  });
});
