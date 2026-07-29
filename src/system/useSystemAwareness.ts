import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '../platform';
import { fetchSystemSnapshot } from './client';
import {
  loadSystemPreferences,
  SYSTEM_PREFERENCES_CHANGED_EVENT,
  SYSTEM_PREFERENCES_STORAGE_KEY,
  type SystemPreferences,
  type SystemSnapshot,
} from './model';

const DESKTOP_POLL_INTERVAL_MS = 5_000;
const FOREGROUND_ONLY_POLL_INTERVAL_MS = 15_000;

export interface SystemAwarenessState {
  preferences: SystemPreferences;
  snapshot: SystemSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSystemAwareness(): SystemAwarenessState {
  const [preferences, setPreferences] = useState(loadSystemPreferences);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    if (
      !preferences.desktopAwareness &&
      !preferences.foregroundAppAwareness
    ) {
      let resetError: string | null = null;
      try {
        // This also drops the native CPU/network baseline and session totals.
        await fetchSystemSnapshot(false, false);
      } catch (reason) {
        resetError = errorMessage(reason);
      }
      if (generation !== refreshGeneration.current) return;
      setSnapshot(null);
      setLoading(false);
      setError(resetError);
      return;
    }

    try {
      const next = await fetchSystemSnapshot(
        preferences.desktopAwareness,
        preferences.foregroundAppAwareness,
      );
      if (generation !== refreshGeneration.current) return;
      setSnapshot(next);
      setError(null);
    } catch (reason) {
      if (generation !== refreshGeneration.current) return;
      setError(errorMessage(reason));
    } finally {
      if (generation === refreshGeneration.current) {
        setLoading(false);
      }
    }
  }, [
    preferences.desktopAwareness,
    preferences.foregroundAppAwareness,
  ]);

  useEffect(() => {
    void refresh();
    if (
      !preferences.desktopAwareness &&
      !preferences.foregroundAppAwareness
    ) {
      return () => {
        refreshGeneration.current += 1;
      };
    }
    const pollInterval = preferences.desktopAwareness
      ? DESKTOP_POLL_INTERVAL_MS
      : FOREGROUND_ONLY_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => void refresh(), pollInterval);
    const refreshOnActivity = () => void refresh();
    window.addEventListener('focus', refreshOnActivity);
    window.addEventListener('online', refreshOnActivity);
    window.addEventListener('offline', refreshOnActivity);
    document.addEventListener('visibilitychange', refreshOnActivity);
    return () => {
      refreshGeneration.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnActivity);
      window.removeEventListener('online', refreshOnActivity);
      window.removeEventListener('offline', refreshOnActivity);
      document.removeEventListener('visibilitychange', refreshOnActivity);
    };
  }, [preferences.desktopAwareness, refresh]);

  useEffect(() => {
    const reload = () => setPreferences(loadSystemPreferences());
    const onStorage = (event: StorageEvent) => {
      if (event.key === SYSTEM_PREFERENCES_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    if (!isTauri) {
      return () => window.removeEventListener('storage', onStorage);
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .listen(SYSTEM_PREFERENCES_CHANGED_EVENT, reload)
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((reason: unknown) =>
        console.error('Unable to listen for system preference changes', reason),
      );
    return () => {
      disposed = true;
      window.removeEventListener('storage', onStorage);
      unlisten?.();
    };
  }, []);

  return { preferences, snapshot, loading, error, refresh };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '暂时无法读取桌面状态。';
}
