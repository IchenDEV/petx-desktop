export const COMPANION_STATE_VERSION = 2 as const;
export const MAX_COMPANION_MEMORIES = 7;
export const MIN_COMPANION_SIZE = 128;
export const MAX_COMPANION_SIZE = 224;
export const COMPANION_SIZE_STEP = 8;

export type IsoTimestamp = string;
export type LocalDate = string;
export type Mood = 'calm' | 'curious' | 'content' | 'playful' | 'sleepy';
export type ProactiveFrequency = 'off' | 'quiet' | 'balanced' | 'lively';
export type MeaningfulInteraction =
  | 'greet'
  | 'pet'
  | 'play'
  | 'feed'
  | 'rest'
  | 'rename';
export type IdleBehavior =
  | 'sleeping'
  | 'napping'
  | 'staying-close'
  | 'playing'
  | 'self-entertaining'
  | 'observing'
  | 'resting';
export type RelationshipStage = 'new' | 'familiar' | 'close' | 'companion';

export interface QuietHours {
  enabled: boolean;
  /** Minutes after local midnight, inclusive. */
  startMinute: number;
  /** Minutes after local midnight, exclusive. */
  endMinute: number;
}

export interface SoundPreferences {
  enabled: boolean;
  /** A normalized volume from 0 to 1. */
  volume: number;
}

export interface CompanionPreferences {
  proactiveFrequency: ProactiveFrequency;
  quietHours: QuietHours;
  sound: SoundPreferences;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  size: number;
}

export interface DailyProactivity {
  localDate: LocalDate | null;
  shownCount: number;
  ignoredCount: number;
  lastShownAt: IsoTimestamp | null;
  pendingSince: IsoTimestamp | null;
}

export interface CompanionCare {
  /**
   * A gentle care signal, never a survival requirement. It settles no lower
   * than a neutral baseline and cannot make the companion ill or unhappy.
   */
  satiety: number;
  /** Independent baseline for settling satiety over time. */
  satietyUpdatedAt: IsoTimestamp | null;
  lastFedAt: IsoTimestamp | null;
  lastPlayedAt: IsoTimestamp | null;
  lastRestedAt: IsoTimestamp | null;
}

export interface CareSnapshot {
  satiety: number;
  energy: number;
  mood: Mood;
}

interface MemoryBase {
  id: string;
  occurredAt: IsoTimestamp;
  localDate: LocalDate;
}

export type CompanionMemory =
  | (MemoryBase & {
      kind: 'first-interaction';
      interaction: MeaningfulInteraction;
    })
  | (MemoryBase & {
      kind: 'shared-day';
      interaction: MeaningfulInteraction;
    })
  | (MemoryBase & {
      kind: 'rename';
      previousNickname: string;
      nickname: string;
    })
  | (MemoryBase & {
      kind: 'keepsake';
      keepsakeId: string;
      name: string;
      note?: string;
    });

export interface CompanionState {
  version: typeof COMPANION_STATE_VERSION;
  nickname: string;
  mood: Mood;
  energy: number;
  /**
   * Internal, non-decaying relationship signal. Render a semantic relationship
   * stage or changed behavior instead of exposing this value as a UI meter.
   */
  bond: number;
  firstInteractionAt: IsoTimestamp | null;
  lastInteractionAt: IsoTimestamp | null;
  meaningfulInteractionDates: LocalDate[];
  memories: CompanionMemory[];
  care: CompanionCare;
  proactivity: DailyProactivity;
  preferences: CompanionPreferences;
}

export interface KeepsakeInput {
  id: string;
  name: string;
  note?: string;
}

export type CompanionPreferencesPatch = Partial<
  Omit<CompanionPreferences, 'quietHours' | 'sound'>
> & {
  quietHours?: Partial<QuietHours>;
  sound?: Partial<SoundPreferences>;
};

