import { PetX } from '@petx/react';
import type { CodexPetLookDirection, CodexPetManifest } from '@petx/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  companionReducer,
  createDefaultCompanionState,
  decideIdleBehavior,
  decideProactiveBubble,
  feed,
  getCareSnapshot,
  getRelationshipStage,
  greet,
  pet,
  play,
  recordKeepsake,
  rest,
  type CompanionState,
} from './model';
import {
  COMPANION_PREFERENCES_STORAGE_KEY,
  COMPANION_STORAGE_KEY,
  loadCompanionState,
  saveCompanionRelationshipState,
} from './storage';
import {
  getPreviewSurface,
  hideCompanion,
  isTauri,
  quietCompanionForOneHour,
  quitApplication,
  scheduleCompanionWindowFit,
  setCompanionAlwaysOnTop,
  showCompanionContextMenu,
  showLibraryWindow,
  showSettingsWindow,
  startCompanionDrag,
  type CompanionSurface,
} from '../platform';
import { usePetAnimation, usePrefersReducedMotion } from './usePetAnimation';
import { CarePanel } from './CarePanel';
import { MemoryJournal } from './MemoryJournal';
import { SpeechBubble } from './SpeechBubble';
import { playCompanionChime } from './sound';

const petManifest: CodexPetManifest = {
  id: 'frieren',
  displayName: 'Frieren',
  description: 'A quiet white-haired desktop companion.',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
};

type BubbleKind = 'welcome' | 'return' | 'response' | 'proactive';

interface BubbleState {
  kind: BubbleKind;
  text: string;
}

const petClickDelayMs = 230;
const dragThreshold = 6;

