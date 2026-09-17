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
  /** 상대가 읽는 언어. 내가 보낸 메시지가 상대에게 어떻게 갔는지 보여주는 데 쓴다. */
  peerLang: LangCode;
  /** 상대 이름. 위 안내에 쓴다. */
  peerName: string;
  /** "상대에게 어떻게 갔나"를 펼쳐 둘지. 사람마다 한 번 정하면 전부에 적용된다. */
  showSentAs: boolean;
  onToggleSentAs: () => void;
  alwaysShowSource: boolean;
  /** 읽어주기. 브라우저가 못 하면 버튼을 띄우지 않는다. */
  speechSupported: boolean;
  speakingKey: string | null;
  failedSpeechKey: string | null;
  onSpeak: (key: string, text: string, lang: LangCode) => void;
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
  peerLang,
  peerName,
  showSentAs,
  onToggleSentAs,
  alwaysShowSource,
  speechSupported,
  speakingKey,
  failedSpeechKey,
  onSpeak,
  onLongPress,
  onRetranslate,
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

  // 내가 보낸 말이 상대에게 어떻게 도착했는지. 번역기를 쓰는 사람에게는 이게 가장
  // 궁금한 부분이고, 서로의 언어를 배우려는 앱이라면 늘 보여야 한다.
  const sentAs = mine && peerLang !== message.sourceLang ? message.translations[peerLang] : undefined;

  // 원문 읽어주기는 상대가 보낸 말에만 띄운다. 내가 쓴 내 말을 다시 들을 일은
  // 없고, 발음이 궁금한 건 늘 상대 쪽 언어다. (내 말은 아래 "이렇게 갔어요"
  // 쪽에서 상대 언어로 들을 수 있다.)
  const sourceKey = `${message.id}:source`;
  const sentAsKey = `${message.id}:sentAs`;
  const canHearSource = speechSupported && !mine;

  const speaker = (key: string, text: string, lang: LangCode) => (
    <button
      type="button"
      className={`bubble__speak ${speakingKey === key ? 'is-on' : ''}`}
      aria-label={speakingKey === key ? t('bubble.stop') : t('bubble.listen')}
      title={speakingKey === key ? t('bubble.stop') : t('bubble.listen')}
      onClick={(event) => {
        event.stopPropagation();
        onSpeak(key, text, lang);
      }}
    >
      {speakingKey === key ? '■' : '▶'}
    </button>
  );

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

        {sentAs && (
          <div className="bubble__sentAs">
            <button
              type="button"
              className="bubble__sentAsLabel"
              aria-expanded={showSentAs}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSentAs();
              }}
            >
              {t('bubble.sentAs', { name: peerName })}
              <span aria-hidden="true">{showSentAs ? ' ▴' : ' ▾'}</span>
            </button>
            {showSentAs && (
              <p className="bubble__sentAsText">
                {sentAs.text}
                {speechSupported && speaker(sentAsKey, sentAs.text, peerLang)}
              </p>
            )}
            {failedSpeechKey === sentAsKey && (
              <p className="bubble__noVoice">{t('bubble.noVoice', { lang: LANGUAGE_NAMES[peerLang] })}</p>
            )}
          </div>
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

      {canHearSource && failedSpeechKey === sourceKey && (
        <p className="bubble__noVoice">
          {t('bubble.noVoice', { lang: LANGUAGE_NAMES[message.sourceLang] })}
        </p>
      )}

      <div className="bubble__meta">
        {canHearSource && speaker(sourceKey, message.sourceText, message.sourceLang)}
        <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
      </div>
    </li>
  );
}
