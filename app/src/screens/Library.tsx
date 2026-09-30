import { useState } from 'react';
import { View } from 'react-native';
import type { LangCode, SavedSentence, UserProfile, VocabEntry } from '@fran/shared';
import type { Photo } from '../web/api';
import { useT, type StringKey } from '../web/i18n';
import { Chips, Sheet, SheetHeader } from '../ui/kit';
import Album from './Album';
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
  /** 그 말이 오간 자리로. 누르면 보관함을 닫고 대화로 데려간다. */
  onJump: (messageId: string) => void;
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
 * 채팅 위에 얹어서 보고, 닫으면 쓰던 자리로 돌아온다.
 */
export default function Library(props: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('saved');
  const counts: Record<Tab, number> = { saved: props.saved.length, vocab: props.vocab.length, album: props.photos.length };

  return (
    <Sheet onClose={props.onClose} full>
      <SheetHeader title={t('library.title')} onClose={props.onClose} />
      <Chips
        items={TABS}
        value={tab}
        onChange={setTab}
        label={(item) => `${t(`home.${item}` as StringKey)} ${counts[item]}`}
      />
      <View style={{ flex: 1 }}>
        {tab === 'saved' && <SavedList items={props.saved} onChanged={props.onSavedChanged} onJump={props.onJump} />}
        {tab === 'vocab' && (
          <VocabList
            entries={props.vocab}
            onChanged={props.onVocabChanged}
            onJump={props.onJump}
            primaryLang={props.primaryLang}
            savedTexts={props.savedTexts}
            onSaved={props.onSaved}
            onUnsaved={props.onUnsaved}
          />
        )}
        {tab === 'album' && <Album photos={props.photos} onJump={props.onJump} me={props.me} peer={props.peer} />}
      </View>
    </Sheet>
  );
}
