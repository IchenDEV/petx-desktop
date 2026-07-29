import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart';
import {
  MAX_COMPANION_MEMORIES,
  updatePreferences,
  type CompanionPreferences,
  type CompanionPreferencesPatch,
  type CompanionState,
  type ProactiveFrequency,
} from '../companion/model';
import {
  loadCompanionState,
  saveCompanionPreferences,
  saveCompanionState,
} from '../companion/storage';
import {
  isTauri,
  notifyMainWindow,
  setCompanionAlwaysOnTop,
} from '../platform';

const STATE_CHANGED_EVENT = 'petx://state-changed';
const STATE_REPLACED_EVENT = 'petx://state-replaced';

const FREQUENCY_OPTIONS: ReadonlyArray<{
  value: ProactiveFrequency;
  label: string;
  description: string;
}> = [
  {
    value: 'off',
    label: '关闭',
    description: '只回应你的互动',
  },
  {
    value: 'quiet',
    label: '安静',
    description: '偶尔来看看',
  },
  {
    value: 'balanced',
    label: '适中',
    description: '平常的陪伴节奏',
  },
  {
    value: 'lively',
    label: '活泼',
    description: '更愿意打招呼',
  },
];

const SIZE_OPTIONS = [
  { value: 144, label: 'S', description: '轻巧' },
  { value: 176, label: 'M', description: '舒适' },
  { value: 208, label: 'L', description: '醒目' },
] as const;

const BASE_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => index * 30);

type Notice = {
  tone: 'status' | 'error';
  message: string;
};

