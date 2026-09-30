import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { useT } from '../web/i18n';
import { previewOf } from '../web/preview';
import Icon, { type IconName } from '../Icon';
import { IconButton, Screen, TextButton, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

export type Page = 'home' | 'chat' | 'saved' | 'vocab' | 'album' | 'calls';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  connecting: boolean;
  /** 서버가 잠들어 있어 깨우는 중. 오래 기다리는 이유를 알려 준다. */
  waking: boolean;
  peerOnline: boolean;
  lastMessage: ChatMessage | undefined;
  primaryLang: LangCode;
  unread: number;
  counts: { saved: number; vocab: number; photos: number };
  onOpen: (view: Page) => void;
  onSettings: () => void;
}

export default function Home({
  me,
  peer,
  connecting,
  waking,
  peerOnline,
  lastMessage,
  primaryLang,
  unread,
  counts,
  onOpen,
  onSettings,
}: Props) {
  const t = useT();
  const p = usePalette();
  const last = previewOf(lastMessage, primaryLang, t);

  const st = useStyles((c) => ({
    scroll: { padding: 18, gap: 14 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    peerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    peer: { color: c.text, fontSize: 28, fontWeight: '800' },
    status: { color: c.textMuted, marginTop: 2 },
    chat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 18,
      borderRadius: 24,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    body: { flex: 1 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    line: { color: c.textMuted, marginTop: 4 },
    badge: {
      minWidth: 26,
      height: 26,
      borderRadius: 13,
      paddingHorizontal: 7,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: c.onAccent, fontWeight: '800', fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      padding: 16,
      borderRadius: 22,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 16,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    count: { color: c.textMuted, fontSize: 13 },
  }));

  const Tile = ({ icon, title, count, view }: { icon: IconName; title: string; count?: string; view: Page }) => (
    <Pressable style={st.tile} onPress={() => onOpen(view)}>
      <View style={st.icon}>
        <Icon name={icon} size={24} color={p.accent} />
      </View>
      <Text style={st.title}>{title}</Text>
      {count ? <Text style={st.count}>{count}</Text> : null}
    </Pressable>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.scroll}>
        <View style={st.header}>
          <View>
            <View style={st.peerRow}>
              <Text style={st.peer}>{peer?.name ?? t('chat.connecting')}</Text>
              <Icon name="heart" size={18} color={p.accent} />
            </View>
            <Text style={st.status}>
              {connecting
                ? waking
                  ? t('chat.waking')
                  : t('chat.reconnectingShort')
                : peerOnline
                  ? t('chat.online')
                  : t('chat.offline')}
            </Text>
          </View>
          <TextButton label={t('chat.settings')} onPress={onSettings} disabled={!me} />
        </View>

        <Pressable style={st.chat} onPress={() => onOpen('chat')}>
          <View style={st.icon}>
            <Icon name="chat" size={26} color={p.accent} />
          </View>
          <View style={st.body}>
            <Text style={st.title}>{t('home.chat')}</Text>
            <Text style={st.line} numberOfLines={2}>
              {last ?? t('home.chatEmpty')}
            </Text>
          </View>
          {unread > 0 && (
            <View style={st.badge} accessibilityLabel={t('home.unread', { count: String(unread) })}>
              <Text style={st.badgeText}>{unread}</Text>
            </View>
          )}
        </Pressable>

        <View style={st.grid}>
          <Tile icon="bookmark" title={t('home.saved')} count={t('home.items', { count: String(counts.saved) })} view="saved" />
          <Tile icon="book" title={t('home.vocab')} count={t('home.items', { count: String(counts.vocab) })} view="vocab" />
          <Tile icon="image" title={t('home.album')} count={t('home.items', { count: String(counts.photos) })} view="album" />
          <Tile icon="phone" title={t('calls.title')} view="calls" />
        </View>
      </ScrollView>
    </Screen>
  );
}
