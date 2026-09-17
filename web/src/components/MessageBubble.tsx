import { useState } from 'react';
import { useLongPress } from '../useLongPress';
import { useT, type StringKey } from '../i18n';
import { LANGUAGE_NAMES, type ChatMessage, type LangCode } from '@fran/shared';

interface Props {
  message: ChatMessage;
  mine: boolean;
  /** 내가 주로 읽는 언어. 이 언어의 번역이 크게 보인다. */
  primaryLang: LangCode;
  /** 곁들여 보고 싶은 학습 언어들. */
  extraLangs: LangCode[];
  alwaysShowSource: boolean;
  onRetranslate: (messageId: string, translationNote?: string) => void;
  /** 길게 눌렀을 때. 메뉴는 부모가 띄운다. */
  onLongPress: (message: ChatMessage) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({
  message,
  mine,
  primaryLang,
  extraLangs,
  alwaysShowSource,
  onRetranslate,
  onLongPress,
}: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { handlers, consumeClick } = useLongPress(() => onLongPress(message));

  const isSourceLanguage = message.sourceLang === primaryLang;
  const primary = message.translations[primaryLang];
  const headline = isSourceLanguage ? message.sourceText : primary?.text;
  const showSource = !isSourceLanguage && (alwaysShowSource || expanded);

  const extras = extraLangs
    .filter((lang) => lang !== primaryLang && lang !== message.sourceLang)
    .map((lang) => message.translations[lang])
    .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation));

  const notes = expanded ? (primary?.notes ?? []) : [];

  return (
    <li className={`bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}`}>
      <div
        className="bubble__body"
        {...handlers}
        onClick={() => {
          // 길게 눌러 메뉴를 연 뒤 따라오는 click 은 무시한다.
          if (consumeClick()) return;
          setExpanded((value) => !value);
        }}
      >
        {headline ? (
          <p className="bubble__text">{headline}</p>
        ) : message.translationStatus === 'failed' ? (
          <p className="bubble__text bubble__text--muted">{message.sourceText}</p>
        ) : (
          <p className="bubble__text bubble__text--pending">{t('bubble.translating')}</p>
        )}

        {showSource && (
          <p className="bubble__source">
            <span className="bubble__lang">{LANGUAGE_NAMES[message.sourceLang]}</span>
            {message.sourceText}
          </p>
        )}

        {expanded &&
          extras.map((translation) => (
            <p className="bubble__source" key={translation.lang}>
              <span className="bubble__lang">{LANGUAGE_NAMES[translation.lang]}</span>
              {translation.text}
            </p>
          ))}

        {notes.length > 0 && (
          <ul className="bubble__notes">
            {notes.map((note) => (
              <li key={note.term}>
                <b>{note.term}</b> — {note.meaning}
              </li>
            ))}
          </ul>
        )}
      </div>

      {mine && message.translationNote && (
        <p className="bubble__note" title={t('bubble.onlyYou')}>
          ✎ {message.translationNote}
        </p>
      )}

      {message.translationStatus === 'failed' && (
        <p className="bubble__failure">
          {message.translationErrorCode
            ? t(`error.${message.translationErrorCode}` as StringKey)
            : (message.translationError ?? t('bubble.failed'))}
          <button type="button" className="bubble__retry" onClick={() => onRetranslate(message.id)}>
            {t('bubble.retry')}
          </button>
        </p>
      )}

      <div className="bubble__meta">
        <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
      </div>
    </li>
  );
}
