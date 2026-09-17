import { useState } from 'react';
import { useLongPress } from '../useLongPress';
import { useT, type StringKey } from '../i18n';
import { LANGUAGE_NAMES, messageText, type ChatMessage, type LangCode } from '@fran/shared';
import { attachmentUrl, formatDuration } from '../media';

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

  // 음성 메시지에는 사람이 타이핑한 글이 없다. 받아쓴 글이 원문 노릇을 한다.
  const own = messageText(message);
  const audio = message.attachment?.kind === 'audio' ? message.attachment : undefined;

  const isSourceLanguage = message.sourceLang === primaryLang;
  const primary = message.translations[primaryLang];
  const headline = isSourceLanguage ? own : primary?.text;
  // 받아쓴 글은 늘 보여준다. 뭐라고 말했는지가 이 앱에서 가장 배울 거리가 많은 부분이다.
  const showSource = !isSourceLanguage && (alwaysShowSource || expanded || Boolean(audio));

  const extras = extraLangs
    .filter((lang) => lang !== primaryLang && lang !== message.sourceLang)
    .map((lang) => message.translations[lang])
    .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation));

  const notes = expanded ? (primary?.notes ?? []) : [];

  // 내가 보낸 말이 상대에게 어떻게 도착했는지.
  // 기본은 펼침이고, 말풍선을 누르면 접힌다. 한 번 접은 건 그 말풍선만 접힌 채로 둔다.
  const sentAs = mine && peerLang !== message.sourceLang ? message.translations[peerLang] : undefined;
  const [sentAsHidden, setSentAsHidden] = useState(false);

  // 원문 읽어주기는 상대가 보낸 말에만 띄운다. 내가 쓴 내 말을 다시 들을 일은
  // 없고, 발음이 궁금한 건 늘 상대 쪽 언어다. (내 말은 아래 "이렇게 갔어요"
  // 쪽에서 상대 언어로 들을 수 있다.)
  const sourceKey = `${message.id}:source`;
  const sentAsKey = `${message.id}:sentAs`;
  const canHearSource = speechSupported && !mine && Boolean(own);

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
          // 내 말풍선을 누르면 상대에게 간 번역을 접었다 편다. 받은 말풍선은 원문을 보여준다.
          if (sentAs) setSentAsHidden((value) => !value);
          else setExpanded((value) => !value);
        }}
      >
        {message.attachment?.kind === 'image' && (
          <a
            className="bubble__photo"
            href={attachmentUrl(message.attachment.id)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={attachmentUrl(message.attachment.id)}
              alt={t('bubble.photo')}
              loading="lazy"
              width={message.attachment.width}
              height={message.attachment.height}
            />
          </a>
        )}

        {message.attachment?.kind === 'audio' && (
          <audio
            className="bubble__audio"
            src={attachmentUrl(message.attachment.id)}
            controls
            preload="none"
            onClick={(event) => event.stopPropagation()}
          />
        )}

        {message.attachment?.kind === 'audio' && message.attachment.durationMs && (
          <span className="bubble__audioTime">
            {t('bubble.voice')} · {formatDuration(message.attachment.durationMs)}
          </span>
        )}

        {headline ? (
          <p className="bubble__text">{headline}</p>
        ) : message.translationStatus === 'failed' ? (
          <p className="bubble__text bubble__text--muted">{own}</p>
        ) : own ? (
          <p className="bubble__text bubble__text--pending">{t('bubble.translating')}</p>
        ) : null}

        {sentAs && (
          <div className="bubble__sentAs">
            <button
              type="button"
              className="bubble__sentAsLabel"
              aria-expanded={!sentAsHidden}
              onClick={(event) => {
                event.stopPropagation();
                setSentAsHidden((value) => !value);
              }}
            >
              {t('bubble.sentAs', { name: peerName })}
              <span aria-hidden="true">{sentAsHidden ? ' ▾' : ' ▴'}</span>
            </button>
            {!sentAsHidden && (
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

        {audio?.transcriptStatus === 'pending' && (
          <p className="bubble__text bubble__text--pending">{t('bubble.transcribing')}</p>
        )}
        {audio?.transcriptStatus === 'failed' && !own && (
          <p className="bubble__transcriptFailed">
            {t('bubble.transcribeFailed')}
            <button type="button" className="bubble__retry" onClick={() => onRetranslate(message.id)}>
              {t('bubble.retry')}
            </button>
          </p>
        )}

        {showSource && own && (
          <p className="bubble__source">
            <span className="bubble__lang">
              {audio ? t('bubble.transcript') : LANGUAGE_NAMES[message.sourceLang]}
            </span>
            {own}
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
        {canHearSource && speaker(sourceKey, own, message.sourceLang)}
        <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
      </div>
    </li>
  );
}