export function CompanionView() {
  const [state, dispatch] = useReducer(
    companionReducer,
    undefined,
    loadCompanionState,
  );
  const previewSurface = getPreviewSurface();
  const [surface, setSurface] = useState<CompanionSurface>(
    previewSurface ?? 'resting',
  );
  const [bubble, setBubble] = useState<BubbleState>(() => ({
    kind: state.firstInteractionAt === null ? 'welcome' : 'return',
    text:
      state.firstInteractionAt === null
        ? '这里可以待一会吗？'
        : returningLine(state),
  }));
  const [lookDirection, setLookDirection] =
    useState<CodexPetLookDirection>();
  const [bubbleEngaged, setBubbleEngaged] = useState(false);
  const [careFeedback, setCareFeedback] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const clickTimer = useRef<number | undefined>(undefined);
  const dismissTimer = useRef<number | undefined>(undefined);
  const pointerOrigin = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const petButtonRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef(surface);
  const persistenceWarningShown = useRef(false);
  surfaceRef.current = surface;
  const dragged = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  const idleBehavior = useMemo(
    () => decideIdleBehavior(state, clock),
    [clock, state],
  );
  const baseAnimation =
    idleBehavior === 'sleeping' || idleBehavior === 'napping'
      ? 'sleeping'
      : 'idle';
  const { play: playAnimation, presentation } = usePetAnimation(
    baseAnimation,
    reducedMotion,
  );
  const presentedState = useMemo(
    () =>
      (previewSurface === 'journal' || previewSurface === 'care') &&
      state.firstInteractionAt === null
        ? createPreviewJournalState()
        : state,
    [previewSurface, state],
  );
  const careSnapshot = useMemo(
    () => getCareSnapshot(presentedState, clock),
    [clock, presentedState],
  );

  useEffect(() => {
    if (surface === 'bubble' && bubble.kind === 'welcome') {
      playAnimation('waving');
    }
  }, [bubble.kind, playAnimation, surface]);

  useEffect(() => {
    document.body.classList.add('companion-mode');
    document.body.classList.toggle('browser-preview', !isTauri);
    return () => {
      document.body.classList.remove('companion-mode');
      document.body.classList.remove('browser-preview');
    };
  }, []);

  useEffect(() => {
    const saved = saveCompanionRelationshipState(state);
    if (saved) {
      persistenceWarningShown.current = false;
      return;
    }
    if (persistenceWarningShown.current) return;

    persistenceWarningShown.current = true;
    console.error('Unable to persist companion state');
    setBubble({
      kind: 'response',
      text: '刚才的记忆没能保存在本机。',
    });
    setSurface('bubble');
  }, [state]);

  useEffect(() => {
    void setCompanionAlwaysOnTop(state.preferences.alwaysOnTop).catch(
      (error: unknown) =>
        console.error('Unable to restore always-on-top preference', error),
    );
  }, [state.preferences.alwaysOnTop]);

  useEffect(() => {
    scheduleCompanionWindowFit(surface);
  }, [surface]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (previewSurface !== null || state.firstInteractionAt !== null) return;
    const timer = window.setTimeout(() => {
      setBubble({ kind: 'welcome', text: '这里可以待一会吗？' });
      setSurface('bubble');
    }, reducedMotion ? 180 : 720);
    return () => window.clearTimeout(timer);
  }, [previewSurface, reducedMotion, state.firstInteractionAt]);

  useEffect(() => {
    if (surface !== 'bubble' || bubbleEngaged) return;
    window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(
      () => {
        if (bubble.kind === 'proactive') {
          dispatch({ type: 'ignore', at: new Date() });
        }
        setSurface('resting');
      },
      bubble.kind === 'welcome' ? 12_000 : 7_500,
    );
    return () => window.clearTimeout(dismissTimer.current);
  }, [bubble.kind, bubble.text, bubbleEngaged, surface]);

  useEffect(() => {
    if (surface !== 'bubble') setBubbleEngaged(false);
  }, [surface]);

  useEffect(() => {
    if (state.proactivity.pendingSince === null) return;
    if (surface === 'bubble' && bubble.kind === 'proactive') return;
    dispatch({ type: 'ignore', at: new Date() });
  }, [bubble.kind, state.proactivity.pendingSince, surface]);

  useEffect(() => {
    if (previewSurface !== null) return;
    const considerSpeaking = async () => {
      if (surface !== 'resting' || document.visibilityState !== 'visible') {
        return;
      }
      if (isTauri && !(await getCurrentWindow().isVisible())) return;
      if (surfaceRef.current !== 'resting') return;

      const now = new Date();
      if (!decideProactiveBubble(state, now).allowed) return;
      dispatch({ type: 'proactive-bubble-shown', at: now });
      setBubble({
        kind: 'proactive',
        text: proactiveLine(state, now),
      });
      setSurface('bubble');
    };
    const initial = window.setTimeout(
      () => void considerSpeaking(),
      60_000,
    );
    const interval = window.setInterval(
      () => void considerSpeaking(),
      5 * 60_000,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [previewSurface, state, surface]);

  useEffect(() => {
    const applyLatestPreferences = () => {
      const latestState = loadCompanionState();
      dispatch({
        type: 'update-preferences',
        patch: latestState.preferences,
      });
    };
    const replaceWithStoredState = () =>
      dispatch({ type: 'replace-state', state: loadCompanionState() });
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPANION_STORAGE_KEY) {
        replaceWithStoredState();
      } else if (event.key === COMPANION_PREFERENCES_STORAGE_KEY) {
        applyLatestPreferences();
      }
    };
    window.addEventListener('storage', onStorage);

    if (!isTauri) {
      return () => window.removeEventListener('storage', onStorage);
    }

    let unlistenPreferences: (() => void) | undefined;
    let unlistenReplacement: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .listen('petx://state-changed', applyLatestPreferences)
      .then((dispose) => {
        if (disposed) dispose();
        else unlistenPreferences = dispose;
      })
      .catch((error: unknown) =>
        console.error('Unable to listen for preference changes', error),
      );
    void getCurrentWindow()
      .listen('petx://state-replaced', replaceWithStoredState)
      .then((dispose) => {
        if (disposed) dispose();
        else unlistenReplacement = dispose;
      })
      .catch((error: unknown) =>
        console.error('Unable to listen for relationship resets', error),
      );
    return () => {
      disposed = true;
      window.removeEventListener('storage', onStorage);
      unlistenPreferences?.();
      unlistenReplacement?.();
    };
  }, []);

  const showReturningBubble = useCallback(() => {
    if (state.firstInteractionAt !== null) {
      dispatch({ type: 'greet', at: new Date() });
    }
    setBubble({
      kind: state.firstInteractionAt === null ? 'welcome' : 'return',
      text:
        state.firstInteractionAt === null
          ? '这里可以待一会吗？'
          : returningLine(state),
    });
    playAnimation('waving');
    setSurface('bubble');
  }, [playAnimation, state]);

  const acceptWelcome = useCallback(() => {
    const now = new Date();
    playCompanionChime(state.preferences.sound);
    dispatch({ type: 'greet', at: now });
    dispatch({
      type: 'record-keepsake',
      keepsake: {
        id: 'first-light',
        name: '收好的一颗光点',
        note: '第一次见面时，悄悄留下来的。',
      },
      at: now,
    });
    playAnimation('waving');
    setBubble({ kind: 'response', text: '那我就待在这里。' });
  }, [playAnimation, state.preferences.sound]);

  const petCompanion = useCallback(() => {
    playCompanionChime(state.preferences.sound);
    dispatch({ type: 'pet', at: new Date() });
    playAnimation('waving');
    setBubble({ kind: 'response', text: '嗯……再一下也可以。' });
    setSurface('bubble');
  }, [playAnimation, state.preferences.sound]);

  const playTogether = useCallback(() => {
    playCompanionChime(state.preferences.sound, 'bright');
    dispatch({ type: 'play', at: new Date() });
    playAnimation('jumping');
    setBubble({ kind: 'response', text: '抓到你了。' });
    setSurface('bubble');
  }, [playAnimation, state.preferences.sound]);

  const openCare = useCallback(() => {
    setCareFeedback(null);
    setSurface('care');
  }, []);

  const feedCompanion = useCallback(() => {
    const now = new Date();
    const before = getCareSnapshot(state, now);
    playCompanionChime(state.preferences.sound);
    dispatch({ type: 'feed', at: now });
    playAnimation('waving');
    setCareFeedback(
      before.satiety >= 92
        ? '已经很满足了，还是把这份心意收下了。'
        : '这个味道，我记住了。',
    );
    setSurface('care');
  }, [playAnimation, state]);

  const playDuringCare = useCallback(() => {
    const now = new Date();
    const before = getCareSnapshot(state, now);
    playCompanionChime(state.preferences.sound, 'bright');
    dispatch({ type: 'play', at: now });
    playAnimation('jumping');
    setCareFeedback(
      before.energy <= 24
        ? '慢一点也很好玩。等会儿一起歇一歇吧。'
        : '抓到你了。再来一次？',
    );
    setSurface('care');
  }, [playAnimation, state]);

  const restTogether = useCallback(() => {
    const now = new Date();
    const before = getCareSnapshot(state, now);
    playCompanionChime(state.preferences.sound);
    dispatch({ type: 'rest', at: now });
    setCareFeedback(
      before.energy >= 92
        ? '不困也没关系，安静待着也算休息。'
        : '那就安静地待一会。',
    );
    setSurface('care');
  }, [state]);

  const dismissBubble = useCallback(() => {
    if (bubble.kind === 'proactive') {
      dispatch({ type: 'ignore', at: new Date() });
    }
    setSurface('resting');
  }, [bubble.kind]);

  const closeJournal = useCallback(() => {
    setSurface('resting');
    window.requestAnimationFrame(() => petButtonRef.current?.focus());
  }, []);

  const closeCare = useCallback(() => {
    setSurface('resting');
    window.requestAnimationFrame(() => petButtonRef.current?.focus());
  }, []);

  const openContextMenu = useCallback(async () => {
    const shownNatively = await showCompanionContextMenu({
      openCare,
      openLibrary: () => void showLibraryWindow(),
      openJournal: () => setSurface('journal'),
      quietForOneHour: () => void quietCompanionForOneHour(),
      openSettings: () => void showSettingsWindow(),
      hide: () => void hideCompanion(),
      quit: () => void quitApplication(),
    }).catch(() => false);

    if (!shownNatively) setSurface('context');
  }, [openCare]);

  const handlePointerUp = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || pointerOrigin.current === undefined) return;
    pointerOrigin.current = undefined;
    if (dragged.current) {
      dragged.current = false;
      return;
    }

    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(showReturningBubble, petClickDelayMs);
  };

  const handleDoubleClick = () => {
    window.clearTimeout(clickTimer.current);
    playTogether();
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLookDirection({
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    });

    if (
      event.buttons === 1 &&
      pointerOrigin.current !== undefined &&
      !dragged.current
    ) {
      const distance = Math.hypot(
        event.clientX - pointerOrigin.current.x,
        event.clientY - pointerOrigin.current.y,
      );
      if (distance >= dragThreshold) {
        dragged.current = true;
        void startCompanionDrag();
      }
    }
  };

  const bubbleActions = bubble.kind === 'welcome'
    ? [
        { label: '可以', onSelect: acceptWelcome },
        { label: '先安静', onSelect: dismissBubble, quiet: true },
      ]
    : bubble.kind === 'response'
      ? []
      : bubble.kind === 'proactive'
        ? [
            { label: '陪你一下', onSelect: petCompanion },
            { label: '我在忙', onSelect: dismissBubble, quiet: true },
          ]
        : [
            { label: '摸摸', onSelect: petCompanion },
            { label: '照料一下', onSelect: openCare },
          ];

  return (
    <main
      className={`companion-shell companion-shell--${surface}`}
      aria-label={`${state.nickname} 桌面伙伴`}
      onContextMenu={(event) => {
        event.preventDefault();
        void openContextMenu();
      }}
    >
      {surface === 'bubble' ? (
        <SpeechBubble
          speakerName={state.nickname}
          text={bubble.text}
          primaryActions={bubbleActions.filter((action) => !action.quiet)}
          quietAction={bubbleActions.find((action) => action.quiet)}
          onDismiss={dismissBubble}
          onEngagementChange={setBubbleEngaged}
        />
      ) : null}

      {surface === 'journal' ? (
        <MemoryJournal
          nickname={presentedState.nickname}
          memories={presentedState.memories}
          relationshipStage={getRelationshipStage(presentedState)}
          onClose={closeJournal}
        />
      ) : null}

      {surface === 'care' ? (
        <div
          className="care-dismiss-layer"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === 0) closeCare();
          }}
        />
      ) : null}

      {surface === 'care' ? (
        <CarePanel
          nickname={presentedState.nickname}
          relationshipStage={getRelationshipStage(presentedState)}
          snapshot={careSnapshot}
          feedback={careFeedback}
          onFeed={feedCompanion}
          onPlay={playDuringCare}
          onRest={restTogether}
          onClose={closeCare}
        />
      ) : null}

      {surface === 'context' ? (
        <BrowserContextMenu
          onCare={openCare}
          onJournal={() => setSurface('journal')}
          onLibrary={() => void showLibraryWindow()}
          onQuiet={() => void quietCompanionForOneHour()}
          onSettings={() => void showSettingsWindow()}
          onHide={() => void hideCompanion()}
          onQuit={() => void quitApplication()}
          onDismiss={() => setSurface('resting')}
        />
      ) : null}

      {surface !== 'journal' ? (
        <section
          className="pet-stage"
          aria-label={`${state.nickname} 在桌面上`}
          aria-hidden={surface === 'care' ? true : undefined}
          inert={surface === 'care' ? true : undefined}
        >
        <button
          className="pet-button"
          type="button"
          ref={petButtonRef}
          tabIndex={surface === 'care' ? -1 : 0}
          aria-label={`${state.nickname}；单击打招呼，双击一起玩，拖动移动位置，右键打开菜单`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pointerOrigin.current = { x: event.clientX, y: event.clientY };
            dragged.current = false;
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pointerOrigin.current = undefined;
            dragged.current = false;
          }}
          onPointerLeave={() => setLookDirection(undefined)}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              showReturningBubble();
            }
          }}
        >
          <PetX
            key={presentation.instanceKey}
            pet={petManifest}
            manifestUrl="/pets/frieren/pet.json"
            animation={presentation.animation}
            frame={presentation.frame}
            playing={presentation.playing}
            lookDirection={
              presentation.phase === 'base' && baseAnimation !== 'sleeping'
                ? lookDirection
                : undefined
            }
            lookDeadzone={10}
            size={state.preferences.size}
            title={`${state.nickname} 桌面伙伴`}
          />
        </button>
        </section>
      ) : null}
    </main>
  );
}

