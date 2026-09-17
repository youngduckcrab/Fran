import { useEffect, useMemo, useState } from 'react';
import { LANGUAGE_NAMES, type LangCode, type SavedSentence } from '@fran/shared';
import { deleteSaved, fetchSaved } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';
import { useSpeaker } from '../speech';

interface Props {
  onBack: () => void;
}

/** 나중에 다시 보려고 저장해 둔 문장들. */
export default function SavedList({ onBack }: Props) {
  const t = useT();
  const [items, setItems] = useState<SavedSentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<LangCode | null>(null);
  const speaker = useSpeaker();

  useEffect(() => {
    fetchSaved()
      .then((result) => setItems(result.items))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  /**
   * 담은 언어들. 많이 담은 언어를 앞에 둔다 — 열자마자 보고 싶은 건 대개 그쪽이다.
   * 언어가 하나뿐이면 고르는 줄을 띄우지 않는다.
   */
  const langs = useMemo(() => {
    const counts = new Map<LangCode, number>();
    for (const item of items ?? []) counts.set(item.lang, (counts.get(item.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [items]);
  const current = lang && langs.includes(lang) ? lang : langs[0];
  const shown = (items ?? []).filter((item) => item.lang === current);

  const remove = async (id: string) => {
    setItems((current) => current?.filter((item) => item.id !== id) ?? null);
    await deleteSaved(id).catch(() => undefined);
  };

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
        </button>
        <h1>{t('saved.title')}</h1>
      </header>

      {langs.length > 1 && (
        <div className="chips">
          {langs.map((item) => (
            <button
              key={item}
              type="button"
              className={`chip ${current === item ? 'is-on' : ''}`}
              onClick={() => setLang(item)}
            >
              {LANGUAGE_NAMES[item]}
            </button>
          ))}
        </div>
      )}

      {error && <p className="sheet__error">{error}</p>}
      {items && items.length === 0 && <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {t('saved.empty')}
        </p>}

      <ul className="cards">
        {shown.map((item) => (
          <li key={item.id} className="card">
            <p className="card__main">
              {item.text}
              {speaker.supported && (
                <button
                  type="button"
                  className={`bubble__speak ${speaker.speakingKey === item.id ? 'is-on' : ''}`}
                  aria-label={speaker.speakingKey === item.id ? t('bubble.stop') : t('bubble.listen')}
                  onClick={() => speaker.toggle(item.id, item.text, item.lang)}
                >
                  <Icon name={speaker.speakingKey === item.id ? 'stop' : 'play'} size={13} />
                </button>
              )}
            </p>
            {item.pairText && <p className="card__sub">{item.pairText}</p>}
            <div className="card__foot">
              <span className="card__tag">{new Date(item.createdAt).toLocaleDateString()}</span>
              <button type="button" className="card__delete" onClick={() => void remove(item.id)}>
                {t('saved.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