export type CompanionEvent =
  | { type: 'replace-state'; state: CompanionState }
  | { type: 'greet'; at: Date }
  | { type: 'pet'; at: Date }
  | { type: 'play'; at: Date }
  | { type: 'feed'; at: Date }
  | { type: 'rest'; at: Date }
  | { type: 'ignore'; at: Date }
  | { type: 'rename'; nickname: string; at: Date }
  | { type: 'record-keepsake'; keepsake: KeepsakeInput; at: Date }
  | { type: 'proactive-bubble-shown'; at: Date }
  | { type: 'update-preferences'; patch: CompanionPreferencesPatch };

export type ProactiveBlockReason =
  | 'allowed'
  | 'disabled'
  | 'before-first-interaction'
  | 'quiet-hours'
  | 'pending'
  | 'ignored-today'
  | 'daily-limit'
  | 'recent-interaction'
  | 'cooldown';

export interface ProactiveBubbleDecision {
  allowed: boolean;
  reason: ProactiveBlockReason;
}

const DEFAULT_NICKNAME = 'Frieren';
const MINUTES_PER_DAY = 24 * 60;
const BOND_PER_SHARED_DAY = 5;
const RECENT_INTERACTION_COOLDOWN_MS = 20 * 60 * 1000;
const SATIETY_FLOOR = 50;
const SATIETY_SETTLEMENT_INTERVAL_MS = 3 * 60 * 60 * 1000;

const PROACTIVE_POLICY: Record<
  ProactiveFrequency,
  { dailyLimit: number; minimumIntervalMs: number }
> = {
  off: { dailyLimit: 0, minimumIntervalMs: Number.POSITIVE_INFINITY },
  quiet: { dailyLimit: 1, minimumIntervalMs: 6 * 60 * 60 * 1000 },
  balanced: { dailyLimit: 2, minimumIntervalMs: 3 * 60 * 60 * 1000 },
  lively: { dailyLimit: 3, minimumIntervalMs: 2 * 60 * 60 * 1000 },
};

export function createDefaultCompanionPreferences(): CompanionPreferences {
  return {
    proactiveFrequency: 'balanced',
    quietHours: {
      enabled: true,
      startMinute: 22 * 60,
      endMinute: 8 * 60,
    },
    sound: {
      enabled: false,
      volume: 0.18,
    },
    alwaysOnTop: true,
    launchAtLogin: false,
    size: 176,
  };
}

export function createDefaultCompanionState(): CompanionState {
  return {
    version: COMPANION_STATE_VERSION,
    nickname: DEFAULT_NICKNAME,
    mood: 'calm',
    energy: 70,
    bond: 0,
    firstInteractionAt: null,
    lastInteractionAt: null,
    meaningfulInteractionDates: [],
    memories: [],
    care: createDefaultCompanionCare(),
    proactivity: emptyDailyProactivity(),
    preferences: createDefaultCompanionPreferences(),
  };
}

export function createDefaultCompanionCare(): CompanionCare {
  return {
    satiety: 72,
    satietyUpdatedAt: null,
    lastFedAt: null,
    lastPlayedAt: null,
    lastRestedAt: null,
  };
}

export function getCareSnapshot(
  state: CompanionState,
  at: Date,
): CareSnapshot {
  assertValidDate(at);
  return {
    satiety: settledSatiety(state.care, at),
    energy: recoveredEnergy(state, at),
    mood: state.mood,
  };
}

export function greet(state: CompanionState, at: Date): CompanionState {
  const next = recordMeaningfulInteraction(state, 'greet', at);
  return {
    ...next,
    mood: state.firstInteractionAt === null ? 'curious' : 'content',
    energy: clamp(recoveredEnergy(state, at) + 2, 0, 100),
  };
}

export function pet(state: CompanionState, at: Date): CompanionState {
  const next = recordMeaningfulInteraction(state, 'pet', at);
  return {
    ...next,
    mood: 'content',
    energy: clamp(recoveredEnergy(state, at) + 3, 0, 100),
  };
}

