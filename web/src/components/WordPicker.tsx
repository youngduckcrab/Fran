import { useMemo, useState } from 'react';
import {
  LANGUAGE_NAMES,
  cleanTerm,
  messageText,
  type ChatMessage,
  type LangCode,
  type WordLookup,
} from '@fran/shared';
import { lookUpWord, saveVocab } from '../api';
import { useBackClose } from '../backstack';
import { useT } from '../i18n';
import { useSpeaker } from '../speech';
import { splitWords } from '../words';
import Icon from './Icon';

interface Props {
  message: ChatMessage;
  /** 처음 보여줄 문장의 언어. 공부하는 쪽을 먼저 편다. */
  initialLang: LangCode;
  /** 그것도 없으면 다음으로 볼 언어들. 내가 공부하는 순서대로. */
  extraLangs: LangCode[];
  /** 단어를 담았을 때. 홈의 숫자를 맞추는 데 쓴다. */
  onAdded: () => void;
  onClose: () => void;
}

/** 이 메시지에서 골라 볼 수 있는 문장들(원문 + 번역된 것들). */
function availableLangs(message: ChatMessage): LangCode[] {
  const langs = Object.keys(message.translations).filter((lang): lang is LangCode =>
    Boolean(message.translations[lang as LangCode]),
  );
  return [message.sourceLang, ...langs];
}

/**
 * 문장의 단어를 하나씩 눌러 보는 화면.
 *
 * 모르는 단어가 하나 걸렸을 뿐인데 문장 전체 설명을 기다릴 이유는 없다. 누른 단어만
 * 짧게 풀어 주고, 마음에 들면 그 자리에서 단어장에 담는다.
 */
export default function WordPicker({ message, initialLang, extraLangs, onAdded, onClose }: Props) {
  const t = useT();
  const speaker = useSpeaker();
  const langs = availableLangs(message);
  /*
   * 내가 쓴 글을 눌러 볼 일은 거의 없다. 공부하는 언어로 된 문장이 있으면 그것부터 편다.
   * (내 글이 아직 그 언어로 번역되지 않았으면 결국 원문으로 돌아온다.)
   */
  const [lang, setLang] = useState<LangCode>(
    [initialLang, ...extraLangs].find((item) => langs.includes(item)) ?? message.sourceLang,
  );
  /** 지금 펼쳐 놓은 단어. 누를 때마다 바뀐다. */
  const [picked, setPicked] = useState<string | null>(null);
  const [lookup, setLookup] = useState<WordLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 이 화면에서 담은 단어들. 담긴 걸 바로 알아볼 수 있게. */
  const [added, setAdded] = useState<Set<string>>(new Set());

  useBackClose(true, onClose);

  const sentence =
    lang === message.sourceLang ? messageText(message) : (message.translations[lang]?.text ?? '');
  const tokens = useMemo(() => splitWords(sentence, lang), [sentence, lang]);

  const choose = async (word: string) => {
    // 같은 단어를 다시 누르면 접는다.
    if (picked === word) {
      setPicked(null);
      setLookup(null);
      return;
    }
    setPicked(word);
    setLookup(null);
    setError(null);
    setBusy(true);
    try {
      setLookup(await lookUpWord(message.id, lang, word));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** 문장을 바꾸면 펼쳐 둔 단어는 의미가 없다. 같이 접는다. */
  const switchLang = (next: LangCode) => {
    setLang(next);
    setPicked(null);
    setLookup(null);
    setError(null);
  };

  const term = lookup ? cleanTerm(lookup.base) || cleanTerm(lookup.word) : '';
  const isAdded = added.has(`${lang}:${term}`);

  const addToVocab = async () => {
    if (!lookup || !term) return;
    setError(null);
    try {
      await saveVocab({
        term,
        lang,
        meaning: lookup.meaning,
        ...(lookup.reading ? { reading: lookup.reading } : {}),
        // 이 문장에서 어떻게 쓰였는지가 나중에 다시 볼 때 가장 쓸모 있다. 함께 남긴다.
        ...(lookup.inSentence || lookup.note
          ? { note: [lookup.inSentence, lookup.note].filter(Boolean).join(' · ') }
          : {}),
        messageId: message.id,
      });
      setAdded((current) => new Set(current).add(`${lang}:${term}`));
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const speakKey = `word:${lang}:${picked ?? ''}`;

  return (
    <div className="sheet" role="dialog" aria-label={t('pick.title')} onClick={onClose}>
      <div className="sheet__panel" onClick={(event) => event.stopPropagation()}>
        <header className="sheet__header">
          <h2>{t('pick.title')}</h2>
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
                onClick={() => switchLang(item)}
              >
                {LANGUAGE_NAMES[item]}
              </button>
            ))}
          </div>
        )}

        <p className="sheet__hint">{t('pick.hint')}</p>

        {/* 문장 그대로 보이되 단어만 누를 수 있다. 공백과 문장부호는 글자 그대로 둔다. */}
        <p className="pick__sentence">
          {tokens.map((token, index) =>
            token.word ? (
              <button
                key={index}
                type="button"
                className={`pick__word ${picked === token.text ? 'is-on' : ''} ${
                  added.has(`${lang}:${cleanTerm(token.text)}`) ? 'is-added' : ''
                }`}
                onClick={() => void choose(token.text)}
              >
                {token.text}
              </button>
            ) : (
              <span key={index}>{token.text}</span>
            ),
          )}
        </p>

        {busy && <p className="explain__loading">{t('pick.loading')}</p>}
        {error && <p className="sheet__error">{error}</p>}

        {lookup && !busy && (
          <section className="wordcard">
            <p className="card__main">
              <b>{lookup.word}</b>
              {lookup.reading && <span className="card__reading">{lookup.reading}</span>}
              {lookup.pos && <span className="wordcard__pos">{lookup.pos}</span>}
              {speaker.supported && (
                <button
                  type="button"
                  className={`bubble__speak ${speaker.speakingKey === speakKey ? 'is-on' : ''}`}
                  aria-label={speaker.speakingKey === speakKey ? t('bubble.stop') : t('bubble.listen')}
                  onClick={() => speaker.toggle(speakKey, lookup.word, lang)}
                >
                  <Icon name={speaker.speakingKey === speakKey ? 'stop' : 'play'} size={13} />
                </button>
              )}
            </p>

            {/* 사전형이 다를 때만. "fui" 를 찾으려면 "ir" 을 봐야 한다는 걸 알려 준다. */}
            {lookup.base && lookup.base !== lookup.word && (
              <p className="wordcard__base">{t('pick.base', { base: lookup.base })}</p>
            )}

            <p className="card__sub">{lookup.meaning}</p>
            {lookup.inSentence && <p className="wordcard__in">{lookup.inSentence}</p>}
            {lookup.note && <p className="card__note">{lookup.note}</p>}

            <button
              type="button"
              className={`wordcard__add ${isAdded ? 'is-on' : ''}`}
              onClick={() => void addToVocab()}
              disabled={isAdded || !term}
            >
              <Icon name={isAdded ? 'check' : 'plus'} size={15} />
              {isAdded ? t('vocab.added') : t('pick.add', { term })}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
