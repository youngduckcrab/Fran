import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { LANGUAGE_NAMES, type LangCode, type SavedSentence, type VocabEntry } from '@fran/shared';
import { deleteSaved, deleteVocab, makeVocabExample, saveSentence, setVocabLearned } from '../web/api';
import { useT } from '../web/i18n';
import { hasSpeech, useSpeaker, type Speaker } from '../web/speech';
import { plainText } from '../web/text';
import Icon from '../Icon';
import { Chips, Header, Screen, useStyles } from '../ui/kit';
import { Card, Empty, SpeakButton, Tool } from '../ui/cards';
import { usePalette } from '../theme';

interface Props {
  entries: VocabEntry[];
  onChanged: (entries: VocabEntry[]) => void;
  /** 그 단어를 담았던 말풍선으로 간다. 대화에서 담은 것에만 있다. */
  onJump?: (messageId: string) => void;
  /** 한 화면으로 열렸을 때만. 보관함 안에서는 머리말이 필요 없다. */
  onBack?: () => void;
  /** 내가 읽는 언어. 예문을 보관할 때 뜻을 함께 남기는 데 쓴다. */
  primaryLang: LangCode;
  /** 이미 보관함에 있는 문장들. `<언어>:<다듬은 문장>` → 저장 항목 id. */
  savedTexts: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
}

type Shelf = 'learning' | 'learned';
const SHELVES: Shelf[] = ['learning', 'learned'];

