import { useEffect, useId, useRef } from 'react';
import { PetX } from '@petx/react';
import type { CodexPetManifest } from '@petx/react';
import type { CompanionMemory, MeaningfulInteraction, RelationshipStage } from './model';

const petManifest: CodexPetManifest = {
  id: 'frieren',
  displayName: 'Frieren',
  description: 'A quiet desktop companion.',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
};

const relationshipCopy = {
  new: {
    label: '刚刚认识',
    note: '你们还在小心地了解彼此。',
  },
  familiar: {
    label: '渐渐熟悉',
    note: '她已经开始记得你来过的日子。',
  },
  close: {
    label: '很亲近了',
    note: '安静待在一起，也成了一件自然的事。',
  },
  companion: {
    label: '一直相伴',
    note: '你们已经住进了彼此平常的生活里。',
  },
} satisfies Record<RelationshipStage, { label: string; note: string }>;

export interface MemoryJournalProps {
  nickname: string;
  memories: readonly CompanionMemory[];
  relationshipStage: RelationshipStage;
  onClose: () => void;
}

export function MemoryJournal({
  nickname,
  memories,
  relationshipStage,
  onClose,
}: MemoryJournalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const relationship = relationshipCopy[relationshipStage];
  const visibleMemories = memories.slice(-7);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      className="memory-journal"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className="memory-journal__header">
        <div>
          <p className="memory-journal__eyebrow">我们的小日记</p>
          <h1 className="memory-journal__title" id={titleId}>
            和 {nickname} 一起记住的事
          </h1>
        </div>
        <button
          className="memory-journal__close"
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
        >
          合上日记
        </button>
      </header>

      <div className="memory-journal__book">
        <section
          className="memory-journal__page memory-journal__page--companion"
          aria-labelledby={`${titleId}-relationship`}
        >
          <div className="memory-journal__portrait" aria-hidden="true">
            <PetX
              pet={petManifest}
              manifestUrl="/pets/frieren/pet.json"
              animation="idle"
              size={112}
            />
          </div>
          <h2
            className="memory-journal__companion-name"
            id={`${titleId}-relationship`}
          >
            {nickname}
          </h2>
          <p className="memory-journal__relationship-stage">
            {relationship.label}
          </p>
          <p className="memory-journal__relationship-note">
            {relationship.note}
          </p>
        </section>

        <section
          className="memory-journal__page memory-journal__page--memories"
          aria-labelledby={`${titleId}-memories`}
        >
          <h2 className="memory-journal__page-title" id={`${titleId}-memories`}>
            留在这里的回忆
          </h2>

          {visibleMemories.length > 0 ? (
            <ol
              className="memory-journal__memory-list"
              tabIndex={0}
              aria-label="共同回忆列表"
            >
              {visibleMemories.map((memory) => {
                const copy = memoryCopy(memory);
                return (
                  <li className="memory-journal__memory" key={memory.id}>
                    <time
                      className="memory-journal__memory-date"
                      dateTime={memory.occurredAt}
                    >
                      {formatLocalDate(memory.localDate)}
                    </time>
                    <p className="memory-journal__memory-title">{copy.title}</p>
                    {copy.note ? (
                      <p className="memory-journal__memory-note">{copy.note}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="memory-journal__empty">
              还没有写下第一页。和 {nickname} 打个招呼，故事就会从那里开始。
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

function memoryCopy(memory: CompanionMemory): { title: string; note?: string } {
  switch (memory.kind) {
    case 'first-interaction':
      return {
        title: '我们认识的那一天',
        note: firstInteractionCopy(memory.interaction),
      };
    case 'shared-day':
      return {
        title: '又一起度过了平常的一天',
        note: sharedDayCopy(memory.interaction),
      };
    case 'rename':
      return {
        title: `你开始叫她「${memory.nickname}」`,
        note: `在那之前，她叫「${memory.previousNickname}」。`,
      };
    case 'keepsake':
      return {
        title: `一起收下了「${memory.name}」`,
        ...(memory.note ? { note: memory.note } : {}),
      };
    default: {
      const exhaustiveCheck: never = memory;
      return exhaustiveCheck;
    }
  }
}

function firstInteractionCopy(interaction: MeaningfulInteraction): string {
  switch (interaction) {
    case 'greet':
      return '从一句轻轻的问候开始。';
    case 'pet':
      return '你第一次轻轻摸了摸她。';
    case 'play':
      return '你们第一次一起玩了一会儿。';
    case 'feed':
      return '你第一次和她分享了一份小点心。';
    case 'rest':
      return '你们第一次安静地靠在一起休息。';
    case 'rename':
      return '你给了她一个只属于这里的名字。';
    default: {
      const exhaustiveCheck: never = interaction;
      return exhaustiveCheck;
    }
  }
}

function sharedDayCopy(interaction: MeaningfulInteraction): string {
  switch (interaction) {
    case 'greet':
      return '这一天，从彼此问好开始。';
    case 'pet':
      return '你经过时，停下来陪了她一会儿。';
    case 'play':
      return '你们把一点时间留给了玩耍。';
    case 'feed':
      return '你记得为她留下一份小点心。';
    case 'rest':
      return '你们把这一天的一小段时间留给了安静。';
    case 'rename':
      return '你们又找到了一个更亲近的称呼。';
    default: {
      const exhaustiveCheck: never = interaction;
      return exhaustiveCheck;
    }
  }
}

function formatLocalDate(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}
