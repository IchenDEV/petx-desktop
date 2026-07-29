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
import {
  getCompanionNotificationStatus,
  requestCompanionNotificationPermission,
  sendCompanionNotification,
} from '../system/client';
import {
  companionNotificationIsAllowed,
  loadSystemPreferences,
  saveSystemPreferences,
  SYSTEM_PREFERENCES_CHANGED_EVENT,
  type CompanionNotificationStatus,
  type SystemPreferences,
} from '../system/model';
import {
  activePetKey,
  DEFAULT_ACTIVE_PET,
} from '../library/model';
import { useActivePet } from '../library/useActivePet';

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
  const active = useActivePet();
  const activePet = active.pet ?? DEFAULT_ACTIVE_PET;
  const profileKey = activePetKey(activePet.reference);
  const loadCurrentCompanionState = useCallback(
    () =>
      loadCompanionState(
        undefined,
        profileKey,
        activePet.displayName,
      ),
    [activePet.displayName, profileKey],
  );
  const [state, setState] = useState<CompanionState>(loadCompanionState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [autostartAvailable, setAutostartAvailable] = useState(!isTauri);
  const [autostartPending, setAutostartPending] = useState(isTauri);
  const [alwaysOnTopPending, setAlwaysOnTopPending] = useState(false);
  const [systemPreferences, setSystemPreferences] =
    useState<SystemPreferences>(loadSystemPreferences);
  const [notificationStatus, setNotificationStatus] =
    useState<CompanionNotificationStatus>('notDetermined');
  const [notificationPending, setNotificationPending] = useState(false);
  const notificationStatusRequest = useRef(0);
  const cancelClearButtonRef = useRef<HTMLButtonElement>(null);

  const commitState = useCallback(
    (nextState: CompanionState, successMessage?: string): boolean => {
      if (!saveCompanionState(nextState, undefined, profileKey)) {
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
    [profileKey],
  );

  const commitPreferences = useCallback(
    (
      preferences: CompanionPreferences,
      successMessage?: string,
    ): boolean => {
      const nextState = saveCompanionPreferences(
        preferences,
        undefined,
        profileKey,
        activePet.displayName,
      );
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
    [activePet.displayName, profileKey],
  );

  const applyPreferences = useCallback(
    (patch: CompanionPreferencesPatch) => {
      const latestState = loadCurrentCompanionState();
      commitPreferences(updatePreferences(latestState, patch).preferences);
    },
    [commitPreferences, loadCurrentCompanionState],
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

  const commitSystemPreferences = useCallback(
    (next: SystemPreferences, successMessage?: string) => {
      if (!saveSystemPreferences(next)) {
        setNotice({
          tone: 'error',
          message: '桌面感知偏好没有保存，请检查本机存储权限。',
        });
        return false;
      }
      setSystemPreferences(next);
      setNotice(
        successMessage
          ? { tone: 'status', message: successMessage }
          : null,
      );
      void notifyMainWindow(
        SYSTEM_PREFERENCES_CHANGED_EVENT,
        next,
      ).catch((error: unknown) => {
        console.error('Unable to notify system preference changes', error);
      });
      return true;
    },
    [],
  );

  const refreshNotificationStatus = useCallback(async () => {
    const request = ++notificationStatusRequest.current;
    try {
      const status = await getCompanionNotificationStatus();
      if (request !== notificationStatusRequest.current) return;
      setNotificationStatus(status);
      if (
        !companionNotificationIsAllowed(status) &&
        loadSystemPreferences().companionNotifications
      ) {
        const next = {
          ...loadSystemPreferences(),
          companionNotifications: false,
        };
        commitSystemPreferences(next);
      }
    } catch (error) {
      if (request === notificationStatusRequest.current) {
        console.error('Unable to read PetX notification status', error);
      }
    }
  }, [commitSystemPreferences]);

  useEffect(() => {
    setState(loadCurrentCompanionState());
  }, [loadCurrentCompanionState]);

  useEffect(() => {
    const refreshState = () => {
      setState(loadCurrentCompanionState());
      setSystemPreferences(loadSystemPreferences());
    };
    const handleFocus = () => {
      refreshState();
      void refreshNotificationStatus();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', refreshState);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', refreshState);
    };
  }, [loadCurrentCompanionState, refreshNotificationStatus]);

  useEffect(() => {
    void refreshNotificationStatus();
    return () => {
      notificationStatusRequest.current += 1;
    };
  }, [refreshNotificationStatus]);

  useEffect(() => {
    if (!isTauri) return;

    let active = true;
    void isAutostartEnabled()
      .then((enabled) => {
        if (!active) return;
        setAutostartAvailable(true);
        setAutostartPending(false);
        const latestState = loadCurrentCompanionState();
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
  }, [commitPreferences, loadCurrentCompanionState]);

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

    const previousState = loadCurrentCompanionState();
    const previousValue = previousState.preferences.alwaysOnTop;
    setAlwaysOnTopPending(true);
    setNotice(null);

    try {
      await setCompanionAlwaysOnTop(checked);
      const latestState = loadCurrentCompanionState();
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

    const previousState = loadCurrentCompanionState();
    const previousValue = previousState.preferences.launchAtLogin;
    setAutostartPending(true);
    setNotice(null);

    try {
      await (checked ? enableAutostart() : disableAutostart());
      const latestState = loadCurrentCompanionState();
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
    const latestState = loadCurrentCompanionState();
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

  const handleCompanionNotificationsChange = async (checked: boolean) => {
    if (notificationPending) return;
    if (!checked) {
      commitSystemPreferences({
        ...systemPreferences,
        companionNotifications: false,
      });
      return;
    }

    setNotificationPending(true);
    setNotice(null);
    try {
      const status =
        companionNotificationIsAllowed(notificationStatus)
          ? notificationStatus
          : await requestCompanionNotificationPermission();
      setNotificationStatus(status);
      if (!companionNotificationIsAllowed(status)) {
        commitSystemPreferences({
          ...systemPreferences,
          companionNotifications: false,
        });
        setNotice({
          tone: 'error',
          message:
            status === 'denied'
              ? '系统没有允许通知；可以稍后在 macOS 系统设置中调整。'
              : '当前系统暂不支持 PetX 通知。',
        });
        return;
      }

      if (
        commitSystemPreferences(
          { ...systemPreferences, companionNotifications: true },
          '已开启 PetX 自己的系统问候。',
        )
      ) {
        await sendCompanionNotification('test');
      }
    } catch (error) {
      console.error('Unable to enable companion notifications', error);
      setNotice({
        tone: 'error',
        message: '没有开启系统通知，请稍后再试。',
      });
    } finally {
      setNotificationPending(false);
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

        <section
          className="settings-section settings-section--awareness"
          aria-labelledby="desktop-awareness-title"
        >
          <div className="settings-section-heading">
            <h2 id="desktop-awareness-title">生活在这台 Mac 上</h2>
            <p>
              它可以留意当下的动静并做出轻微反应；这些状态不进入相处记忆。
            </p>
          </div>
          <SettingRow
            title="桌面动静"
            description="感知离开与回来、电量、CPU 和聚合网络流量；关闭后停止采样。"
            control={
              <Toggle
                label="感知桌面动静"
                checked={systemPreferences.desktopAwareness}
                onChange={(checked) =>
                  commitSystemPreferences({
                    ...systemPreferences,
                    desktopAwareness: checked,
                  })
                }
              />
            }
          />
          <SettingRow
            title="正在使用的 App"
            description="只看应用名称，不读取窗口标题、文档或输入内容；默认关闭。"
            control={
              <Toggle
                label="感知前台应用"
                checked={systemPreferences.foregroundAppAwareness}
                onChange={(checked) =>
                  commitSystemPreferences({
                    ...systemPreferences,
                    foregroundAppAwareness: checked,
                  })
                }
              />
            }
          />
          <SettingRow
            title="PetX 系统问候"
            description={notificationDescription(notificationStatus)}
            control={
              <Toggle
                label="允许 PetX 发送自己的系统通知"
                checked={
                  systemPreferences.companionNotifications &&
                  companionNotificationIsAllowed(notificationStatus)
                }
                disabled={
                  notificationPending ||
                  notificationStatus === 'unsupported'
                }
                onChange={(checked) =>
                  void handleCompanionNotificationsChange(checked)
                }
              />
            }
          />
          <p className="settings-privacy-note">
            macOS 不向 PetX 提供其他 App 的通知内容；PetX
            也不会读取通知中心数据库、请求地址、域名、正文或单个进程流量。
          </p>
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

function notificationDescription(status: CompanionNotificationStatus) {
  if (companionNotificationIsAllowed(status)) {
    return '只发送 PetX 自己的问候；关闭后即使系统仍保留权限也不会发送。';
  }
  if (status === 'denied') {
    return '系统已拒绝，可在 macOS 系统设置的“通知”中重新允许。';
  }
  if (status === 'unsupported') {
    return '当前系统不支持这项功能。';
  }
  return '开启时才会向 macOS 请求权限，不会在启动时打扰你。';
}
