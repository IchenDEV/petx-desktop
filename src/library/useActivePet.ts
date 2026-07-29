import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchActivePet,
  listenToActivePetChanges,
} from './client';
import { DEFAULT_ACTIVE_PET, type ResolvedActivePet } from './model';

export interface ActivePetState {
  pet: ResolvedActivePet | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useActivePet(): ActivePetState {
  const [pet, setPet] = useState<ResolvedActivePet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const resolved = await fetchActivePet();
      if (generation.current !== request) return;
      setPet(resolved);
      setError(null);
    } catch (reason) {
      if (generation.current !== request) return;
      console.error('Unable to resolve the active companion', reason);
      setPet((current) => current ?? DEFAULT_ACTIVE_PET);
      setError('当前伙伴没有正确载入，已暂时换回 Frieren。');
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refresh();
    void listenToActivePetChanges(
      (resolved) => {
        if (disposed) return;
        generation.current += 1;
        setPet(resolved);
        setLoading(false);
        setError(null);
      },
      (reason) => {
        if (!disposed) {
          console.error('Unable to apply the active companion change', reason);
          void refresh();
        }
      },
    )
      .then((dispose) => {
        if (disposed) dispose();
        else {
          unlisten = dispose;
          // Re-read once the listener is attached so a switch made during
          // startup cannot fall into the fetch/listen hand-off gap.
          void refresh();
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          console.error('Unable to listen for active companion changes', reason);
        }
      });

    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      generation.current += 1;
      unlisten?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { pet, loading, error, refresh };
}