export function play(state: CompanionState, at: Date): CompanionState {
  const snapshot = getCareSnapshot(state, at);
  const next = recordMeaningfulInteraction(state, 'play', at);
  const occurredAt = monotonicTimestamp(state.care.satietyUpdatedAt, at);
  return {
    ...next,
    mood: 'playful',
    energy: clamp(snapshot.energy - 8, 0, 100),
    care: {
      ...state.care,
      satiety: clamp(snapshot.satiety - 4, SATIETY_FLOOR, 100),
      satietyUpdatedAt: occurredAt,
      lastPlayedAt: monotonicTimestamp(state.care.lastPlayedAt, at),
    },
  };
}

export function feed(state: CompanionState, at: Date): CompanionState {
  const snapshot = getCareSnapshot(state, at);
  const next = recordMeaningfulInteraction(state, 'feed', at);
  const occurredAt = monotonicTimestamp(state.care.satietyUpdatedAt, at);
  return {
    ...next,
    mood: 'content',
    energy: clamp(snapshot.energy + 2, 0, 100),
    care: {
      ...state.care,
      satiety: clamp(snapshot.satiety + 24, SATIETY_FLOOR, 100),
      satietyUpdatedAt: occurredAt,
      lastFedAt: monotonicTimestamp(state.care.lastFedAt, at),
    },
  };
}

export function rest(state: CompanionState, at: Date): CompanionState {
  const snapshot = getCareSnapshot(state, at);
  const next = recordMeaningfulInteraction(state, 'rest', at);
  return {
    ...next,
    mood: 'sleepy',
    energy: clamp(snapshot.energy + 24, 0, 100),
    care: {
      ...state.care,
      lastRestedAt: monotonicTimestamp(state.care.lastRestedAt, at),
    },
  };
}

export function ignore(state: CompanionState, at: Date): CompanionState {
  const proactivity = proactivityForDate(state.proactivity, at);
  if (proactivity.pendingSince === null) return state;

  return {
    ...state,
    mood: 'calm',
    proactivity: {
      ...proactivity,
      ignoredCount: proactivity.ignoredCount + 1,
      pendingSince: null,
    },
  };
}

export function rename(
  state: CompanionState,
  nickname: string,
  at: Date,
): CompanionState {
  const normalizedNickname = normalizeNickname(nickname);
  if (normalizedNickname === state.nickname) return state;

  const occurredAt = toIsoTimestamp(at);
  const localDate = toLocalDate(at);
  const previousNickname = state.nickname;
  const energy = recoveredEnergy(state, at);
  const next = recordMeaningfulInteraction(state, 'rename', at);

  return appendMemory(
    {
      ...next,
      nickname: normalizedNickname,
      mood: 'content',
      energy,
    },
    {
      id: memoryId('rename', occurredAt, normalizedNickname),
      kind: 'rename',
      occurredAt,
      localDate,
      previousNickname,
      nickname: normalizedNickname,
    },
  );
}

export function recordKeepsake(
  state: CompanionState,
  keepsake: KeepsakeInput,
  at: Date,
): CompanionState {
  const keepsakeId = normalizeRequiredText(keepsake.id, 64, 'Keepsake id');
  if (
    state.memories.some(
      (memory) =>
        memory.kind === 'keepsake' && memory.keepsakeId === keepsakeId,
    )
  ) {
    return state;
  }

  const name = normalizeRequiredText(keepsake.name, 48, 'Keepsake name');
  const note = normalizeOptionalText(keepsake.note, 160);
  const occurredAt = toIsoTimestamp(at);

  return appendMemory(state, {
    id: memoryId('keepsake', occurredAt, keepsakeId),
    kind: 'keepsake',
    occurredAt,
    localDate: toLocalDate(at),
    keepsakeId,
    name,
    ...(note === undefined ? {} : { note }),
  });
}

