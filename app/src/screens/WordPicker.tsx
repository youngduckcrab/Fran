import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  LANGUAGE_NAMES,
  cleanTerm,
  messageText,
  type ChatMessage,
  type LangCode,
  type WordLookup,
} from '@fran/shared';
import { lookUpWord, saveVocab } from '../web/api';
import { useT } from '../web/i18n';
import { hasSpeech, useSpeaker } from '../web/speech';
import { splitWords } from '../web/words';
import Icon from '../Icon';
import { Chips, Sheet, SheetHeader, useStyles } from '../ui/kit';
import { usePalette } from '../theme';
import { availableLangs } from './Explanation';

interface Props {
  message: ChatMessage;
  /** 처음 보여줄 문장의 언어. 공부하는 쪽을 먼저 편다. */
  initialLang: LangCode;
  /** 그것도 없으면 다음으로 볼 언어들. 내가 공부하는 순서대로. */
  extraLangs: LangCode[];
  /** 단어를 담았을 때. 홈의 숫자를 맞추는 데 쓴다. */
  onAdded: () => void;
  onClose: () => void;
}

/**
 * 문장의 단어를 하나씩 눌러 보는 화면.
 *
 * 모르는 단어가 하나 걸렸을 뿐인데 문장 전체 설명을 기다릴 이유는 없다. 누른 단어만
 * 짧게 풀어 주고, 마음에 들면 그 자리에서 단어장에 담는다.
 */
export default function WordPicker({ message, initialLang, extraLangs, onAdded, onClose }: Props) {
  const t = useT();
  const p = usePalette();
  const speaker = useSpeaker();
  const langs = availableLangs(message);
  // 공부하는 언어로 된 문장이 있으면 그것부터 편다.
  const [lang, setLang] = useState<LangCode>(
    [initialLang, ...extraLangs].find((item) => langs.includes(item)) ?? message.sourceLang,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [lookup, setLookup] = useState<WordLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const st = useStyles((c) => ({
    body: { paddingHorizontal: 20, paddingBottom: 30, gap: 10 },
    hint: { color: c.textMuted },
    sentence: { color: c.text, fontSize: 20, lineHeight: 34 },
    word: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: c.accent },
    wordOn: { backgroundColor: c.accentSoft, color: c.accent, fontWeight: '800' },
    wordAdded: { color: c.ok },
    error: { color: c.danger },
    card: { backgroundColor: c.accentSoft, borderRadius: 18, padding: 16, gap: 6 },
    main: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    mainText: { color: c.text, fontSize: 20, fontWeight: '800' },
    sub: { color: c.textMuted },
    pos: { color: c.accent, fontSize: 12, fontWeight: '700' },
    meaning: { color: c.text, fontSize: 16 },
    add: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 6 },
    speak: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  }));

  const sentence = lang === message.sourceLang ? messageText(message) : (message.translations[lang]?.text ?? '');
  const tokens = useMemo(() => splitWords(sentence, lang), [sentence, lang]);

  const choose = async (word: string) => {
    // 같은 단어를 다시 누르면 접는다.
    if (picked === word) {
      setPicked(null);
      setLookup(null);
      return;
    }
    setPicked(word);
    setLookup(null);
    setError(null);
    setBusy(true);
    try {
      setLookup(await lookUpWord(message.id, lang, word));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** 문장을 바꾸면 펼쳐 둔 단어는 의미가 없다. 같이 접는다. */
  const switchLang = (next: LangCode) => {
    setLang(next);
    setPicked(null);
    setLookup(null);
    setError(null);
  };

  const term = lookup ? cleanTerm(lookup.base) || cleanTerm(lookup.word) : '';
  const isAdded = added.has(`${lang}:${term}`);

  const addToVocab = async () => {
    if (!lookup || !term) return;
    setError(null);
    try {
      await saveVocab({
        term,
        lang,
        meaning: lookup.meaning,
        ...(lookup.reading ? { reading: lookup.reading } : {}),
        // 이 문장에서 어떻게 쓰였는지가 나중에 다시 볼 때 가장 쓸모 있다. 함께 남긴다.
        ...(lookup.inSentence || lookup.note
          ? { note: [lookup.inSentence, lookup.note].filter(Boolean).join(' · ') }
          : {}),
        messageId: message.id,
      });
      setAdded((current) => new Set(current).add(`${lang}:${term}`));
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const speakKey = `word:${lang}:${picked ?? ''}`;

  return (
    <Sheet onClose={onClose} full>
      <SheetHeader title={t('pick.title')} onClose={onClose} />
      {langs.length > 1 && <Chips items={langs} value={lang} onChange={switchLang} label={(l) => LANGUAGE_NAMES[l]} />}
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.hint}>{t('pick.hint')}</Text>

        {/* 문장 그대로 보이되 단어만 누를 수 있다. 공백과 문장부호는 글자 그대로 둔다. */}
        <Text style={st.sentence}>
          {tokens.map((token, index) =>
            token.word ? (
              <Text
                key={index}
                onPress={() => void choose(token.text)}
                style={[
                  st.word,
                  picked === token.text && st.wordOn,
                  added.has(`${lang}:${cleanTerm(token.text)}`) && st.wordAdded,
                ]}
              >
                {token.text}
              </Text>
            ) : (
              <Text key={index}>{token.text}</Text>
            ),
          )}
        </Text>

        {busy && <Text style={st.hint}>{t('pick.loading')}</Text>}
        {error && <Text style={st.error}>{error}</Text>}

        {lookup && !busy && (
          <View style={st.card}>
            <View style={st.main}>
              <Text style={st.mainText}>{lookup.word}</Text>
              {lookup.reading ? <Text style={st.sub}>{lookup.reading}</Text> : null}
              {lookup.pos ? <Text style={st.pos}>{lookup.pos}</Text> : null}
              {speaker.supported && hasSpeech(lookup.word) && (
                <Pressable
                  style={st.speak}
                  accessibilityLabel={speaker.speakingKey === speakKey ? t('bubble.stop') : t('bubble.listen')}
                  onPress={() => speaker.toggle(speakKey, lookup.word, lang)}
                >
                  <Icon name={speaker.speakingKey === speakKey ? 'stop' : 'play'} size={12} color={p.accent} />
                </Pressable>
              )}
            </View>

            {/* 사전형이 다를 때만. "fui" 를 찾으려면 "ir" 을 봐야 한다는 걸 알려 준다. */}
            {lookup.base && lookup.base !== lookup.word ? (
              <Text style={st.sub}>{t('pick.base', { base: lookup.base })}</Text>
            ) : null}

            <Text style={st.meaning}>{lookup.meaning}</Text>
            {lookup.inSentence ? <Text style={st.sub}>{lookup.inSentence}</Text> : null}
            {lookup.note ? <Text style={st.sub}>{lookup.note}</Text> : null}

            <Pressable style={[st.add, { opacity: isAdded || !term ? 0.6 : 1 }]} onPress={() => void addToVocab()} disabled={isAdded || !term}>
              <Icon name={isAdded ? 'check' : 'plus'} size={15} color={p.accent} />
              <Text style={{ color: p.accent, fontWeight: '800' }}>
                {isAdded ? t('vocab.added') : t('pick.add', { term })}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}
