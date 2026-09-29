import { useEffect, useRef, useState } from 'react';
import { messageText, type ChatMessage, type LangCode } from '@fran/shared';
import { useT } from '../i18n';
import Icon from './Icon';

interface Props {
  /** 대화 전체. 여기서 최근 몇 줄만 꺼내 쓴다. */
  messages: ChatMessage[];
  myId: string;
  /** 내가 읽는 말. 상대 글은 이 말로 옮긴 것을 보여 준다. */
  readingLang: LangCode;
  onSend: (text: string) => void;
  /** 글 칸이 열려 있는지. 단추는 통화 화면의 단추 줄에 있어서 밖에서 쥔다. */
  open: boolean;
  onClose: () => void;
}

/** 통화 화면에 띄워 두는 줄 수. 얼굴을 너무 가리지 않을 만큼만. */
const KEEP = 4;

/**
 * 통화 중에 치는 글.
 *
 * 따로 저장하지 않는다. 평소 채팅 길을 그대로 타서 번역되고 대화에도 남는다 —
 * 통화 중에 주고받은 주소나 이름을 나중에 못 찾으면 소용이 없다.
 */
export default function CallChat({ messages, myId, readingLang, onSend, open, onClose }: Props) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  /** 통화 중에 오간 것만. 열기 전의 옛 대화까지 얼굴 위에 띄울 이유는 없다. */
  const since = useRef(Date.now());
  const shown = messages.filter((message) => message.createdAt >= since.current).slice(-KEEP);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <>
      {shown.length > 0 && (
        <div className="callChat__list" aria-live="polite">
          {shown.map((message) => {
            const mine = message.senderId === myId;
            const own = messageText(message);
            // 상대 글은 내가 읽는 말로. 내 글은 상대에게 어떻게 갔는지 굳이 띄우지 않는다.
            const shownText = mine ? own : (message.translations[readingLang]?.text ?? own);
            return (
              <p key={message.id} className={`callChat__line ${mine ? 'is-mine' : ''}`}>
                {shownText}
                {!mine && !message.translations[readingLang] && (
                  <span className="callChat__waiting"> {t('bubble.translating')}</span>
                )}
              </p>
            );
          })}
        </div>
      )}

      {open ? (
        <form
          className="callChat__form"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <input
            ref={input}
            className="callChat__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('callChat.placeholder')}
            enterKeyHint="send"
          />
          <button type="submit" className="callChat__send" aria-label={t('callChat.send')}>
            <Icon name="send" size={18} />
          </button>
          <button
            type="button"
            className="callChat__close"
            onClick={onClose}
            aria-label={t('callChat.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </form>
      ) : null}
    </>
  );
}
