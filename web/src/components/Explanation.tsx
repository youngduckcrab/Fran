import { useCallback, useEffect, useState } from 'react';
import {
  LANGUAGE_NAMES,
  type ChatMessage,
  type LangCode,
  type MessageExplanation,
} from '@fran/shared';
import { explainMessage } from '../api';

interface Props {
  message: ChatMessage;
  /** 처음 열었을 때 설명할 언어. */
  initialLang: LangCode;
  onClose: () => void;
}

/** 이 메시지에 대해 설명을 받아볼 수 있는 문장들(원문 + 번역된 것들). */
function availableLangs(message: ChatMessage): LangCode[] {
  const langs = Object.keys(message.translations).filter((lang): lang is LangCode =>
    Boolean(message.translations[lang as LangCode]),
  );
  return [message.sourceLang, ...langs];
}

export default function Explanation({ message, initialLang, onClose }: Props) {
  const langs = availableLangs(message);
  const [lang, setLang] = useState<LangCode>(langs.includes(initialLang) ? initialLang : message.sourceLang);
  const [explanation, setExplanation] = useState<MessageExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target: LangCode) => {
    setBusy(true);
    setError(null);
    setExplanation(null);
    try {
      setExplanation(await explainMessage(message.id, target));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [message.id]);

  useEffect(() => {
    void load(lang);
  }, [lang, load]);

  const sentence =
    lang === message.sourceLang ? message.sourceText : message.translations[lang]?.text ?? '';

  return (
    <div className="sheet" role="dialog" aria-label="문장 설명">
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>설명</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        {langs.length > 1 && (
          <div className="chips explain__langs">
            {langs.map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${lang === item ? 'is-on' : ''}`}
                onClick={() => setLang(item)}
              >
                {LANGUAGE_NAMES[item]}
              </button>
            ))}
          </div>
        )}

        <p className="explain__sentence">{sentence}</p>

        {busy && <p className="explain__loading">읽어보는 중…</p>}
        {error && <p className="sheet__error">{error}</p>}

        {explanation && (
          <>
            <p className="explain__summary">{explanation.summary}</p>

            {explanation.chunks.length > 0 && (
              <ol className="explain__chunks">
                {explanation.chunks.map((chunk, index) => (
                  <li key={`${chunk.text}-${index}`}>
                    <p className="explain__chunkText">
                      {chunk.text}
                      {chunk.reading && <span className="explain__reading">{chunk.reading}</span>}
                    </p>
                    <p className="explain__meaning">{chunk.meaning}</p>
                    {chunk.note && <p className="explain__note">{chunk.note}</p>}
                  </li>
                ))}
              </ol>
            )}

            {explanation.points.length > 0 && (
              <section className="sheet__section">
                <h3>짚고 갈 점</h3>
                <ul className="explain__points">
                  {explanation.points.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.replies.length > 0 && (
              <section className="sheet__section">
                <h3>이렇게 답할 수 있어요</h3>
                <ul className="explain__replies">
                  {explanation.replies.map((reply, index) => (
                    <li key={index}>{reply}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
