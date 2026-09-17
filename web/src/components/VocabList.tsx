import { useEffect, useMemo, useState } from 'react';
import { LANGUAGE_NAMES, type LangCode, type VocabEntry } from '@fran/shared';
import { deleteVocab, fetchVocab, makeVocabExample, setVocabLearned } from '../api';
import { useT } from '../i18n';
import Icon from './Icon';
import { useSpeaker, type Speaker } from '../speech';

interface Props {
  onBack: () => void;
}

type Shelf = 'learning' | 'learned';

export default function VocabList({ onBack }: Props) {
  const t = useT();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<LangCode | null>(null);
  const [shelf, setShelf] = useState<Shelf>('learning');
  const speaker = useSpeaker();

  useEffect(() => {
    fetchVocab()
      .then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  /**
   * 담은 언어들. 언어가 섞이면 찾기 어려워서 언어별로 나눠 둔다.
   * 많이 담은 언어를 앞에 둔다 — 열자마자 보고 싶은 건 대개 그쪽이다.
   */
  const langs = useMemo(() => {
    const counts = new Map<LangCode, number>();
    for (const entry of entries ?? []) counts.set(entry.lang, (counts.get(entry.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [entries]);
  const current = lang && langs.includes(lang) ? lang : langs[0];

  const ofLang = (entries ?? []).filter((entry) => entry.lang === current);
  const shown = ofLang.filter((entry) => (shelf === 'learned' ? entry.learned : !entry.learned));

  const replace = (entry: VocabEntry) =>
    setEntries((current) => current?.map((item) => (item.id === entry.id ? entry : item)) ?? null);

  const remove = async (id: string) => {
    setEntries((current) => current?.filter((entry) => entry.id !== id) ?? null);
    await deleteVocab(id).catch(() => undefined);
  };

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
        </button>
        <h1>{t('vocab.title')}</h1>
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

      {entries && entries.length > 0 && (
        <div className="shelves">
          {(['learning', 'learned'] as Shelf[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`shelf ${shelf === item ? 'is-on' : ''}`}
              onClick={() => setShelf(item)}
            >
              {item === 'learned' ? t('vocab.learned') : t('vocab.learning')}
              <span className="shelf__count">
                {ofLang.filter((entry) => (item === 'learned' ? entry.learned : !entry.learned)).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="sheet__error">{error}</p>}
      {entries && entries.length === 0 && <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {t('vocab.empty')}
        </p>}
      {entries && entries.length > 0 && shown.length === 0 && (
        <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {shelf === 'learned' ? t('vocab.emptyLearned') : t('vocab.empty')}
        </p>
      )}

      <ul className="cards">
        {shown.map((entry) => (
          <VocabCard
            key={entry.id}
            entry={entry}
            speaker={speaker}
            onChanged={replace}
            onDelete={() => void remove(entry.id)}
            onError={setError}
          />
        ))}
      </ul>
    </div>
  );
}

interface CardProps {
  entry: VocabEntry;
  speaker: Speaker;
  onChanged: (entry: VocabEntry) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

function VocabCard({ entry, speaker, onChanged, onDelete, onError }: CardProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  /** 예문은 눌렀을 때만 펼친다. 카드가 길어지면 훑어보기 어렵다. */
  const [open, setOpen] = useState(false);

  const speakButton = (key: string, text: string) =>
    speaker.supported && (
      <button
        type="button"
        className={`bubble__speak ${speaker.speakingKey === key ? 'is-on' : ''}`}
        aria-label={speaker.speakingKey === key ? t('bubble.stop') : t('bubble.listen')}
        onClick={() => speaker.toggle(key, text, entry.lang)}
      >
        <Icon name={speaker.speakingKey === key ? 'stop' : 'play'} size={13} />
      </button>
    );

  const example = async (refresh: boolean) => {
    setOpen(true);
    if (entry.example && !refresh) return;
    setBusy(true);
    try {
      onChanged(await makeVocabExample(entry.id, refresh));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleLearned = async () => {
    try {
      onChanged(await setVocabLearned(entry.id, !entry.learned));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <li className={`card ${entry.learned ? 'card--learned' : ''}`}>
      <p className="card__main">
        <b>{entry.term}</b>
        {entry.reading && <span className="card__reading">{entry.reading}</span>}
        {speakButton(entry.id, entry.term)}
      </p>
      <p className="card__sub">{entry.meaning}</p>
      {entry.note && <p className="card__note">{entry.note}</p>}

      {open && (
        <div className="card__example">
          {busy && <p className="card__note">{t('vocab.exampleLoading')}</p>}
          {entry.example && (
            <>
              <p className="card__main">
                {entry.example}
                {speakButton(`${entry.id}:example`, entry.example)}
              </p>
              {entry.exampleTranslation && <p className="card__sub">{entry.exampleTranslation}</p>}
              <button
                type="button"
                className="card__delete"
                onClick={() => void example(true)}
                disabled={busy}
              >
                {t('vocab.exampleAgain')}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card__foot">
        <button
          type="button"
          className={`card__learn ${entry.learned ? 'is-on' : ''}`}
          onClick={() => void toggleLearned()}
          title={entry.learned ? t('vocab.markLearning') : t('vocab.markLearned')}
        >
          {entry.learned && <Icon name="check" size={14} />}
          {entry.learned ? t('vocab.learned') : t('vocab.markLearned')}
        </button>

        <div className="card__tools">
          {!open && (
            <button type="button" className="card__delete" onClick={() => void example(false)}>
              {t('vocab.example')}
            </button>
          )}
          <button type="button" className="card__delete" onClick={onDelete}>
            {t('vocab.delete')}
          </button>
        </div>
      </div>
    </li>
  );
}
