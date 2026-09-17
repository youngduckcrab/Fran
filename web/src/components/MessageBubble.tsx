import { useState } from 'react';
import { useBubbleGestures } from '../useBubbleGestures';
import Icon from './Icon';
import { useT, type StringKey } from '../i18n';
import {
  LANGUAGE_NAMES,
  messageText,
  type ChatMessage,
  type LangCode,
} from '@fran/shared';
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
  /** 오른쪽으로 밀었을 때. 이 메시지에 답장한다. */
  onReply: (message: ChatMessage) => void;
  /** 이 메시지가 답하고 있는 원래 메시지. 없으면 인용 줄을 그리지 않는다. */
  repliedTo?: ChatMessage;
  /** 나 자신의 id. 내 반응인지 구분한다. */
  myId: string;
  /** 상대가 이 메시지를 읽었는지. 내가 보낸 것에만 쓴다. */
  readByPeer: boolean;
  /** 사진을 눌렀을 때. 크게 보는 창은 부모가 띄운다. */
  onOpenPhoto: (attachmentId: string) => void;
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
  onReply,
  repliedTo,
  myId,
  readByPeer,
  onOpenPhoto,
  onRetranslate,
}: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { handlers, consumeClick, offset, armed } = useBubbleGestures(
    () => onLongPress(message),
    () => onReply(message),
  );

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
  const primaryKey = `${message.id}:primary`;
  const canHearSource = speechSupported && !mine && Boolean(own);

  /**
   * 소리 버튼. 줄마다 하나씩 붙어서, 그 줄에 적힌 말을 읽는다.
   * 무엇을 읽는지(원문인지 번역인지)를 설명에 적어 둔다 — 버튼이 둘 다 같게 생겼기 때문이다.
   */
  const speaker = (key: string, text: string, lang: LangCode, what: 'source' | 'translation') => {
    const label = speakingKey === key
      ? t('bubble.stop')
      : what === 'source'
        ? t('bubble.listenSource')
        : t('bubble.listenTranslation');
    return (
      <button
        type="button"
        className={`bubble__speak ${speakingKey === key ? 'is-on' : ''}`}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          onSpeak(key, text, lang);
        }}
      >
        <Icon name={speakingKey === key ? 'stop' : 'play'} size={13} />
      </button>
    );
  };

  return (
    <li className={`bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}`}>
      {repliedTo && (
        <p className="bubble__reply">
          <span className="bubble__replyBar" aria-hidden="true" />
          <span className="bubble__replyText">
            {messageText(repliedTo) ||
              (repliedTo.attachment?.kind === 'image' ? t('reply.photo') : t('reply.voice'))}
          </span>
        </p>
      )}

      <div
        className="bubble__body"
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        data-armed={armed ? 'yes' : undefined}
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
          <button
            type="button"
            className="bubble__photo"
            // 새 창을 여는 링크였는데, 홈 화면에 설치한 앱에서는 그게 열리지 않고
            // 앱이 처음 화면으로 돌아가 버렸다. 앱을 떠나지 않고 크게 보여준다.
            onClick={(event) => {
              event.stopPropagation();
              if (message.attachment) onOpenPhoto(message.attachment.id);
            }}
          >
            <img
              src={attachmentUrl(message.attachment.id)}
              alt={t('bubble.photo')}
              loading="lazy"
              width={message.attachment.width}
              height={message.attachment.height}
            />
          </button>
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
          <p className="bubble__text">
            {headline}
            {/* 크게 보이는 줄이 번역문일 때. 내 언어로 어떻게 들리는지도 들어볼 수 있다. */}
            {speechSupported && !isSourceLanguage && speaker(primaryKey, headline, primaryLang, 'translation')}
          </p>
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
                {speechSupported && speaker(sentAsKey, sentAs.text, peerLang, 'translation')}
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
            {canHearSource && speaker(sourceKey, own, message.sourceLang, 'source')}
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
          <Icon name="pencil" size={13} /> {message.translationNote}
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

      {message.reactions && Object.keys(message.reactions).length > 0 && (
        <div className="bubble__reactions">
          {Object.entries(message.reactions).map(([userId, emoji]) => (
            <span key={userId} className={`reaction ${userId === myId ? 'reaction--mine' : ''}`}>
              {emoji}
            </span>
          ))}
        </div>
      )}

      <div className="bubble__meta">
        {/* 원문 줄이 접혀 있을 때만. 펼치면 그 줄에 붙은 버튼이 같은 일을 한다. */}
        {canHearSource && !showSource && speaker(sourceKey, own, message.sourceLang, 'source')}
        <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
        {/* 내가 보낸 것에만. 체크 하나는 보냈다, 둘은 상대가 읽었다. */}
        {mine && (
          <span
            className={`bubble__read ${readByPeer ? 'is-on' : ''}`}
            title={readByPeer ? t('bubble.read') : t('bubble.sent')}
            aria-label={readByPeer ? t('bubble.read') : t('bubble.sent')}
          >
            <Icon name={readByPeer ? 'checks' : 'check'} size={14} />
          </span>
        )}
      </div>
    </li>
  );
}
