import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  LANGUAGE_NAMES,
  cleanTerm,
  type ChatMessage,
  type ExplanationChunk,
  type LangCode,
  type MessageExplanation,
} from '@fran/shared';
import { explainMessage, saveVocab } from '../web/api';
import { useT } from '../web/i18n';
import { Chips, Sheet, SheetHeader, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  message: ChatMessage;
  /** 처음 열었을 때 설명할 언어. */
  initialLang: LangCode;
  /** 단어를 담았을 때. 홈의 숫자를 맞추는 데 쓴다. */
  onAdded: () => void;
  onClose: () => void;
}

/** 이 메시지에 대해 설명을 받아볼 수 있는 문장들(원문 + 번역된 것들). */
export function availableLangs(message: ChatMessage): LangCode[] {
  const langs = Object.keys(message.translations).filter((lang): lang is LangCode =>
    Boolean(message.translations[lang as LangCode]),
  );
  return [message.sourceLang, ...langs];
}

export default function Explanation({ message, initialLang, onAdded, onClose }: Props) {
  const t = useT();
  const p = usePalette();
  const langs = availableLangs(message);
  const [lang, setLang] = useState<LangCode>(langs.includes(initialLang) ? initialLang : message.sourceLang);
  const [explanation, setExplanation] = useState<MessageExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 단어장에 담은 조각들. 같은 화면에서 눌렀는지 바로 보이게 표시만 해 둔다. */
  const [added, setAdded] = useState<Set<string>>(new Set());

  const st = useStyles((c) => ({
    body: { paddingHorizontal: 20, paddingBottom: 30, gap: 10 },
    sentence: { color: c.text, fontSize: 18, fontWeight: '700', lineHeight: 26 },
    loading: { color: c.textMuted },
    error: { color: c.danger },
    summary: { color: c.text, fontSize: 15, lineHeight: 22, backgroundColor: c.accentSoft, padding: 12, borderRadius: 14 },
    chunk: { gap: 3, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chunkText: { color: c.text, fontSize: 16, fontWeight: '800', flex: 1 },
    reading: { color: c.textMuted, fontWeight: '400' },
    add: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft },
    meaning: { color: c.text },
    note: { color: c.textMuted, fontSize: 13 },
    h3: { color: c.text, fontWeight: '800', marginTop: 8 },
    li: { color: c.text, lineHeight: 21 },
  }));

  const load = useCallback(
    async (target: LangCode) => {
      setBusy(true);
      setError(null);
      setExplanation(null);
      try {
        setExplanation(await explainMessage(message.id, target));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [message.id],
  );

  useEffect(() => {
    void load(lang);
  }, [lang, load]);

  const sentence = lang === message.sourceLang ? message.sourceText : (message.translations[lang]?.text ?? '');

  const addToVocab = async (chunk: ExplanationChunk) => {
    const term = cleanTerm(chunk.text);
    if (!term) return;
    try {
      await saveVocab({
        term,
        lang,
        meaning: chunk.meaning,
        ...(chunk.reading ? { reading: chunk.reading } : {}),
        ...(chunk.note ? { note: chunk.note } : {}),
        messageId: message.id,
      });
      setAdded((current) => new Set(current).add(term));
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Sheet onClose={onClose} full>
      <SheetHeader title={t('explain.title')} onClose={onClose} />
      {langs.length > 1 && <Chips items={langs} value={lang} onChange={setLang} label={(l) => LANGUAGE_NAMES[l]} />}
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.sentence}>{sentence}</Text>
        {busy && <Text style={st.loading}>{t('explain.loading')}</Text>}
        {error && <Text style={st.error}>{error}</Text>}

        {explanation && (
          <>
            <Text style={st.summary}>{explanation.summary}</Text>

            {explanation.chunks.map((chunk, index) => {
              // 기호를 뗀 표제어로 담는다. "¿Dormiste" 가 아니라 "Dormiste" 로.
              const term = cleanTerm(chunk.text);
              const done = added.has(term);
              return (
                <View key={`${chunk.text}-${index}`} style={st.chunk}>
                  <View style={st.head}>
                    <Text style={st.chunkText}>
                      {chunk.text}
                      {chunk.reading ? <Text style={st.reading}>  {chunk.reading}</Text> : null}
                    </Text>
                    <Pressable
                      style={[st.add, done && { backgroundColor: p.accent }]}
                      onPress={() => void addToVocab(chunk)}
                      disabled={done || !term}
                      accessibilityLabel={t('vocab.add')}
                    >
                      <Text style={{ color: done ? p.onAccent : p.accent, fontWeight: '900', fontSize: 16 }}>
                        {done ? '✓' : '+'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={st.meaning}>{chunk.meaning}</Text>
                  {chunk.note ? <Text style={st.note}>{chunk.note}</Text> : null}
                </View>
              );
            })}

            {explanation.points.length > 0 && (
              <>
                <Text style={st.h3}>{t('explain.points')}</Text>
                {explanation.points.map((point, index) => (
                  <Text key={index} style={st.li}>
                    • {point}
                  </Text>
                ))}
              </>
            )}

            {explanation.replies.length > 0 && (
              <>
                <Text style={st.h3}>{t('explain.replies')}</Text>
                {explanation.replies.map((reply, index) => (
                  <Text key={index} style={st.li}>
                    • {reply}
                  </Text>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
