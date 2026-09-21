import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, UserProfile } from '@fran/shared';
import { searchMessages } from '../api';
import { useBackClose } from '../backstack';
import { useT } from '../i18n';
import { snippetOf } from '../search';
import Icon from './Icon';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  /** 고른 것의 자리로 간다. 누르면 이 창을 닫고 대화로 데려간다. */
  onJump: (messageId: string) => void;
  onClose: () => void;
}

/** 치자마자 찾으러 가면 글자마다 한 번씩 물어보게 된다. 손이 멈추면 간다. */
const SETTLE_MS = 300;

function formatWhen(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * 대화에서 찾기.
 *
 * 원문만 뒤지면 반쪽이다 — 한국어로 친 말을 스페인어로 기억하고 있을 수도 있고,
 * 음성 메시지는 아예 받아쓴 글에만 있다. 서버가 셋을 함께 본다.
 */
export default function Search({ me, peer, onJump, onClose }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useBackClose(true, onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /** 지금 화면에 걸린 말. 결과를 그릴 때는 이걸로 도막을 낸다(입력칸과 따로 움직인다). */
  const [shown, setShown] = useState('');

  useEffect(() => {
    const word = query.trim();
    if (word.length < 2) {
      setResults(null);
      setHasMore(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      searchMessages(word)
        .then((found) => {
          if (cancelled) return;
          setResults(found.messages);
          setHasMore(found.hasMore);
          setShown(word);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const more = async () => {
    const oldest = results?.[results.length - 1]?.createdAt;
    if (oldest === undefined) return;
    setBusy(true);
    try {
      const found = await searchMessages(shown, oldest);
      setResults((previous) => [...(previous ?? []), ...found.messages]);
      setHasMore(found.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (message: ChatMessage) =>
    (message.senderId === me?.id ? me?.name : peer?.name) ?? '';

  return (
    <div className="sheet" role="dialog" aria-label={t('search.title')} onClick={onClose}>
      <div className="sheet__panel search" onClick={(event) => event.stopPropagation()}>
        <header className="sheet__header">
          <h2>{t('search.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <input
          ref={inputRef}
          className="login__input"
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="sheet__hint">{t('search.hint')}</p>

        {error && <p className="sheet__error">{error}</p>}
        {busy && results === null && <p className="explain__loading">{t('search.looking')}</p>}
        {results !== null && results.length === 0 && !busy && (
          <p className="page__empty">
            <Icon name="sparkle" size={34} className="page__emptyIcon" />
            {t('search.none', { query: shown })}
          </p>
        )}

        {results !== null && results.length > 0 && (
          <>
            <ul className="hits">
              {results.map((message) => {
                const piece = snippetOf(message, shown);
                return (
                  <li key={message.id}>
                    <button type="button" className="hit" onClick={() => onJump(message.id)}>
                      <span className="hit__who">
                        {nameOf(message)}
                        <span className="hit__when">{formatWhen(message.createdAt)}</span>
                      </span>
                      <span className="hit__text">
                        {piece?.clipped && '…'}
                        {piece?.before}
                        {piece?.match && <mark>{piece.match}</mark>}
                        {piece?.after}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {hasMore && (
              <button type="button" className="card__delete search__more" onClick={() => void more()} disabled={busy}>
                {busy ? t('search.looking') : t('search.more')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
