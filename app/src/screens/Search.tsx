import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { ChatMessage, UserProfile } from '@fran/shared';
import { searchMessages } from '../web/api';
import { useT } from '../web/i18n';
import { snippetOf } from '../web/search';
import { Sheet, SheetHeader, TextButton, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  /** 고른 것의 자리로 간다. 누르면 이 창을 닫고 대화로 데려간다. */
  onJump: (messageId: string) => void;
  onClose: () => void;
}

/** 치자마자 찾으러 가면 글자마다 한 번씩 물어보게 된다. 손이 멈추면 간다. */
const SETTLE_MS = 300;

function formatWhen(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * 대화에서 찾기.
 *
 * 원문만 뒤지면 반쪽이다 — 한국어로 친 말을 스페인어로 기억하고 있을 수도 있고,
 * 음성 메시지는 아예 받아쓴 글에만 있다. 서버가 셋을 함께 본다.
 */
export default function Search({ me, peer, onJump, onClose }: Props) {
  const t = useT();
  const p = usePalette();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 지금 화면에 걸린 말. 결과를 그릴 때는 이걸로 도막을 낸다(입력칸과 따로 움직인다). */
  const [shown, setShown] = useState('');

  const st = useStyles((c) => ({
    input: {
      marginHorizontal: 20,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.text,
      backgroundColor: c.bg,
      fontSize: 16,
    },
    hint: { color: c.textMuted, paddingHorizontal: 20, paddingVertical: 8 },
    hit: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 3 },
    who: { color: c.text, fontWeight: '700' },
    when: { color: c.textMuted, fontWeight: '400', fontSize: 12 },
    text: { color: c.text, lineHeight: 20 },
    mark: { backgroundColor: c.accentSoft, color: c.accent, fontWeight: '800' },
    empty: { color: c.textMuted, textAlign: 'center', padding: 28 },
  }));

  useEffect(() => {
    const word = query.trim();
    if (word.length < 2) {
      setResults(null);
      setHasMore(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      searchMessages(word)
        .then((found) => {
          if (cancelled) return;
          setResults(found.messages);
          setHasMore(found.hasMore);
          setShown(word);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const more = async () => {
    const oldest = results?.[results.length - 1]?.createdAt;
    if (oldest === undefined) return;
    setBusy(true);
    try {
      const found = await searchMessages(shown, oldest);
      setResults((previous) => [...(previous ?? []), ...found.messages]);
      setHasMore(found.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (message: ChatMessage) => (message.senderId === me?.id ? me?.name : peer?.name) ?? '';

  return (
    <Sheet onClose={onClose} full>
      <SheetHeader title={t('search.title')} onClose={onClose} />
      <TextInput
        style={st.input}
        value={query}
        autoFocus
        placeholder={t('search.placeholder')}
        placeholderTextColor={p.textMuted}
        onChangeText={setQuery}
      />
      <Text style={st.hint}>{t('search.hint')}</Text>
      {error ? <Text style={[st.hint, { color: p.danger }]}>{error}</Text> : null}
      {busy && results === null ? <Text style={st.hint}>{t('search.looking')}</Text> : null}
      {results !== null && results.length === 0 && !busy ? (
        <Text style={st.empty}>{t('search.none', { query: shown })}</Text>
      ) : null}

      {results !== null && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(message) => message.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: message }) => {
            const piece = snippetOf(message, shown);
            return (
              <Pressable style={st.hit} onPress={() => onJump(message.id)}>
                <Text style={st.who}>
                  {nameOf(message)}  <Text style={st.when}>{formatWhen(message.createdAt)}</Text>
                </Text>
                <Text style={st.text}>
                  {piece?.clipped ? '…' : ''}
                  {piece?.before}
                  {piece?.match ? <Text style={st.mark}>{piece.match}</Text> : null}
                  {piece?.after}
                </Text>
              </Pressable>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                {busy ? (
                  <ActivityIndicator color={p.accent} />
                ) : (
                  <TextButton label={t('search.more')} onPress={() => void more()} />
                )}
              </View>
            ) : null
          }
        />
      )}
    </Sheet>
  );
}