export function updatePreferences(
  state: CompanionState,
  patch: CompanionPreferencesPatch,
): CompanionState {
  const preferences = state.preferences;

  return {
    ...state,
    preferences: {
      ...preferences,
      ...patch,
      size:
        patch.size === undefined
          ? preferences.size
          : normalizeCompanionSize(patch.size),
      quietHours: {
        ...preferences.quietHours,
        ...patch.quietHours,
        startMinute:
          patch.quietHours?.startMinute === undefined
            ? preferences.quietHours.startMinute
            : normalizeMinuteOfDay(patch.quietHours.startMinute),
        endMinute:
          patch.quietHours?.endMinute === undefined
            ? preferences.quietHours.endMinute
            : normalizeMinuteOfDay(patch.quietHours.endMinute),
      },
      sound: {
        ...preferences.sound,
        ...patch.sound,
        volume:
          patch.sound?.volume === undefined
            ? preferences.sound.volume
            : clamp(patch.sound.volume, 0, 1),
      },
    },
  };
}

export function recordProactiveBubbleShown(
  state: CompanionState,
  at: Date,
): CompanionState {
  if (!canShowProactiveBubble(state, at)) return state;

  const occurredAt = toIsoTimestamp(at);
  const proactivity = proactivityForDate(state.proactivity, at);
  return {
    ...state,
    proactivity: {
      ...proactivity,
      shownCount: proactivity.shownCount + 1,
      lastShownAt: occurredAt,
      pendingSince: occurredAt,
    },
  };
}

export function companionReducer(
  state: CompanionState,
  event: CompanionEvent,
): CompanionState {
  switch (event.type) {
    case 'replace-state':
      return event.state;
    case 'greet':
      return greet(state, event.at);
    case 'pet':
      return pet(state, event.at);
    case 'play':
      return play(state, event.at);
    case 'feed':
      return feed(state, event.at);
    case 'rest':
      return rest(state, event.at);
    case 'ignore':
      return ignore(state, event.at);
    case 'rename':
      return rename(state, event.nickname, event.at);
    case 'record-keepsake':
      return recordKeepsake(state, event.keepsake, event.at);
    case 'proactive-bubble-shown':
      return recordProactiveBubbleShown(state, event.at);
    case 'update-preferences':
      return updatePreferences(state, event.patch);
    default: {
      const exhaustiveCheck: never = event;
      return exhaustiveCheck;
    }
  }
}

export function decideIdleBehavior(
  state: CompanionState,
  at: Date,
): IdleBehavior {
  assertValidDate(at);

  if (isWithinQuietHours(state.preferences.quietHours, at)) {
    return 'sleeping';
  }

  if (recoveredEnergy(state, at) <= 28) return 'napping';
  if (state.lastInteractionAt === null) return 'observing';

  const elapsedSinceInteraction = elapsedMs(state.lastInteractionAt, at);
  if (state.mood === 'sleepy' && elapsedSinceInteraction <= 10 * 60 * 1000) {
    return 'napping';
  }
  if (state.mood === 'playful' && elapsedSinceInteraction <= 10 * 60 * 1000) {
    return 'playing';
  }
  if (state.mood === 'content' && elapsedSinceInteraction <= 5 * 60 * 1000) {
    return 'staying-close';
  }
  if (elapsedSinceInteraction >= 3 * 60 * 60 * 1000) {
    return 'self-entertaining';
  }

  const hour = at.getHours();
  if (hour >= 21 || hour < 7) return 'resting';

  // A deterministic time slice gives the renderer some variety without making
  // the domain model depend on randomness.
  const tenMinuteSlice = Math.floor(at.getTime() / (10 * 60 * 1000));
  return tenMinuteSlice % 2 === 0 ? 'observing' : 'resting';
}