export function SettingsView() {
  const [state, setState] = useState<CompanionState>(loadCompanionState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [autostartAvailable, setAutostartAvailable] = useState(!isTauri);
  const [autostartPending, setAutostartPending] = useState(isTauri);
  const [alwaysOnTopPending, setAlwaysOnTopPending] = useState(false);
  const cancelClearButtonRef = useRef<HTMLButtonElement>(null);

  const commitState = useCallback(
    (nextState: CompanionState, successMessage?: string): boolean => {
      if (!saveCompanionState(nextState)) {
        setNotice({
          tone: 'error',
          message: '设置没有保存。请检查本机存储权限后再试。',
        });
        return false;
      }

      setState(nextState);
      setNotice(
        successMessage === undefined
          ? null
          : { tone: 'status', message: successMessage },
      );
      void notifyMainWindow(STATE_REPLACED_EVENT, nextState).catch(
        (error: unknown) => {
          console.error('Unable to notify the companion window', error);
          setNotice({
            tone: 'error',
            message: '设置已保存，但宠物暂时没有收到更新。',
          });
        },
      );
      return true;
    },
    [],
  );

  const commitPreferences = useCallback(
    (
      preferences: CompanionPreferences,
      successMessage?: string,
    ): boolean => {
      const nextState = saveCompanionPreferences(preferences);
      if (nextState === null) {
        setNotice({
          tone: 'error',
          message: '设置没有保存。请检查本机存储权限后再试。',
        });
        return false;
      }

      setState(nextState);
      setNotice(
        successMessage === undefined
          ? null
          : { tone: 'status', message: successMessage },
      );
      void notifyMainWindow(STATE_CHANGED_EVENT, nextState).catch(
        (error: unknown) => {
          console.error('Unable to notify the companion window', error);
          setNotice({
            tone: 'error',
            message: '设置已保存，但宠物暂时没有收到更新。',
          });
        },
      );
      return true;
    },
    [],
  );

  const applyPreferences = useCallback(
    (patch: CompanionPreferencesPatch) => {
      const latestState = loadCompanionState();
      commitPreferences(updatePreferences(latestState, patch).preferences);
    },
    [commitPreferences],
  );

  const closeSettings = useCallback(async () => {
    if (!isTauri) {
      window.close();
      return;
    }

    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error('Unable to close the settings window', error);
      setNotice({
        tone: 'error',
        message: '暂时无法关闭设置窗口。',
      });
    }
  }, []);

  useEffect(() => {
    const refreshState = () => setState(loadCompanionState());
    window.addEventListener('focus', refreshState);
    window.addEventListener('storage', refreshState);
    return () => {
      window.removeEventListener('focus', refreshState);
      window.removeEventListener('storage', refreshState);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    let active = true;
    void isAutostartEnabled()
      .then((enabled) => {
        if (!active) return;
        setAutostartAvailable(true);
        setAutostartPending(false);
        const latestState = loadCompanionState();
        if (latestState.preferences.launchAtLogin !== enabled) {
          commitPreferences(
            updatePreferences(latestState, { launchAtLogin: enabled })
              .preferences,
          );
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('Unable to read launch-at-login state', error);
        setAutostartAvailable(false);
        setAutostartPending(false);
        setNotice({
          tone: 'error',
          message: '当前系统不允许读取开机启动设置。',
        });
      });

    return () => {
      active = false;
    };
  }, [commitPreferences]);

  useEffect(() => {
    if (confirmingClear) cancelClearButtonRef.current?.focus();
  }, [confirmingClear]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmingClear) {
        setConfirmingClear(false);
        return;
      }
      void closeSettings();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSettings, confirmingClear]);

  const handleAlwaysOnTopChange = async (checked: boolean) => {
    if (alwaysOnTopPending) return;

    const previousState = loadCompanionState();
    const previousValue = previousState.preferences.alwaysOnTop;
    setAlwaysOnTopPending(true);
    setNotice(null);

    try {
      await setCompanionAlwaysOnTop(checked);
      const latestState = loadCompanionState();
      const committed = commitPreferences(
        updatePreferences(latestState, { alwaysOnTop: checked }).preferences,
      );
      if (!committed) {
        await setCompanionAlwaysOnTop(previousValue);
      }
    } catch (error) {
      console.error('Unable to change always-on-top state', error);
      setNotice({
        tone: 'error',
        message: '没有改变置顶状态，请稍后再试。',
      });
    } finally {
      setAlwaysOnTopPending(false);
    }
  };

  const handleAutostartChange = async (checked: boolean) => {
    if (autostartPending) return;
    if (!isTauri) {
      applyPreferences({ launchAtLogin: checked });
      return;
    }

    const previousState = loadCompanionState();
    const previousValue = previousState.preferences.launchAtLogin;
    setAutostartPending(true);
    setNotice(null);

    try {
      await (checked ? enableAutostart() : disableAutostart());
      const latestState = loadCompanionState();
      const committed = commitPreferences(
        updatePreferences(latestState, { launchAtLogin: checked }).preferences,
      );
      if (!committed) {
        await (previousValue ? enableAutostart() : disableAutostart());
      }
    } catch (error) {
      console.error('Unable to change launch-at-login state', error);
      setNotice({
        tone: 'error',
        message: '没有改变开机启动设置，请检查系统权限。',
      });
    } finally {
      setAutostartPending(false);
    }
  };

  const clearRelationshipMemory = () => {
    const latestState = loadCompanionState();
    const nextState: CompanionState = {
      ...latestState,
      mood: 'calm',
      energy: 70,
      bond: 0,
      firstInteractionAt: null,
      lastInteractionAt: null,
      meaningfulInteractionDates: [],
      memories: [],
      proactivity: {
        localDate: null,
        shownCount: 0,
        ignoredCount: 0,
        lastShownAt: null,
        pendingSince: null,
      },
    };

    if (commitState(nextState, '相处记忆已清除。')) {
      setConfirmingClear(false);
    }
  };

  const preferences = state.preferences;
  const quietTimeOptions = withCurrentTimeOptions(
    preferences.quietHours.startMinute,
    preferences.quietHours.endMinute,
  );

  return (
    <main className="settings-view">
      <header className="settings-header">
        <div className="settings-title-group">
          <p className="settings-eyebrow">PetX</p>
          <h1>陪伴偏好</h1>
          <p>让相处的节奏更像你喜欢的样子。</p>
        </div>
      </header>

      <form
        className="settings-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <fieldset className="settings-section settings-section--frequency">
          <legend>主动问候</legend>
          <p className="settings-section-description">
            不方便回应也没关系，它会自己安静下来。
          </p>
          <div className="settings-choice-grid settings-choice-grid--frequency">
            {FREQUENCY_OPTIONS.map((option) => (
              <label
                className={
                  preferences.proactiveFrequency === option.value
                    ? 'settings-choice is-selected'
                    : 'settings-choice'
                }
                key={option.value}
              >
                <input
                  type="radio"
                  name="proactive-frequency"
                  value={option.value}
                  checked={preferences.proactiveFrequency === option.value}
                  onChange={() =>
                    applyPreferences({
                      proactiveFrequency: option.value,
                    })
                  }
                />
                <span className="settings-choice-label">{option.label}</span>
                <span className="settings-choice-description">
                  {option.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="settings-section" aria-labelledby="quiet-hours-title">
          <SettingRow
            id="quiet-hours-title"
            title="安静时段"
            description="这段时间它会自己休息，不主动打扰。"
            control={
              <Toggle
                label="启用安静时段"
                checked={preferences.quietHours.enabled}
                onChange={(checked) =>
                  applyPreferences({
                    quietHours: { enabled: checked },
                  })
                }
              />
            }
          />
          <div
            className={
              preferences.quietHours.enabled
                ? 'quiet-hours-fields'
                : 'quiet-hours-fields is-disabled'
            }
          >
            <label className="settings-field">
              <span>开始</span>
              <select
                className="settings-select"
                value={preferences.quietHours.startMinute}
                disabled={!preferences.quietHours.enabled}
                onChange={(event) =>
                  applyPreferences({
                    quietHours: {
                      startMinute: Number(event.target.value),
                    },
                  })
                }
              >
                {quietTimeOptions.map((minute) => (
                  <option
                    value={minute}
                    key={`start-${minute}`}
                    disabled={minute === preferences.quietHours.endMinute}
                  >
                    {formatMinuteOfDay(minute)}
                  </option>
                ))}
              </select>
            </label>
            <span className="quiet-hours-separator" aria-hidden="true">
              至
            </span>
            <label className="settings-field">
              <span>结束</span>
              <select
                className="settings-select"
                value={preferences.quietHours.endMinute}
                disabled={!preferences.quietHours.enabled}
                onChange={(event) =>
                  applyPreferences({
                    quietHours: {
                      endMinute: Number(event.target.value),
                    },
                  })
                }
              >
                {quietTimeOptions.map((minute) => (
                  <option
                    value={minute}
                    key={`end-${minute}`}
                    disabled={minute === preferences.quietHours.startMinute}
                  >
                    {formatMinuteOfDay(minute)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {preferences.quietHours.enabled &&
          preferences.quietHours.startMinute ===
            preferences.quietHours.endMinute ? (
            <p className="settings-inline-note" role="alert">
              开始和结束时间不能相同，请调整其中一项。
            </p>
          ) : null}
        </section>

        <section className="settings-section" aria-label="声音与系统行为">
          <SettingRow
            title="轻声回应"
            description="只在你主动互动时播放很轻的音效；关闭后完全静音。"
            control={
              <Toggle
                label="启用互动声音"
                checked={preferences.sound.enabled}
                onChange={(checked) =>
                  applyPreferences({
                    sound: { enabled: checked },
                  })
                }
              />
            }
          />
          <SettingRow
            title="始终置顶"
            description="让宠物待在其他普通窗口前面。"
            control={
              <Toggle
                label="始终置顶"
                checked={preferences.alwaysOnTop}
                disabled={alwaysOnTopPending}
                onChange={(checked) =>
                  void handleAlwaysOnTopChange(checked)
                }
              />
            }
          />
          <SettingRow
            title="开机时出现"
            description={
              autostartAvailable
                ? '登录系统后自动启动 PetX。'
                : '当前系统不允许修改这项设置。'
            }
            control={
              <Toggle
                label="开机启动"
                checked={preferences.launchAtLogin}
                disabled={!autostartAvailable || autostartPending}
                onChange={(checked) => void handleAutostartChange(checked)}
              />
            }
          />
        </section>

        <fieldset className="settings-section settings-section--size">
          <legend>宠物大小</legend>
          <div className="settings-choice-grid settings-choice-grid--size">
            {SIZE_OPTIONS.map((option) => (
              <label
                className={
                  preferences.size === option.value
                    ? 'settings-choice settings-size-choice is-selected'
                    : 'settings-choice settings-size-choice'
                }
                key={option.value}
              >
                <input
                  type="radio"
                  name="pet-size"
                  value={option.value}
                  checked={
                    nearestSizePreset(preferences.size) === option.value
                  }
                  onChange={() =>
                    applyPreferences({ size: option.value })
                  }
                />
                <span className="settings-size-label">{option.label}</span>
                <span className="settings-choice-description">
                  {option.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section
          className="settings-section settings-section--memory"
          aria-labelledby="memory-title"
        >
          <div className="settings-memory-summary">
            <div>
              <h2 id="memory-title">相处记忆</h2>
              <p>
                已保存 {state.memories.length} / {MAX_COMPANION_MEMORIES}{' '}
                段共同记忆，全部只保存在本机。
              </p>
            </div>
            {!confirmingClear ? (
              <button
                className="settings-danger-button"
                type="button"
                onClick={() => setConfirmingClear(true)}
                disabled={
                  state.memories.length === 0 &&
                  state.meaningfulInteractionDates.length === 0
                }
              >
                清除记忆
              </button>
            ) : null}
          </div>

          {confirmingClear ? (
            <div
              className="settings-confirmation"
              role="alertdialog"
              aria-modal="false"
              aria-labelledby="clear-memory-title"
              aria-describedby="clear-memory-description"
            >
              <div>
                <h3 id="clear-memory-title">让它忘记相处经历？</h3>
                <p id="clear-memory-description">
                  初次见面、互动日期和纪念物都会被清除；昵称和偏好会保留。此操作无法撤销。
                </p>
              </div>
              <div className="settings-confirmation-actions">
                <button
                  className="settings-secondary-button"
                  type="button"
                  ref={cancelClearButtonRef}
                  onClick={() => setConfirmingClear(false)}
                >
                  取消
                </button>
                <button
                  className="settings-danger-button is-confirm"
                  type="button"
                  onClick={clearRelationshipMemory}
                >
                  确认清除
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </form>

      <footer className="settings-footer">
        {notice !== null ? (
          <p
            className={`settings-notice settings-notice--${notice.tone}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            {notice.message}
          </p>
        ) : (
          <p className="settings-save-note">更改会自动保存在本机。</p>
        )}
      </footer>
    </main>
  );
}

interface SettingRowProps {
  id?: string;
  title: string;
  description: string;
  control: ReactNode;
}

function SettingRow({
  id,
  title,
  description,
  control,
}: SettingRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: ToggleProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  return (
    <label className={disabled ? 'settings-toggle is-disabled' : 'settings-toggle'}>
      <span className="visually-hidden">{label}</span>
      <input
        className="settings-toggle-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
      />
      <span className="settings-toggle-track" aria-hidden="true">
        <span className="settings-toggle-thumb" />
      </span>
    </label>
  );
}

function formatMinuteOfDay(minute: number): string {
  const normalized = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minutePart = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minutePart).padStart(2, '0')}`;
}

function withCurrentTimeOptions(...currentValues: number[]): number[] {
  const options = new Set(BASE_TIME_OPTIONS);
  for (const value of currentValues) options.add(value);
  return [...options].sort((left, right) => left - right);
}

function nearestSizePreset(size: number): (typeof SIZE_OPTIONS)[number]['value'] {
  let nearest: (typeof SIZE_OPTIONS)[number] = SIZE_OPTIONS[0];
  for (const option of SIZE_OPTIONS.slice(1)) {
    if (Math.abs(option.value - size) < Math.abs(nearest.value - size)) {
      nearest = option;
    }
  }
  return nearest.value;
}
