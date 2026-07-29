import type { SystemSnapshot } from './model';

const AWAY_THRESHOLD_SECONDS = 5 * 60;
const RETURN_THRESHOLD_SECONDS = 30;
const WAKE_GAP_MS = 90 * 1000;
const OUTAGE_MINIMUM_MS = 30 * 1000;
const FOREGROUND_DWELL_MS = 20 * 60 * 1000;
const REACTION_COOLDOWN_MS = 15 * 60 * 1000;

export type SystemReactionKind =
  | 'returned'
  | 'wake'
  | 'low-battery'
  | 'thermal-rest'
  | 'resource-rest'
  | 'charging'
  | 'network-restored'
  | 'foreground-companion';

export interface SystemReaction {
  kind: SystemReactionKind;
  text: string;
  notificationReason?: 'welcome-back' | 'low-battery';
}

export interface SystemReactionMemory {
  previous: SystemSnapshot | null;
  lastObservedAtMs: number | null;
  lastReactionAtMs: number | null;
  foregroundAppName: string | null;
  foregroundSinceMs: number | null;
  lastForegroundReactionName: string | null;
  unreachableSinceMs: number | null;
  lowBatteryArmed: boolean;
}

export interface SystemReactionDecision {
  memory: SystemReactionMemory;
  reaction: SystemReaction | null;
}

export function createSystemReactionMemory(): SystemReactionMemory {
  return {
    previous: null,
    lastObservedAtMs: null,
    lastReactionAtMs: null,
    foregroundAppName: null,
    foregroundSinceMs: null,
    lastForegroundReactionName: null,
    unreachableSinceMs: null,
    lowBatteryArmed: true,
  };
}

/**
 * Converts transient system transitions into sparse companion reactions.
 * This function is pure so the interaction policy stays independently
 * testable and cannot accidentally mutate relationship state.
 */
export function decideSystemReaction(
  memory: SystemReactionMemory,
  current: SystemSnapshot,
  nowMs: number,
): SystemReactionDecision {
  const previous = memory.previous;
  const next: SystemReactionMemory = {
    ...memory,
    previous: current,
    lastObservedAtMs: nowMs,
  };

  updateForegroundMemory(next, current.frontmostAppName, nowMs);
  updateReachabilityMemory(next, current.network, nowMs);
  updateLowBatteryArm(next, current);

  if (previous === null) return { memory: next, reaction: null };

  const candidates: SystemReaction[] = [];
  const returned =
    previous.idleSeconds !== null &&
    previous.idleSeconds >= AWAY_THRESHOLD_SECONDS &&
    current.idleSeconds !== null &&
    current.idleSeconds <= RETURN_THRESHOLD_SECONDS;
  const wokeAfterGap =
    Math.max(
      0,
      current.observedAtEpochSeconds -
        previous.observedAtEpochSeconds,
    ) *
      1_000 >=
      WAKE_GAP_MS &&
    current.idleSeconds !== null &&
    current.idleSeconds <= RETURN_THRESHOLD_SECONDS;

  if (returned) {
    candidates.push({
      kind: 'returned',
      text: '你回来啦。我刚才也安静地眯了一会。',
      notificationReason: 'welcome-back',
    });
  } else if (wokeAfterGap) {
    candidates.push({
      kind: 'wake',
      text: '桌面醒了。我也在这里。',
      notificationReason: 'welcome-back',
    });
  }

  if (
    current.power.source === 'battery' &&
    current.power.charging !== true &&
    current.power.percent !== null &&
    current.power.percent <= 20 &&
    memory.lowBatteryArmed
  ) {
    candidates.push({
      kind: 'low-battery',
      text: '电量不多了。我们一起省点力气吧。',
      notificationReason: 'low-battery',
    });
  }

  if (
    !isHot(previous.thermalState) &&
    isHot(current.thermalState)
  ) {
    candidates.push({
      kind: 'thermal-rest',
      text: '机身有点热。我先安静下来，陪你慢一点。',
    });
  }

  if (
    (previous.resources?.cpuPercent ?? 0) < 85 &&
    (current.resources?.cpuPercent ?? 0) >= 85
  ) {
    candidates.push({
      kind: 'resource-rest',
      text: '电脑正在认真忙。我先轻一点，安静陪你。',
    });
  }

  if (
    previous.power.charging !== true &&
    current.power.charging === true
  ) {
    candidates.push({
      kind: 'charging',
      text: '接上电源啦。我也精神了一点。',
    });
  }

  if (
    previous.network === 'unreachable' &&
    current.network === 'reachable' &&
    memory.unreachableSinceMs !== null &&
    nowMs - memory.unreachableSinceMs >= OUTAGE_MINIMUM_MS
  ) {
    candidates.push({
      kind: 'network-restored',
      text: '又连上了。刚才安静的那一会也不错。',
    });
  }

  if (
    current.frontmostAppName !== null &&
    next.foregroundSinceMs !== null &&
    nowMs - next.foregroundSinceMs >= FOREGROUND_DWELL_MS &&
    next.lastForegroundReactionName !== current.frontmostAppName
  ) {
    candidates.push({
      kind: 'foreground-companion',
      text: `我在旁边陪你。${current.frontmostAppName} 的事慢慢来。`,
    });
  }

  const reaction = candidates[0] ?? null;
  if (reaction === null) return { memory: next, reaction: null };

  if (
    memory.lastReactionAtMs !== null &&
    nowMs - memory.lastReactionAtMs < REACTION_COOLDOWN_MS
  ) {
    return { memory: next, reaction: null };
  }

  next.lastReactionAtMs = nowMs;
  if (reaction.kind === 'foreground-companion') {
    next.lastForegroundReactionName = current.frontmostAppName;
  }
  if (reaction.kind === 'low-battery') next.lowBatteryArmed = false;

  return { memory: next, reaction };
}

function updateForegroundMemory(
  memory: SystemReactionMemory,
  appName: string | null,
  nowMs: number,
) {
  if (appName === null) {
    memory.foregroundAppName = null;
    memory.foregroundSinceMs = null;
    return;
  }
  if (memory.foregroundAppName === appName) return;
  memory.foregroundAppName = appName;
  memory.foregroundSinceMs = nowMs;
}

function updateReachabilityMemory(
  memory: SystemReactionMemory,
  status: SystemSnapshot['network'],
  nowMs: number,
) {
  if (status === 'unreachable') {
    memory.unreachableSinceMs ??= nowMs;
  } else {
    memory.unreachableSinceMs = null;
  }
}

function updateLowBatteryArm(
  memory: SystemReactionMemory,
  snapshot: SystemSnapshot,
) {
  const percent = snapshot.power.percent;
  if (
    snapshot.power.charging === true ||
    snapshot.power.source !== 'battery' ||
    percent === null ||
    percent >= 25
  ) {
    memory.lowBatteryArmed = true;
  }
}

function isHot(state: SystemSnapshot['thermalState']) {
  return state === 'serious' || state === 'critical';
}