export function decideProactiveBubble(
  state: CompanionState,
  at: Date,
): ProactiveBubbleDecision {
  assertValidDate(at);

  const policy = PROACTIVE_POLICY[state.preferences.proactiveFrequency];
  if (policy.dailyLimit === 0) return blocked('disabled');
  if (state.firstInteractionAt === null) {
    return blocked('before-first-interaction');
  }
  if (isWithinQuietHours(state.preferences.quietHours, at)) {
    return blocked('quiet-hours');
  }

  const proactivity = proactivityForDate(state.proactivity, at);
  if (proactivity.pendingSince !== null) return blocked('pending');
  if (proactivity.ignoredCount >= 2) return blocked('ignored-today');
  if (proactivity.shownCount >= policy.dailyLimit) {
    return blocked('daily-limit');
  }
  if (
    elapsedMs(state.lastInteractionAt, at) <
    RECENT_INTERACTION_COOLDOWN_MS
  ) {
    return blocked('recent-interaction');
  }
  if (
    elapsedMs(proactivity.lastShownAt, at) < policy.minimumIntervalMs
  ) {
    return blocked('cooldown');
  }

  return { allowed: true, reason: 'allowed' };
}

export function canShowProactiveBubble(
  state: CompanionState,
  at: Date,
): boolean {
  return decideProactiveBubble(state, at).allowed;
}

export function getRelationshipStage(
  state: CompanionState,
): RelationshipStage {
  const sharedDays = state.meaningfulInteractionDates.length;
  if (sharedDays >= 14) return 'companion';
  if (sharedDays >= 5) return 'close';
  if (sharedDays >= 2) return 'familiar';
  return 'new';
}

