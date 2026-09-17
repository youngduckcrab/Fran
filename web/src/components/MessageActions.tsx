import { REACTIONS } from '@fran/shared';
import { useT } from '../i18n';

interface Props {
  /** 실패한 메시지에만 재번역을 띄운다. */
  canRetranslate: boolean;
  /** 이미 저장한 문장이면 다시 저장하지 않는다. */
  alreadySaved: boolean;
  /** 내가 이미 단 반응. 다시 누르면 지운다. */
  myReaction: string | null;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onExplain: () => void;
  onSave: () => void;
  onCopy: () => void;
  onRetranslate: () => void;
  onClose: () => void;
}

/** 말풍선을 길게 눌렀을 때 뜨는 메뉴. */
export default function MessageActions({
  canRetranslate,
  alreadySaved,
  myReaction,
  onReact,
  onReply,
  onExplain,
  onSave,
  onCopy,
  onRetranslate,
  onClose,
}: Props) {
  const t = useT();
  return (
    <div className="sheet" role="dialog" aria-label={t('actions.title')} onClick={onClose}>
      <div className="sheet__panel actions" onClick={(event) => event.stopPropagation()}>
        {/* 한 줄로 늘어놓아 고르는 데 손가락 한 번이면 되게. */}
        <div className="reactions">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`reactions__item ${myReaction === emoji ? 'is-on' : ''}`}
              onClick={() => onReact(myReaction === emoji ? null : emoji)}
              aria-label={`${t('actions.react')} ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <button type="button" className="actions__item" onClick={onReply}>
          <b>{t('actions.reply')}</b>
        </button>
        <button type="button" className="actions__item" onClick={onExplain}>
          <b>{t('actions.explain')}</b>
          <span>{t('actions.explainHint')}</span>
        </button>
        <button type="button" className="actions__item" onClick={onSave} disabled={alreadySaved}>
          <b>{alreadySaved ? t('actions.saved') : t('actions.save')}</b>
          <span>{t('actions.saveHint')}</span>
        </button>
        <button type="button" className="actions__item" onClick={onCopy}>
          <b>{t('actions.copy')}</b>
        </button>
        {canRetranslate && (
          <button type="button" className="actions__item" onClick={onRetranslate}>
            <b>{t('actions.retranslate')}</b>
          </button>
        )}
        <button type="button" className="actions__item actions__cancel" onClick={onClose}>
          {t('actions.close')}
        </button>
      </div>
    </div>
  );
}
