import { useCallback, useEffect, useRef, useState } from 'react';

export type PetAnimationName =
  | 'idle'
  | 'waving'
  | 'jumping'
  | 'sleeping'
  | 'runningLeft'
  | 'runningRight';

export type PetActionAnimation = Exclude<PetAnimationName, 'idle' | 'sleeping'>;

type PetPresentation = {
  animation: PetAnimationName;
  frame?: number;
  instanceKey: number;
  playing: boolean;
  phase: 'base' | 'prepare' | 'action' | 'afterglow';
};

const actionSpecs: Record<PetActionAnimation, { duration: number; frames: number }> = {
  waving: { duration: 560, frames: 4 },
  jumping: { duration: 700, frames: 5 },
  runningLeft: { duration: 960, frames: 8 },
  runningRight: { duration: 960, frames: 8 },
};

export function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

export function usePetAnimation(
  baseAnimation: Extract<PetAnimationName, 'idle' | 'sleeping'>,
  reducedMotion: boolean,
) {
  const [presentation, setPresentation] = useState<PetPresentation>({
    animation: baseAnimation,
    instanceKey: 0,
    phase: 'base',
    playing: !reducedMotion,
  });
  const timers = useRef<number[]>([]);
  const sequence = useRef(0);
  const actionActive = useRef(false);
  const latestBase = useRef(baseAnimation);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const showBase = useCallback(() => {
    actionActive.current = false;
    sequence.current += 1;
    setPresentation({
      animation: latestBase.current,
      frame: reducedMotion ? 0 : undefined,
      instanceKey: sequence.current,
      phase: 'base',
      playing: !reducedMotion,
    });
  }, [reducedMotion]);

  useEffect(() => {
    latestBase.current = baseAnimation;
    if (!actionActive.current) showBase();
  }, [baseAnimation, showBase]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearTimers();
        showBase();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimers();
    };
  }, [clearTimers, showBase]);

  const play = useCallback(
    (animation: PetActionAnimation) => {
      clearTimers();
      actionActive.current = true;
      sequence.current += 1;
      const token = sequence.current;
      const spec = actionSpecs[animation];
      const prepareDuration = reducedMotion ? 40 : 170;
      const actionDuration = reducedMotion ? 260 : spec.duration;
      const afterglowDuration = reducedMotion ? 80 : 180;

      setPresentation({
        animation: 'idle',
        frame: 0,
        instanceKey: token,
        phase: 'prepare',
        playing: false,
      });

      timers.current.push(
        window.setTimeout(() => {
          if (token !== sequence.current) return;
          setPresentation({
            animation,
            frame: reducedMotion ? spec.frames - 1 : undefined,
            instanceKey: token + 1,
            phase: 'action',
            playing: !reducedMotion,
          });
        }, prepareDuration),
      );

      timers.current.push(
        window.setTimeout(() => {
          if (token !== sequence.current) return;
          setPresentation({
            animation,
            frame: spec.frames - 1,
            instanceKey: token + 2,
            phase: 'afterglow',
            playing: false,
          });
        }, prepareDuration + actionDuration),
      );

      timers.current.push(
        window.setTimeout(() => {
          if (token !== sequence.current) return;
          showBase();
        }, prepareDuration + actionDuration + afterglowDuration),
      );
    },
    [clearTimers, reducedMotion, showBase],
  );

  return { play, presentation };
}
