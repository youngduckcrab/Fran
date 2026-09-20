import { useState } from 'react';
import type { LangCode, SavedSentence, UserProfile, VocabEntry } from '@fran/shared';
import type { Photo } from '../api';
import { useBackClose } from '../backstack';
import { useT, type StringKey } from '../i18n';
import Album from './Album';
import Icon from './Icon';
import SavedList from './SavedList';
import VocabList from './VocabList';

type Tab = 'saved' | 'vocab' | 'album';
const TABS: Tab[] = ['saved', 'vocab', 'album'];

interface Props {
  saved: SavedSentence[];
  vocab: VocabEntry[];
  photos: Photo[];
  onSavedChanged: (items: SavedSentence[]) => void;
  onVocabChanged: (entries: VocabEntry[]) => void;
  primaryLang: LangCode;
  savedTexts: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
  me: UserProfile | null;
  peer: UserProfile | null;
  onClose: () => void;
}

/**
 * 대화를 보면서 열어보는 보관함.
 *
 * 말을 쓰다가 "그 단어 뭐였지" 싶을 때 홈까지 돌아갔다 오면 쓰던 말을 잃는다.
 * 채팅 위에 얹어서 보고, 닫으면 쓰던 자리로 돌아온다. 안에 들어가는 목록은
 * 각 화면에서 쓰는 것과 같은 것이다 — 머리말만 빼고 그대로 쓴다.
 */
export default function Library({
  saved,
  vocab,
  photos,
  onSavedChanged,
  onVocabChanged,
  primaryLang,
  savedTexts,
  onSaved,
  onUnsaved,
  me,
  peer,
  onClose,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('saved');
  useBackClose(true, onClose);

  const counts: Record<Tab, number> = {
    saved: saved.length,
    vocab: vocab.length,
    album: photos.length,
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('library.title')} onClick={onClose}>
      <div className="sheet__panel library" onClick={(event) => event.stopPropagation()}>
        <header className="sheet__header">
          <h2>{t('library.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="chips library__tabs">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              className={`chip ${tab === item ? 'is-on' : ''}`}
              onClick={() => setTab(item)}
            >
              {t(`home.${item === 'album' ? 'album' : item}` as StringKey)}
              <span className="library__count">{counts[item]}</span>
            </button>
          ))}
        </div>

        {tab === 'saved' && <SavedList items={saved} onChanged={onSavedChanged} />}
        {tab === 'vocab' && (
          <VocabList
            entries={vocab}
            onChanged={onVocabChanged}
            primaryLang={primaryLang}
            savedTexts={savedTexts}
            onSaved={onSaved}
            onUnsaved={onUnsaved}
          />
        )}
        {tab === 'album' && <Album photos={photos} me={me} peer={peer} />}
      </div>
    </div>
  );
}
