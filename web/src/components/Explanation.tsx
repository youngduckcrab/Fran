import { useCallback, useEffect, useState } from 'react';
import {
  LANGUAGE_NAMES,
  cleanTerm,
  type ChatMessage,
  type ExplanationChunk,
  type LangCode,
  type MessageExplanation,
} from '@fran/shared';
import { explainMessage, saveVocab } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';

interface Props {
  message: ChatMessage;
  /** 처음 열었을 때 설명할 언어. */
  initialLang: LangCode;
  /** 단어를 담았을 때. 홈의 숫자를 맞추는 데 쓴다. */
  onAdded: () => void;
  onClose: () => void;
}

/** 이 메시지에 대해 설명을 받아볼 수 있는 문장들(원문 + 번역된 것들). */
function availableLangs(message: ChatMessage): LangCode[] {
  const langs = Object.keys(message.translations).filter((lang): lang is LangCode =>
    Boolean(message.translations[lang as LangCode]),
  );
  return [message.sourceLang, ...langs];
}

export default function Explanation({ message, initialLang, onAdded, onClose }: Props) {
  const t = useT();
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

  /** 단어장에 담은 조각들. 같은 화면에서 눌렀는지 바로 보이게 표시만 해 둔다. */
  const [added, setAdded] = useState<Set<string>>(new Set());

  const addToVocab = async (chunk: ExplanationChunk) => {
    const term = cleanTerm(chunk.text);
    if (!term) return;
    try {
      await saveVocab({
        term,
        lang,
        meaning: chunk.meaning,
        ...(chunk.reading ? { reading: chunk.reading } : {}),
        ...(chunk.note ? { note: chunk.note } : {}),
        messageId: message.id,
      });
      setAdded((current) => new Set(current).add(term));
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('explain.title')}>
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>{t('explain.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="close" size={16} />
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

        {busy && <p className="explain__loading">{t('explain.loading')}</p>}
        {error && <p className="sheet__error">{error}</p>}

        {explanation && (
          <>
            <p className="explain__summary">{explanation.summary}</p>

            {explanation.chunks.length > 0 && (
              <ol className="explain__chunks">
                {explanation.chunks.map((chunk, index) => (
                  <li key={`${chunk.text}-${index}`}>
                    <div className="explain__chunkHead">
                      <p className="explain__chunkText">
                        {chunk.text}
                        {chunk.reading && <span className="explain__reading">{chunk.reading}</span>}
                      </p>
                      {/* 기호를 뗀 표제어로 담는다. "¿Dormiste" 가 아니라 "Dormiste" 로. */}
                      <button
                        type="button"
                        className={`explain__add ${added.has(cleanTerm(chunk.text)) ? 'is-on' : ''}`}
                        onClick={() => void addToVocab(chunk)}
                        disabled={added.has(cleanTerm(chunk.text)) || !cleanTerm(chunk.text)}
                        aria-label={t('vocab.add')}
                        title={
                          added.has(cleanTerm(chunk.text))
                            ? t('vocab.added')
                            : `${t('vocab.add')}: ${cleanTerm(chunk.text)}`
                        }
                      >
                        {added.has(cleanTerm(chunk.text)) ? '✓' : '+'}
                      </button>
                    </div>
                    <p className="explain__meaning">{chunk.meaning}</p>
                    {chunk.note && <p className="explain__note">{chunk.note}</p>}
                  </li>
                ))}
              </ol>
            )}

            {explanation.points.length > 0 && (
              <section className="sheet__section">
                <h3>{t('explain.points')}</h3>
                <ul className="explain__points">
                  {explanation.points.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.replies.length > 0 && (
              <section className="sheet__section">
                <h3>{t('explain.replies')}</h3>
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
