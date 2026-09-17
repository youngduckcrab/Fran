import { useState } from 'react';
import { LANGUAGE_NAMES, messageText, type ChatMessage, type LangCode } from '@fran/shared';
import { saveSentence } from '../api';
import { useBackClose } from '../backstack';
import { useT } from '../i18n';
import Icon from './Icon';

interface Props {
  message: ChatMessage;
  /** 내가 읽는 언어. 저장할 때 뜻으로 함께 붙인다. */
  primaryLang: LangCode;
  /** 이미 저장한 것들. `<메시지 id>:<언어>` */
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
  onClose: () => void;
}

/**
 * 어떤 문장을 저장할지 고르는 창.
 *
 * 한 메시지에는 원문과 번역문이 함께 있다. 스페인어를 공부하는 사람은 스페인어 쪽을,
 * 뜻만 남기고 싶은 사람은 한국어 쪽을 담고 싶다. 앱이 대신 골라 줄 일이 아니라 물어본다.
 */
export default function SaveSheet({ message, primaryLang, savedKeys, onSaved, onClose }: Props) {
  const t = useT();
  const [busy, setBusy] = useState<LangCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBackClose(true, onClose);

  const own = messageText(message);
  const options: Array<{ lang: LangCode; text: string }> = [
    ...(own ? [{ lang: message.sourceLang, text: own }] : []),
    ...Object.values(message.translations)
      .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation))
      .map((translation) => ({ lang: translation.lang, text: translation.text })),
  ];

  const save = async (lang: LangCode, text: string) => {
    setBusy(lang);
    setError(null);
    try {
      // 뜻을 함께 남긴다. 고른 문장이 내 언어면 원문을, 아니면 내 언어 번역을 짝으로.
      const pairLang = lang === primaryLang ? message.sourceLang : primaryLang;
      const pairText = pairLang === message.sourceLang ? own : message.translations[pairLang]?.text;

      await saveSentence({
        messageId: message.id,
        lang,
        text,
        ...(pairText && pairLang !== lang ? { pairLang, pairText } : {}),
      });
      onSaved(`${message.id}:${lang}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('save.title')} onClick={onClose}>
      <div className="sheet__panel" onClick={(event) => event.stopPropagation()}>
        <header className="sheet__header">
          <h2>{t('save.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="sheet__hint">{t('save.hint')}</p>

        {error && <p className="sheet__error">{error}</p>}

        <ul className="saveList">
          {options.map((option) => {
            const saved = savedKeys.has(`${message.id}:${option.lang}`);
            return (
              <li key={option.lang}>
                <button
                  type="button"
                  className={`saveList__item ${saved ? 'is-on' : ''}`}
                  disabled={saved || busy !== null}
                  onClick={() => void save(option.lang, option.text)}
                >
                  <span className="saveList__lang">{LANGUAGE_NAMES[option.lang]}</span>
                  <span className="saveList__text">{option.text}</span>
                  <span className="saveList__mark">
                    {saved ? <Icon name="check" size={18} /> : <Icon name="bookmark" size={18} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="sheet__actions">
          <button type="button" className="sheet__save" onClick={onClose}>
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
