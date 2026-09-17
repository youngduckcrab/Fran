import { useEffect, useMemo, useState } from 'react';
import { LANGUAGE_NAMES, type LangCode, type VocabEntry } from '@fran/shared';
import { deleteVocab, fetchVocab } from '../api';
import { useT } from '../i18n';
import { useSpeaker } from '../speech';

interface Props {
  onBack: () => void;
}

export default function VocabList({ onBack }: Props) {
  const t = useT();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LangCode | 'all'>('all');
  const speaker = useSpeaker();

  useEffect(() => {
    fetchVocab()
      .then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  // 언어가 섞이면 찾기 어렵다. 담은 언어가 두 가지 이상일 때만 고르는 줄을 띄운다.
  const langs = useMemo(() => [...new Set((entries ?? []).map((entry) => entry.lang))], [entries]);
  const shown = (entries ?? []).filter((entry) => filter === 'all' || entry.lang === filter);

  const remove = async (id: string) => {
    setEntries((current) => current?.filter((entry) => entry.id !== id) ?? null);
    await deleteVocab(id).catch(() => undefined);
  };

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          ‹
        </button>
        <h1>{t('vocab.title')}</h1>
      </header>

      {langs.length > 1 && (
        <div className="chips">
          <button
            type="button"
            className={`chip ${filter === 'all' ? 'is-on' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('home.items', { count: String(entries?.length ?? 0) })}
          </button>
          {langs.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`chip ${filter === lang ? 'is-on' : ''}`}
              onClick={() => setFilter(lang)}
            >
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      )}

      {error && <p className="sheet__error">{error}</p>}
      {entries && entries.length === 0 && <p className="page__empty">{t('vocab.empty')}</p>}

      <ul className="cards">
        {shown.map((entry) => (
          <li key={entry.id} className="card">
            <p className="card__main">
              <b>{entry.term}</b>
              {entry.reading && <span className="card__reading">{entry.reading}</span>}
              {speaker.supported && (
                <button
                  type="button"
                  className={`bubble__speak ${speaker.speakingKey === entry.id ? 'is-on' : ''}`}
                  aria-label={speaker.speakingKey === entry.id ? t('bubble.stop') : t('bubble.listen')}
                  onClick={() => speaker.toggle(entry.id, entry.term, entry.lang)}
                >
                  {speaker.speakingKey === entry.id ? '■' : '▶'}
                </button>
              )}
            </p>
            <p className="card__sub">{entry.meaning}</p>
            {entry.note && <p className="card__note">{entry.note}</p>}
            <div className="card__foot">
              <span className="card__tag">{LANGUAGE_NAMES[entry.lang]}</span>
              <button type="button" className="card__delete" onClick={() => void remove(entry.id)}>
                {t('vocab.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
