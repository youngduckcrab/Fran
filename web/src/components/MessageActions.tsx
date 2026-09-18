import { REACTIONS } from '@fran/shared';
import { useT } from '../i18n';

interface Props {
  /** 실패한 메시지에만 재번역을 띄운다. */
  canRetranslate: boolean;
  /** 글이 있는 메시지에만 단어를 고를 수 있다. 사진만 보낸 것에는 고를 말이 없다. */
  canPickWord: boolean;
  /** 내가 이미 단 반응. 다시 누르면 지운다. */
  myReaction: string | null;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onExplain: () => void;
  onPickWord: () => void;
  onSave: () => void;
  onCopy: () => void;
  onRetranslate: () => void;
  onClose: () => void;
}

/** 말풍선을 길게 눌렀을 때 뜨는 메뉴. */
export default function MessageActions({
  canRetranslate,
  canPickWord,
  myReaction,
  onReact,
  onReply,
  onExplain,
  onPickWord,
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
        {canPickWord && (
          <button type="button" className="actions__item" onClick={onPickWord}>
            <b>{t('actions.pickWord')}</b>
            <span>{t('actions.pickWordHint')}</span>
          </button>
        )}
        <button type="button" className="actions__item" onClick={onSave}>
          <b>{t('actions.save')}</b>
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
