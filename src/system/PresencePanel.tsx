import type {
  CompanionNotificationStatus,
  SystemPreferences,
  SystemSnapshot,
} from './model';
import { companionNotificationIsAllowed } from './model';

interface PresencePanelProps {
  snapshot: SystemSnapshot | null;
  preferences: SystemPreferences;
  notificationStatus: CompanionNotificationStatus;
  loading: boolean;
  error: string | null;
  notificationPending: boolean;
  onRefresh: () => void;
  onTestNotification: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function PresencePanel({
  snapshot,
  preferences,
  notificationStatus,
  loading,
  error,
  notificationPending,
  onRefresh,
  onTestNotification,
  onOpenSettings,
  onClose,
}: PresencePanelProps) {
  return (
    <section className="presence-sheet" aria-labelledby="presence-title">
      <header className="presence-sheet__header">
        <div>
          <p>只留在此刻</p>
          <h1 id="presence-title">桌面札记</h1>
        </div>
        <button type="button" onClick={onClose}>
          收起
        </button>
      </header>

      <dl className="presence-sheet__signals">
        <PresenceRow
          term="正在陪你"
          value={
            preferences.foregroundAppAwareness
              ? snapshot?.frontmostAppName ?? '暂时没认出来'
              : '应用感知未开启'
          }
        />
        <PresenceRow
          term="你的动静"
          value={
            preferences.desktopAwareness
              ? presenceLabel(snapshot?.idleSeconds ?? null)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="电源"
          value={
            preferences.desktopAwareness
              ? powerLabel(snapshot)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="网络"
          value={
            preferences.desktopAwareness
              ? networkLabel(snapshot)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="系统 CPU"
          value={
            preferences.desktopAwareness
              ? cpuLabel(snapshot)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="实时流量"
          value={
            preferences.desktopAwareness
              ? networkRateLabel(snapshot)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="本次陪伴"
          value={
            preferences.desktopAwareness
              ? networkSessionLabel(snapshot)
              : '桌面动静未开启'
          }
        />
        <PresenceRow
          term="系统"
          value={
            preferences.desktopAwareness
              ? systemConditionLabel(snapshot)
              : '桌面动静未开启'
          }
        />
      </dl>

      {error ? (
        <div className="presence-sheet__status is-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={onRefresh}>再看一次</button>
        </div>
      ) : loading ? (
        <p className="presence-sheet__status" role="status">
          正在听桌面的动静…
        </p>
      ) : null}

      <p className="presence-sheet__privacy">
        只读取系统总 CPU 与非回环网卡计数；不读取窗口标题、请求地址、
        域名、正文、单个进程或其他 App 的通知。这里的状态不会写进相处记忆。
      </p>

      <footer className="presence-sheet__actions">
        <button
          type="button"
          disabled={
            notificationPending ||
            !preferences.companionNotifications ||
            !companionNotificationIsAllowed(notificationStatus)
          }
          onClick={onTestNotification}
        >
          {notificationPending ? '正在呼唤…' : '从系统里叫我一下'}
        </button>
        <button type="button" onClick={onOpenSettings}>
          调整感知…
        </button>
      </footer>
    </section>
  );
}

function PresenceRow({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function presenceLabel(idleSeconds: number | null) {
  if (idleSeconds === null) return '系统没有提供';
  if (idleSeconds < 60) return '刚刚还在';
  if (idleSeconds < 5 * 60) return `安静了 ${Math.floor(idleSeconds / 60)} 分钟`;
  return `离开约 ${Math.floor(idleSeconds / 60)} 分钟`;
}

function powerLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  const { power } = snapshot;
  if (power.percent === null) {
    return power.source === 'ac' ? '已连接电源' : '系统没有提供';
  }
  const suffix = power.charging
    ? ' · 正在充电'
    : power.source === 'battery'
      ? ' · 使用电池'
      : '';
  return `${Math.round(power.percent)}%${suffix}`;
}

function networkLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  if (snapshot.network === 'reachable') return '网络路径可用';
  if (snapshot.network === 'unreachable') return '网络路径暂不可达';
  return '系统没有提供';
}

function cpuLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  if (snapshot.resources === null) return '系统没有提供';
  if (snapshot.resources.cpuPercent === null) return '正在建立采样基线';
  const percent = snapshot.resources.cpuPercent;
  const pace = percent >= 80 ? '忙碌' : percent >= 45 ? '有些忙' : '轻松';
  return `${percent}% · ${pace}`;
}

function networkRateLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  const resources = snapshot.resources;
  if (resources === null) return '系统没有提供';
  if (
    resources.networkReceivedBytesPerSecond === null ||
    resources.networkTransmittedBytesPerSecond === null
  ) {
    return '正在建立采样基线';
  }
  return `↓ ${formatBytes(resources.networkReceivedBytesPerSecond)}/秒 · ↑ ${formatBytes(resources.networkTransmittedBytesPerSecond)}/秒`;
}

function networkSessionLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  const resources = snapshot.resources;
  if (resources === null) return '系统没有提供';
  return `↓ ${formatBytes(resources.sessionReceivedBytes)} · ↑ ${formatBytes(resources.sessionTransmittedBytes)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function systemConditionLabel(snapshot: SystemSnapshot | null) {
  if (snapshot === null) return '正在确认';
  if (
    snapshot.thermalState === 'critical' ||
    snapshot.thermalState === 'serious'
  ) {
    return '机身温度偏高';
  }
  if (snapshot.lowPowerMode === true) return '低电量模式';
  if (
    snapshot.thermalState === null &&
    snapshot.lowPowerMode === null
  ) {
    return '系统没有提供';
  }
  return '运行平稳';
}