interface BrowserContextMenuProps {
  onCare: () => void;
  onLibrary: () => void;
  onJournal: () => void;
  onQuiet: () => void;
  onSettings: () => void;
  onHide: () => void;
  onQuit: () => void;
  onDismiss: () => void;
}

function BrowserContextMenu({
  onCare,
  onLibrary,
  onJournal,
  onQuiet,
  onSettings,
  onHide,
  onQuit,
  onDismiss,
}: BrowserContextMenuProps) {
  return (
    <>
      <button
        className="context-dismiss"
        type="button"
        aria-label="关闭菜单"
        onClick={onDismiss}
      />
      <nav className="pet-context-menu" aria-label="宠物菜单">
        <button type="button" onClick={onCare}>照料一下…</button>
        <button type="button" onClick={onLibrary}>发现新伙伴…</button>
        <button type="button" onClick={onJournal}>打开纪念册</button>
        <button type="button" onClick={onQuiet}>安静一小时</button>
        <hr />
        <button type="button" onClick={onSettings}>设置…</button>
        <button type="button" onClick={onHide}>隐藏宠物</button>
        <hr />
        <button type="button" onClick={onQuit}>退出 PetX</button>
      </nav>
    </>
  );
}

function returningLine(state: CompanionState) {
  if (state.lastInteractionAt === null) return '你来啦。';
  const elapsed = Date.now() - Date.parse(state.lastInteractionAt);
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 6) return '还没睡吗？我陪你待一会。';
  if (elapsed >= 20 * 60 * 60 * 1000) return '你又回来啦。';
  if (state.mood === 'playful') return '刚才那一下，还挺有意思的。';
  if (state.mood === 'content') return '我刚好在这里。';
  return '你来啦。';
}

function proactiveLine(state: CompanionState, now: Date) {
  const hour = now.getHours();
  if (hour >= 21) return '今天辛苦了。要不要一起发会儿呆？';
  if (state.mood === 'playful') return '我发现了一个很适合跳一下的地方。';
  return hour < 12 ? '早。窗边的光已经来了。' : '我刚刚好像听见风了。';
}

function createPreviewJournalState() {
  const now = new Date();
  const firstDay = new Date(now);
  firstDay.setDate(firstDay.getDate() - 4);
  const secondDay = new Date(now);
  secondDay.setDate(secondDay.getDate() - 2);

  let state = createDefaultCompanionState();
  state = greet(state, firstDay);
  state = recordKeepsake(
    state,
    {
      id: 'first-light',
      name: '收好的一颗光点',
      note: '第一次见面时，悄悄留下来的。',
    },
    firstDay,
  );
  state = pet(state, secondDay);
  return play(state, now);
}
