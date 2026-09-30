import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { LANGUAGE_NAMES, type LangCode, type SavedSentence } from '@fran/shared';
import { deleteSaved } from '../web/api';
import { useT } from '../web/i18n';
import { useSpeaker } from '../web/speech';
import { Chips, Header, Screen, useStyles } from '../ui/kit';
import { Card, Empty, SpeakButton, Tool } from '../ui/cards';

interface Props {
  items: SavedSentence[];
  onChanged: (items: SavedSentence[]) => void;
  /** 그 말이 오간 자리로 간다. 대화에서 저장한 문장에만 있다. */
  onJump?: (messageId: string) => void;
  /** 한 화면으로 열렸을 때만. 보관함 안에서는 머리말이 필요 없다. */
  onBack?: () => void;
}

/** 나중에 다시 보려고 저장해 둔 문장들. */
export default function SavedList({ items, onChanged, onJump, onBack }: Props) {
  const t = useT();
  const [lang, setLang] = useState<LangCode | null>(null);
  const speaker = useSpeaker();
  const st = useStyles((c) => ({
    main: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    text: { color: c.text, fontSize: 16, flexShrink: 1 },
    sub: { color: c.textMuted, fontSize: 14 },
    foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
    tag: { color: c.textMuted, fontSize: 12, flexShrink: 1 },
    tools: { flexDirection: 'row', gap: 14 },
  }));

  /**
   * 담은 언어들. 많이 담은 언어를 앞에 둔다 — 열자마자 보고 싶은 건 대개 그쪽이다.
   * 언어가 하나뿐이면 고르는 줄을 띄우지 않는다.
   */
  const langs = useMemo(() => {
    const counts = new Map<LangCode, number>();
    for (const item of items) counts.set(item.lang, (counts.get(item.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [items]);
  const current = lang && langs.includes(lang) ? lang : (langs[0] ?? null);
  const shown = items.filter((item) => item.lang === current);

  const remove = async (id: string) => {
    onChanged(items.filter((item) => item.id !== id));
    await deleteSaved(id).catch(() => undefined);
  };

  const body = (
    <View style={{ flex: 1 }}>
      {langs.length > 1 && <Chips items={langs} value={current} onChange={setLang} label={(l) => LANGUAGE_NAMES[l]} />}
      {items.length === 0 ? <Empty text={t('saved.empty')} /> : null}
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={st.main}>
              <Text style={st.text}>{item.text}</Text>
              {speaker.supported && (
                <SpeakButton
                  on={speaker.speakingKey === item.id}
                  label={speaker.speakingKey === item.id ? t('bubble.stop') : t('bubble.listen')}
                  onPress={() => speaker.toggle(item.id, item.text, item.lang)}
                />
              )}
            </View>
            {item.pairText ? (
              <View style={st.main}>
                <Text style={st.sub}>{item.pairText}</Text>
                {/* 짝이 되는 문장도 들을 수 있다. 저장해 둔 문장은 대개 소리 내 보려고 담는다. */}
                {speaker.supported && item.pairLang && (
                  <SpeakButton
                    on={speaker.speakingKey === `${item.id}:pair`}
                    label={t('bubble.listenTranslation')}
                    onPress={() => speaker.toggle(`${item.id}:pair`, item.pairText as string, item.pairLang as LangCode)}
                  />
                )}
              </View>
            ) : null}
            <View style={st.foot}>
              <Text style={st.tag}>
                {/* 단어장 예문에서 담은 것이면 어느 단어에서 왔는지 적어 둔다. */}
                {item.vocabTerm ? `${item.vocabTerm} · ` : ''}
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              <View style={st.tools}>
                {onJump && item.messageId ? <Tool label={t('jump.go')} onPress={() => onJump(item.messageId as string)} /> : null}
                <Tool label={t('saved.delete')} onPress={() => void remove(item.id)} danger />
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  );

  if (!onBack) return body;
  return (
    <Screen>
      <Header title={t('saved.title')} onBack={onBack} />
      {body}
    </Screen>
  );
}
