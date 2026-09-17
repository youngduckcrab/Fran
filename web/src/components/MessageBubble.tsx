import { useState } from 'react';
import { LANGUAGE_NAMES, type ChatMessage, type LangCode } from '@fran/shared';

interface Props {
  message: ChatMessage;
  mine: boolean;
  /** 내가 주로 읽는 언어. 이 언어의 번역이 크게 보인다. */
  primaryLang: LangCode;
  /** 곁들여 보고 싶은 학습 언어들. */
  extraLangs: LangCode[];
  alwaysShowSource: boolean;
  onRetranslate: (messageId: string) => void;
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
}: Props) {
  const [expanded, setExpanded] = useState(false);

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
      <div className="bubble__body" onClick={() => setExpanded((value) => !value)}>
        {headline ? (
          <p className="bubble__text">{headline}</p>
        ) : message.translationStatus === 'failed' ? (
          <p className="bubble__text bubble__text--muted">{message.sourceText}</p>
        ) : (
          <p className="bubble__text bubble__text--pending">번역하는 중…</p>
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

      <div className="bubble__meta">
        <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
        {message.translationStatus === 'failed' && (
          <button
            type="button"
            className="bubble__retry"
            onClick={() => onRetranslate(message.id)}
          >
            번역 실패 · 다시 시도
          </button>
        )}
      </div>
    </li>
  );
}
