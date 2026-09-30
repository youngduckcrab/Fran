import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { CallLine, CallRecord } from '@fran/shared';
import { deleteCall, fetchCallLines, fetchCalls } from '../web/api';
import { formatDay } from '../web/day';
import { useT, useUiLang } from '../web/i18n';
import { useSpeaker } from '../web/speech';
import Icon from '../Icon';
import { Header, Screen, TextButton, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  myId: string;
  peerName: string;
  myName: string;
  onBack: () => void;
}

/**
 * 통화 기록.
 *
 * 채팅과 섞지 않는다. 통화에서 나온 말은 받아쓴 것이라 군데군데 틀리고, 흐름도
 * 글로 주고받은 것과 다르다. 따로 두고 따로 들춰 보는 편이 양쪽 다 깔끔하다.
 */
export default function CallLog({ myId, peerName, myName, onBack }: Props) {
  const t = useT();
  const uiLang = useUiLang();
  const [calls, setCalls] = useState<CallRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const st = useStyles((c) => ({
    empty: { color: c.textMuted, textAlign: 'center', padding: 32, gap: 6 },
    item: { borderBottomWidth: 1, borderBottomColor: c.border },
    head: { paddingHorizontal: 18, paddingVertical: 14, gap: 3 },
    when: { color: c.text, fontWeight: '700' },
    meta: { color: c.textMuted, fontSize: 13 },
    lines: { paddingHorizontal: 18, paddingBottom: 10, gap: 8 },
    delete: { alignSelf: 'flex-start', paddingHorizontal: 18, paddingBottom: 14 },
  }));

  useEffect(() => {
    void fetchCalls()
      .then(setCalls)
      .catch(() => setCalls([]));
  }, []);

  const remove = async (id: string) => {
    setCalls((previous) => (previous ?? []).filter((call) => call.id !== id));
    if (open === id) setOpen(null);
    await deleteCall(id).catch(() => undefined);
  };

  return (
    <Screen>
      <Header title={t('calls.title')} onBack={onBack} />
      {calls === null ? (
        <Text style={st.empty}>{t('calls.loading')}</Text>
      ) : calls.length === 0 ? (
        <View style={st.empty}>
          <Text style={{ color: st.meta.color }}>{t('calls.empty')}</Text>
          <Text style={st.meta}>{t('calls.hint')}</Text>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(call) => call.id}
          renderItem={({ item: call }) => (
            <View style={st.item}>
              <Pressable style={st.head} onPress={() => setOpen(open === call.id ? null : call.id)}>
                <Text style={st.when}>
                  {formatDay(call.startedAt, t, uiLang)} {clock(call.startedAt)}
                </Text>
                {/* 누가 걸었는지. 받은 전화와 건 전화를 눈으로 가른다. */}
                <Text style={st.meta}>
                  {call.callerId === myId ? '↗' : '↙'} {length(call, t)} · {t('calls.lines', { n: String(call.lines) })}
                </Text>
              </Pressable>
              {open === call.id && <Lines callId={call.id} myId={myId} myName={myName} peerName={peerName} />}
              {open === call.id && (
                <View style={st.delete}>
                  <TextButton label={t('calls.delete')} onPress={() => void remove(call.id)} danger />
                </View>
              )}
            </View>
          )}
        />
      )}
    </Screen>
  );
}

/** 한 통화에서 오간 말. 열었을 때만 받아온다 — 통화 하나가 수백 줄일 수 있다. */
function Lines({ callId, myId, myName, peerName }: { callId: string; myId: string; myName: string; peerName: string }) {
  const t = useT();
  const p = usePalette();
  const speaker = useSpeaker();
  const [lines, setLines] = useState<CallLine[] | null>(null);
  const st = useStyles((c) => ({
    lines: { paddingHorizontal: 18, paddingBottom: 10, gap: 10 },
    who: { color: c.textMuted, fontSize: 12, fontWeight: '700' },
    said: { color: c.text, fontSize: 15 },
    meaning: { color: c.accent, fontSize: 14, marginTop: 2 },
    speak: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft },
  }));

  useEffect(() => {
    void fetchCallLines(callId)
      .then(setLines)
      .catch(() => setLines([]));
  }, [callId]);

  if (lines === null) return <Text style={{ color: p.textMuted, padding: 18 }}>{t('calls.loading')}</Text>;

  return (
    <View style={st.lines}>
      {lines.map((line) => {
        const mine = line.speakerId === myId;
        const translated = Object.values(line.translations)[0];
        return (
          <View key={line.id}>
            <Text style={st.who}>{mine ? myName : peerName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={st.said}>{line.text}</Text>
              {speaker.supported && (
                <Pressable
                  style={st.speak}
                  accessibilityLabel={t('bubble.listen')}
                  onPress={() => speaker.toggle(line.id, line.text, line.lang)}
                >
                  <Icon name={speaker.speakingKey === line.id ? 'stop' : 'play'} size={11} color={p.accent} />
                </Pressable>
              )}
            </View>
            {translated ? <Text style={st.meaning}>{translated}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 통화가 얼마나 걸렸는지. 끝난 시각이 없으면 (서버가 꺼졌던 경우) 빈칸. */
function length(call: CallRecord, t: (key: 'calls.duration', vars?: Record<string, string>) => string): string {
  if (call.endedAt === null) return '—';
  const total = Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000));
  return t('calls.duration', { m: String(Math.floor(total / 60)), s: String(total % 60) });
}
