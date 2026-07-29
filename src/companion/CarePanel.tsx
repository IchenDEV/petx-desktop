import { useEffect, useId, useRef } from 'react';
import type {
  CareSnapshot,
  Mood,
  RelationshipStage,
} from './model';

const relationshipLabels = {
  new: '刚刚认识',
  familiar: '渐渐熟悉',
  close: '很亲近了',
  companion: '一直相伴',
} satisfies Record<RelationshipStage, string>;

const moodLabels = {
  calm: '安静自在',
  curious: '正在好奇',
  content: '安心满足',
  playful: '还想再玩',
  sleepy: '准备休息',
} satisfies Record<Mood, string>;

export interface CarePanelProps {
  nickname: string;
  relationshipStage: RelationshipStage;
  snapshot: CareSnapshot;
  feedback: string | null;
  onFeed: () => void;
  onPlay: () => void;
  onRest: () => void;
  onClose: () => void;
}

export function CarePanel({
  nickname,
  relationshipStage,
  snapshot,
  feedback,
  onFeed,
  onPlay,
  onRest,
  onClose,
}: CarePanelProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const satiety = careLevel(snapshot.satiety, 'satiety');
  const energy = careLevel(snapshot.energy, 'energy');

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      className="care-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;

        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not([disabled])',
          ),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <header className="care-sheet__header">
        <div>
          <h1 id={titleId}>今天的相处</h1>
          <p>
            {nickname}
            <span aria-hidden="true"> · </span>
            {relationshipLabels[relationshipStage]}
          </p>
        </div>
        <button
          className="care-sheet__close"
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
        >
          收起
        </button>
      </header>

      <p className="care-sheet__summary">
        {careSummary(snapshot)}
      </p>

      <dl className="care-sheet__signals">
        <div className="care-sheet__signal">
          <dt>饱足</dt>
          <dd className="care-sheet__signal-value">{satiety.label}</dd>
          <dd
            className="care-sheet__meter"
            role="meter"
            aria-label="饱足"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(snapshot.satiety)}
            aria-valuetext={satiety.label}
          >
            <span style={{ width: `${snapshot.satiety}%` }} />
          </dd>
        </div>

        <div className="care-sheet__signal">
          <dt>精力</dt>
          <dd className="care-sheet__signal-value">{energy.label}</dd>
          <dd
            className="care-sheet__meter care-sheet__meter--energy"
            role="meter"
            aria-label="精力"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(snapshot.energy)}
            aria-valuetext={energy.label}
          >
            <span style={{ width: `${snapshot.energy}%` }} />
          </dd>
        </div>

        <div className="care-sheet__signal care-sheet__signal--mood">
          <dt>心情</dt>
          <dd>{moodLabels[snapshot.mood]}</dd>
        </div>
      </dl>

      <div className="care-sheet__actions" aria-label="照料方式">
        <button type="button" onClick={onFeed}>
          <CareActionMark kind="feed" />
          <span>喂点心</span>
        </button>
        <button type="button" onClick={onPlay}>
          <CareActionMark kind="play" />
          <span>玩一会</span>
        </button>
        <button type="button" onClick={onRest}>
          <CareActionMark kind="rest" />
          <span>一起休息</span>
        </button>
      </div>

      <p className="care-sheet__feedback" aria-live="polite">
        {feedback ?? '不赶时间，选一件现在想做的事。'}
      </p>
    </section>
  );
}

function CareActionMark({ kind }: { kind: 'feed' | 'play' | 'rest' }) {
  if (kind === 'feed') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M7.5 9.5c0-3.2 2.2-5.3 5-5.3 3.7 0 5.4 3.2 4.6 6.5-.8 3.5-3.2 7.4-5.1 7.4s-4.5-4.8-4.5-8.6Z" />
        <path d="M12.2 4.4c.2-1.6 1.1-2.7 2.7-3.2M13.4 4.1c1.6-.7 3-.4 4.2.7" />
      </svg>
    );
  }

  if (kind === 'play') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="10.5" cy="9" r="4.8" />
        <path d="M6.4 6.7c2.9 1 5.4 3.2 7 6.2M7 12.5c1.7-2.6 4.2-4.6 7.1-5.6M14.3 14.8c2.7.2 4.3 1.6 4.8 4.1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M16.9 3.6a8.1 8.1 0 1 0 3.4 12.8 7.4 7.4 0 0 1-3.4-12.8Z" />
      <path d="M6 5.1h.1M4.3 8.1h.1" />
    </svg>
  );
}

function careLevel(value: number, kind: 'satiety' | 'energy') {
  if (kind === 'satiety') {
    if (value >= 90) return { label: '很满足' };
    if (value >= 72) return { label: '刚刚好' };
    if (value >= 58) return { label: '想吃一点' };
    return { label: '留点点心' };
  }

  if (value >= 88) return { label: '精神很好' };
  if (value >= 62) return { label: '有精神' };
  if (value >= 36) return { label: '慢下来' };
  return { label: '想休息' };
}

function careSummary(snapshot: CareSnapshot) {
  const mood = moodLabels[snapshot.mood];
  if (snapshot.energy <= 35) return `${mood}，今天适合慢一点。`;
  if (snapshot.satiety <= 57) return `${mood}，也许想分一点点心。`;
  return `${mood}，现在的状态刚刚好。`;
}
