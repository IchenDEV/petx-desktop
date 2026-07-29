import { useId } from 'react';

export interface SpeechBubbleAction {
  id?: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface SpeechBubbleProps {
  speakerName: string;
  text: string;
  primaryActions: readonly SpeechBubbleAction[];
  onDismiss: () => void;
  quietAction?: SpeechBubbleAction;
  onEngagementChange?: (engaged: boolean) => void;
}

export function SpeechBubble({
  speakerName,
  text,
  primaryActions,
  onDismiss,
  quietAction,
  onEngagementChange,
}: SpeechBubbleProps) {
  const messageId = useId();
  const hasResponses = primaryActions.length > 0 || quietAction !== undefined;

  return (
    <section
      className="speech-bubble"
      role="dialog"
      aria-label={`${speakerName} 想和你说句话`}
      aria-describedby={messageId}
      onPointerEnter={() => onEngagementChange?.(true)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) {
          onEngagementChange?.(false);
        }
      }}
      onFocusCapture={() => onEngagementChange?.(true)}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget === null ||
          !event.currentTarget.contains(event.relatedTarget as Node)
        ) {
          onEngagementChange?.(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <div className="speech-bubble__message">
        <p className="speech-bubble__speaker">{speakerName}</p>
        <p className="speech-bubble__text" id={messageId}>
          {text}
        </p>
      </div>

      <div className="speech-bubble__actions" aria-label="回应">
        {primaryActions.map((action, index) => (
          <button
            className="speech-bubble__action speech-bubble__action--primary"
            type="button"
            key={action.id ?? `${action.label}-${index}`}
            onClick={action.onSelect}
            disabled={action.disabled}
            aria-label={action.ariaLabel}
          >
            {action.label}
          </button>
        ))}
        {quietAction ? (
          <button
            className="speech-bubble__action speech-bubble__action--primary speech-bubble__action--quiet"
            type="button"
            onClick={quietAction.onSelect}
            disabled={quietAction.disabled}
            aria-label={quietAction.ariaLabel}
          >
            {quietAction.label}
          </button>
        ) : null}
      </div>

      {!hasResponses ? (
        <div className="speech-bubble__quiet-actions">
        <button
          className="speech-bubble__dismiss"
          type="button"
          onClick={onDismiss}
        >
          收起
        </button>
        </div>
      ) : null}
    </section>
  );
}