export function isWithinQuietHours(
  quietHours: QuietHours,
  at: Date,
): boolean {
  assertValidDate(at);
  if (!quietHours.enabled) return false;

  const start = normalizeMinuteOfDay(quietHours.startMinute);
  const end = normalizeMinuteOfDay(quietHours.endMinute);
  const current = at.getHours() * 60 + at.getMinutes();

  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function toLocalDate(at: Date): LocalDate {
  assertValidDate(at);
  const year = String(at.getFullYear()).padStart(4, '0');
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeNickname(value: string): string {
  return normalizeRequiredText(value, 24, 'Nickname');
}

export function normalizeCompanionSize(value: number): number {
  const clamped = clamp(value, MIN_COMPANION_SIZE, MAX_COMPANION_SIZE);
  const stepped =
    Math.round((clamped - MIN_COMPANION_SIZE) / COMPANION_SIZE_STEP) *
      COMPANION_SIZE_STEP +
    MIN_COMPANION_SIZE;
  return clamp(stepped, MIN_COMPANION_SIZE, MAX_COMPANION_SIZE);
}

function recordMeaningfulInteraction(
  state: CompanionState,
  interaction: MeaningfulInteraction,
  at: Date,
): CompanionState {
  const occurredAt = toIsoTimestamp(at);
  const localDate = toLocalDate(at);
  const firstInteraction = state.firstInteractionAt === null;
  const chronological =
    state.lastInteractionAt === null ||
    !Number.isFinite(Date.parse(state.lastInteractionAt)) ||
    at.getTime() >= Date.parse(state.lastInteractionAt);
  const firstInteractionToday =
    chronological && !state.meaningfulInteractionDates.includes(localDate);
  const proactivity = proactivityForDate(state.proactivity, at);

  let next: CompanionState = {
    ...state,
    firstInteractionAt: state.firstInteractionAt ?? occurredAt,
    lastInteractionAt: monotonicTimestamp(state.lastInteractionAt, at),
    meaningfulInteractionDates: firstInteractionToday
      ? [...state.meaningfulInteractionDates, localDate]
      : state.meaningfulInteractionDates,
    bond: firstInteractionToday
      ? clamp(state.bond + BOND_PER_SHARED_DAY, 0, 100)
      : state.bond,
    proactivity: {
      ...proactivity,
      pendingSince: null,
    },
  };

  if (firstInteraction) {
    next = appendMemory(next, {
      id: memoryId('first-interaction', occurredAt, interaction),
      kind: 'first-interaction',
      occurredAt,
      localDate,
      interaction,
    });
  } else if (firstInteractionToday) {
    next = appendMemory(next, {
      id: memoryId('shared-day', occurredAt, interaction),
      kind: 'shared-day',
      occurredAt,
      localDate,
      interaction,
    });
  }

  return next;
}

function appendMemory(
  state: CompanionState,
  memory: CompanionMemory,
): CompanionState {
  const withoutDuplicate = state.memories.filter(
    (existing) => existing.id !== memory.id,
  );
  return {
    ...state,
    memories: [...withoutDuplicate, memory].slice(-MAX_COMPANION_MEMORIES),
  };
}

function emptyDailyProactivity(): DailyProactivity {
  return {
    localDate: null,
    shownCount: 0,
    ignoredCount: 0,
    lastShownAt: null,
    pendingSince: null,
  };
}

function proactivityForDate(
  proactivity: DailyProactivity,
  at: Date,
): DailyProactivity {
  const localDate = toLocalDate(at);
  if (proactivity.localDate === localDate) return proactivity;
  return {
    ...emptyDailyProactivity(),
    localDate,
  };
}

function blocked(reason: Exclude<ProactiveBlockReason, 'allowed'>) {
  return { allowed: false, reason } satisfies ProactiveBubbleDecision;
}

function elapsedMs(
  timestamp: IsoTimestamp | null,
  at: Date,
): number {
  if (timestamp === null) return Number.POSITIVE_INFINITY;
  const then = Date.parse(timestamp);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, at.getTime() - then);
}

function recoveredEnergy(state: CompanionState, at: Date): number {
  const elapsed = elapsedMs(state.lastInteractionAt, at);
  if (!Number.isFinite(elapsed)) return state.energy;

  // Rest is automatic rather than a care obligation: energy returns gradually
  // with time and never requires the user to perform a maintenance action.
  const recovered = Math.floor(elapsed / (15 * 60 * 1000)) * 2;
  return clamp(state.energy + recovered, 0, 100);
}

function settledSatiety(care: CompanionCare, at: Date): number {
  const elapsed = elapsedMs(care.satietyUpdatedAt, at);
  if (!Number.isFinite(elapsed)) {
    return clamp(care.satiety, SATIETY_FLOOR, 100);
  }

  const settled = Math.floor(elapsed / SATIETY_SETTLEMENT_INTERVAL_MS);
  return clamp(care.satiety - settled, SATIETY_FLOOR, 100);
}

function toIsoTimestamp(at: Date): IsoTimestamp {
  assertValidDate(at);
  return at.toISOString();
}

function monotonicTimestamp(
  previous: IsoTimestamp | null,
  at: Date,
): IsoTimestamp {
  const occurredAt = toIsoTimestamp(at);
  if (previous === null) return occurredAt;

  const previousTime = Date.parse(previous);
  if (!Number.isFinite(previousTime) || at.getTime() >= previousTime) {
    return occurredAt;
  }
  return previous;
}

function assertValidDate(at: Date): void {
  if (!Number.isFinite(at.getTime())) {
    throw new RangeError('Expected a valid Date');
  }
}

function normalizeMinuteOfDay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(clamp(value, 0, MINUTES_PER_DAY - 1));
}

function normalizeRequiredText(
  value: string,
  maxLength: number,
  label: string,
): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new RangeError(`${label} cannot be empty`);
  }
  return Array.from(normalized).slice(0, maxLength).join('');
}

function normalizeOptionalText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).slice(0, maxLength).join('');
}

function memoryId(
  kind: CompanionMemory['kind'],
  occurredAt: IsoTimestamp,
  discriminator: string,
): string {
  return `${kind}:${occurredAt}:${encodeURIComponent(discriminator)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
