import { useMemo, useState } from 'react';
import {
  LANGUAGE_NAMES,
  type LangCode,
  type SavedSentence,
  type VocabEntry,
} from '@fran/shared';
import {
  deleteSaved,
  deleteVocab,
  makeVocabExample,
  saveSentence,
  setVocabLearned,
} from '../api';
import { useT } from '../i18n';
import Icon from './Icon';
import { hasSpeech, useSpeaker, type Speaker } from '../speech';
import { plainText } from '../text';

interface Props {
  entries: VocabEntry[];
  onChanged: (entries: VocabEntry[]) => void;
  /** 한 화면으로 열렸을 때만. 채팅 위에 얹힐 때는 머리말이 필요 없다. */
  onBack?: () => void;
  /** 내가 읽는 언어. 예문을 보관할 때 뜻을 함께 남기는 데 쓴다. */
  primaryLang: LangCode;
  /** 이미 보관함에 있는 문장들. `<언어>:<다듬은 문장>` → 저장 항목 id. */
  savedTexts: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
}

type Shelf = 'learning' | 'learned';

export default function VocabList({
  entries,
  onChanged,
  onBack,
  primaryLang,
  savedTexts,
  onSaved,
  onUnsaved,
}: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<LangCode | null>(null);
  const [shelf, setShelf] = useState<Shelf>('learning');
  const speaker = useSpeaker();

  /**
   * 담은 언어들. 언어가 섞이면 찾기 어려워서 언어별로 나눠 둔다.
   * 많이 담은 언어를 앞에 둔다 — 열자마자 보고 싶은 건 대개 그쪽이다.
   */
  const langs = useMemo(() => {
    const counts = new Map<LangCode, number>();
    for (const entry of entries) counts.set(entry.lang, (counts.get(entry.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [entries]);
  const current = lang && langs.includes(lang) ? lang : langs[0];

  const ofLang = entries.filter((entry) => entry.lang === current);
  const shown = ofLang.filter((entry) => (shelf === 'learned' ? entry.learned : !entry.learned));

  const replace = (entry: VocabEntry) =>
    onChanged(entries.map((item) => (item.id === entry.id ? entry : item)));

  const remove = async (id: string) => {
    onChanged(entries.filter((entry) => entry.id !== id));
    await deleteVocab(id).catch(() => undefined);
  };

  const body = (
    <>
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

      {entries.length > 0 && (
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
      {entries.length === 0 && <p className="page__empty">
          <Icon name="sparkle" size={34} className="page__emptyIcon" />
          {t('vocab.empty')}
        </p>}
      {entries.length > 0 && shown.length === 0 && (
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
            primaryLang={primaryLang}
            savedTexts={savedTexts}
            onSaved={onSaved}
            onUnsaved={onUnsaved}
            onChanged={replace}
            onDelete={() => void remove(entry.id)}
            onError={setError}
          />
        ))}
      </ul>
    </>
  );

  if (!onBack) return body;

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
        </button>
        <h1>{t('vocab.title')}</h1>
      </header>
      {body}
    </div>
  );
}

interface CardProps {
  entry: VocabEntry;
  speaker: Speaker;
  primaryLang: LangCode;
  savedTexts: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
  onChanged: (entry: VocabEntry) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

function VocabCard({
  entry,
  speaker,
  primaryLang,
  savedTexts,
  onSaved,
  onUnsaved,
  onChanged,
  onDelete,
  onError,
}: CardProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  /** 예문은 눌렀을 때만 펼친다. 카드가 길어지면 훑어보기 어렵다. */
  const [open, setOpen] = useState(false);
  /** 아무리 물어도 같은 문장만 나올 때. */
  const [duplicate, setDuplicate] = useState(false);

  const speakButton = (key: string, text: string) =>
    speaker.supported &&
    hasSpeech(text) && (
      <button
        type="button"
        className={`bubble__speak ${speaker.speakingKey === key ? 'is-on' : ''}`}
        aria-label={speaker.speakingKey === key ? t('bubble.stop') : t('bubble.listen')}
        onClick={() => speaker.toggle(key, text, entry.lang)}
      >
        <Icon name={speaker.speakingKey === key ? 'stop' : 'play'} size={13} />
      </button>
    );

  /** 예문을 하나 더. 이미 있는 것은 그대로 두고 아래에 쌓는다. */
  const addExample = async () => {
    setOpen(true);
    setBusy(true);
    setDuplicate(false);
    try {
      const result = await makeVocabExample(entry.id);
      onChanged(result.entry);
      setDuplicate(Boolean(result.duplicate));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** 예문을 보관함에 담거나 뺀다. 다시 누르면 취소된다. */
  const toggleSaved = async (sentence: string, translation: string) => {
    const key = `${entry.lang}:${plainText(sentence)}`;
    const existing = savedTexts.get(key);
    try {
      if (existing) {
        await deleteSaved(existing);
        onUnsaved(existing);
        return;
      }
      onSaved(
        await saveSentence({
          lang: entry.lang,
          text: sentence,
          vocabTerm: entry.term,
          // 예문의 뜻은 내가 읽는 언어로 온다. 짝으로 함께 보관한다.
          ...(translation ? { pairLang: primaryLang, pairText: translation } : {}),
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
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
          <ol className="examples">
            {entry.examples.map((example, index) => {
              const saved = savedTexts.has(`${entry.lang}:${plainText(example.sentence)}`);
              return (
                <li key={`${example.createdAt}-${index}`}>
                  <p className="card__main">
                    {example.sentence}
                    {speakButton(`${entry.id}:example:${index}`, example.sentence)}
                    {/* 마음에 드는 예문은 보관함으로. 다시 누르면 빠진다. */}
                    <button
                      type="button"
                      className={`example__save ${saved ? 'is-on' : ''}`}
                      title={saved ? t('save.remove') : t('actions.save')}
                      aria-label={saved ? t('save.remove') : t('actions.save')}
                      onClick={() => void toggleSaved(example.sentence, example.translation)}
                    >
                      <Icon name={saved ? 'check' : 'bookmark'} size={14} />
                    </button>
                  </p>
                  {example.translation && <p className="card__sub">{example.translation}</p>}
                </li>
              );
            })}
          </ol>

          {busy && <p className="card__note">{t('vocab.exampleLoading')}</p>}
          {duplicate && <p className="card__note">{t('vocab.exampleDuplicate')}</p>}

          <button type="button" className="card__delete" onClick={() => void addExample()} disabled={busy}>
            {t('vocab.exampleAgain')}
          </button>
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
            <button
              type="button"
              className="card__delete"
              onClick={() => (entry.examples.length > 0 ? setOpen(true) : void addExample())}
            >
              {entry.examples.length > 0
                ? t('vocab.exampleCount', { count: String(entry.examples.length) })
                : t('vocab.example')}
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