export default function VocabList({ entries, onChanged, onJump, onBack, primaryLang, savedTexts, onSaved, onUnsaved }: Props) {
  const t = useT();
  const p = usePalette();
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
  const current = lang && langs.includes(lang) ? lang : (langs[0] ?? null);

  const ofLang = entries.filter((entry) => entry.lang === current);
  const shown = ofLang.filter((entry) => (shelf === 'learned' ? entry.learned : !entry.learned));

  const replace = (entry: VocabEntry) => onChanged(entries.map((item) => (item.id === entry.id ? entry : item)));

  const remove = async (id: string) => {
    onChanged(entries.filter((entry) => entry.id !== id));
    await deleteVocab(id).catch(() => undefined);
  };

  const body = (
    <View style={{ flex: 1 }}>
      {langs.length > 1 && <Chips items={langs} value={current} onChange={setLang} label={(l) => LANGUAGE_NAMES[l]} />}

      {entries.length > 0 && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingVertical: 6 }}>
          {SHELVES.map((item) => {
            const on = shelf === item;
            const count = ofLang.filter((entry) => (item === 'learned' ? entry.learned : !entry.learned)).length;
            return (
              <Pressable
                key={item}
                onPress={() => setShelf(item)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 8,
                  borderRadius: 12,
                  backgroundColor: on ? p.accentSoft : 'transparent',
                  borderWidth: 1,
                  borderColor: on ? p.accent : p.border,
                }}
              >
                <Text style={{ color: p.text, fontWeight: on ? '800' : '500' }}>
                  {item === 'learned' ? t('vocab.learned') : t('vocab.learning')} {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? <Text style={{ color: p.danger, paddingHorizontal: 20 }}>{error}</Text> : null}
      {entries.length === 0 ? <Empty text={t('vocab.empty')} /> : null}
      {entries.length > 0 && shown.length === 0 ? (
        <Empty text={shelf === 'learned' ? t('vocab.emptyLearned') : t('vocab.empty')} />
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item: entry }) => (
          <VocabCard
            entry={entry}
            speaker={speaker}
            primaryLang={primaryLang}
            savedTexts={savedTexts}
            onSaved={onSaved}
            onUnsaved={onUnsaved}
            onChanged={replace}
            onDelete={() => void remove(entry.id)}
            {...(onJump && entry.messageId ? { onJump: () => onJump(entry.messageId as string) } : {})}
            onError={setError}
          />
        )}
      />
    </View>
  );

  if (!onBack) return body;
  return (
    <Screen>
      <Header title={t('vocab.title')} onBack={onBack} />
      {body}
    </Screen>
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
  /** 이 단어를 담았던 말풍선으로. 대화에서 담은 것에만 있다. */
  onJump?: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

function VocabCard({ entry, speaker, primaryLang, savedTexts, onSaved, onUnsaved, onChanged, onDelete, onJump, onError }: CardProps) {
  const t = useT();
  const p = usePalette();
  const [busy, setBusy] = useState(false);
  /** 예문은 눌렀을 때만 펼친다. 카드가 길어지면 훑어보기 어렵다. */
  const [open, setOpen] = useState(false);
  /** 아무리 물어도 같은 문장만 나올 때. */
  const [duplicate, setDuplicate] = useState(false);

  const st = useStyles((c) => ({
    main: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    term: { color: c.text, fontSize: 18, fontWeight: '800' },
    reading: { color: c.textMuted },
    sub: { color: c.text, fontSize: 15 },
    note: { color: c.textMuted, fontSize: 13 },
    example: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border, gap: 8 },
    foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
    learn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.border },
    learnOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
    tools: { flexDirection: 'row', gap: 14 },
  }));

  const speakButton = (key: string, text: string) =>
    speaker.supported && hasSpeech(text) ? (
      <SpeakButton
        on={speaker.speakingKey === key}
        label={speaker.speakingKey === key ? t('bubble.stop') : t('bubble.listen')}
        onPress={() => speaker.toggle(key, text, entry.lang)}
      />
    ) : null;

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
    <Card faded={entry.learned}>
      <View style={st.main}>
        <Text style={st.term}>{entry.term}</Text>
        {entry.reading ? <Text style={st.reading}>{entry.reading}</Text> : null}
        {speakButton(entry.id, entry.term)}
      </View>
      <Text style={st.sub}>{entry.meaning}</Text>
      {entry.note ? <Text style={st.note}>{entry.note}</Text> : null}

      {open && (
        <View style={st.example}>
          {entry.examples.map((example, index) => {
            const saved = savedTexts.has(`${entry.lang}:${plainText(example.sentence)}`);
            return (
              <View key={`${example.createdAt}-${index}`}>
                <View style={st.main}>
                  <Text style={[st.sub, { flexShrink: 1 }]}>{example.sentence}</Text>
                  {speakButton(`${entry.id}:example:${index}`, example.sentence)}
                  {/* 마음에 드는 예문은 보관함으로. 다시 누르면 빠진다. */}
                  <Pressable
                    onPress={() => void toggleSaved(example.sentence, example.translation)}
                    accessibilityLabel={saved ? t('save.remove') : t('actions.save')}
                    hitSlop={8}
                  >
                    <Icon name={saved ? 'check' : 'bookmark'} size={16} color={p.accent} />
                  </Pressable>
                </View>
                {example.translation ? <Text style={st.note}>{example.translation}</Text> : null}
              </View>
            );
          })}
          {busy ? <Text style={st.note}>{t('vocab.exampleLoading')}</Text> : null}
          {duplicate ? <Text style={st.note}>{t('vocab.exampleDuplicate')}</Text> : null}
          <View style={{ alignItems: 'flex-start' }}>
            <Tool label={t('vocab.exampleAgain')} onPress={() => void addExample()} disabled={busy} />
          </View>
        </View>
      )}

      <View style={st.foot}>
        <Pressable style={[st.learn, entry.learned && st.learnOn]} onPress={() => void toggleLearned()}>
          {entry.learned && <Icon name="check" size={14} color={p.accent} />}
          <Text style={{ color: p.text, fontSize: 13 }}>{entry.learned ? t('vocab.learned') : t('vocab.markLearned')}</Text>
        </Pressable>
        <View style={st.tools}>
          {!open && (
            <Tool
              label={entry.examples.length > 0 ? t('vocab.exampleCount', { count: String(entry.examples.length) }) : t('vocab.example')}
              onPress={() => (entry.examples.length > 0 ? setOpen(true) : void addExample())}
            />
          )}
          {onJump ? <Tool label={t('jump.go')} onPress={onJump} /> : null}
          <Tool label={t('vocab.delete')} onPress={onDelete} danger />
        </View>
      </View>
    </Card>
  );
}
