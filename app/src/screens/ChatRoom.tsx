import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { messageText, type ChatMessage, type LangCode, type SavedSentence } from '@fran/shared';
import type { Chat } from '../web/useChat';
import type { Call } from '../web/call';
import { useT, useUiLang } from '../web/i18n';
import { useWaking } from '../web/waking';
import { dayKey, formatDay, startsNewDay } from '../web/day';
import { useSpeaker } from '../web/speech';
import type { BubbleView } from '../web/view';
import Icon from '../Icon';
import { useBackClose } from '../backstack';
import { clearDelivered } from '../push';
import { ensureCallPermissions } from '../permissions';
import { Header, IconButton, Row, Sheet, useStyles } from '../ui/kit';
import Wallpaper from '../ui/Wallpaper';
import { usePalette } from '../theme';
import Composer from './Composer';
import Explanation from './Explanation';
import MessageActions from './MessageActions';
import MessageBubble from './MessageBubble';
import PhotoViewer from './PhotoViewer';
import SaveSheet from './SaveSheet';
import WordPicker from './WordPicker';

interface Props {
  chat: Chat;
  /** 통화. 거는 단추가 여기 머리말에 있고, 화면은 이 위를 덮는다. */
  call: Call;
  primaryLang: LangCode;
  extraLangs: LangCode[];
  view: BubbleView;
  /** 이미 저장한 문장들. `<메시지 id>:<언어>` → 저장 항목 id. */
  savedIds: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
  onVocabAdded: () => void;
  onBack: () => void;
  onGlossary: () => void;
  onSettings: () => void;
  /** 대화를 보면서 저장한 문장·단어장·사진첩을 열어본다. */
  onLibrary: () => void;
  /** 대화에서 찾기. */
  onSearch: () => void;
  /** 보관함에서 "대화에서 보기" 로 건너온 메시지. 그 자리로 데려다 준다. */
  focusId: string | null;
  onFocused: () => void;
}

type Row =
  | { kind: 'day'; key: string; at: number }
  | { kind: 'message'; key: string; message: ChatMessage };

export default function ChatRoom({
  chat,
  call,
  primaryLang,
  extraLangs,
  view,
  savedIds,
  onSaved,
  onUnsaved,
  onVocabAdded,
  onBack,
  onGlossary,
  onSettings,
  onLibrary,
  onSearch,
  focusId,
  onFocused,
}: Props) {
  const t = useT();
  const p = usePalette();
  const uiLang = useUiLang();
  const insets = useSafeAreaInsets();
  const waking = useWaking(chat.connection);
  const speaker = useSpeaker();
  const list = useRef<FlatList<Row> | null>(null);

  /** 길게 눌러 고른 메시지. 메뉴와 설명 패널이 이걸 본다. */
  const [picked, setPicked] = useState<ChatMessage | null>(null);
  const [explaining, setExplaining] = useState<ChatMessage | null>(null);
  const [picking, setPicking] = useState<ChatMessage | null>(null);
  const [saving, setSaving] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 잠깐 떴다 사라지는 한 줄. 시각을 함께 들고 있어야 같은 문구가 연달아 떠도 다시 보인다. */
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const say = (text: string) => setToast({ text, at: Date.now() });

  const st = useStyles((c) => ({
    day: { alignItems: 'center', paddingVertical: 10 },
    dayText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: 'hidden',
    },
    edge: { alignItems: 'center', padding: 14 },
    edgeText: { color: c.textMuted, fontSize: 12 },
    typing: { paddingHorizontal: 18, paddingVertical: 6 },
    toast: {
      position: 'absolute',
      alignSelf: 'center',
      bottom: 84,
      maxWidth: '86%',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    toastText: { color: c.text, fontSize: 13 },
    tail: {
      position: 'absolute',
      alignSelf: 'center',
      bottom: 90,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: c.accent,
    },
  }));

  const me = chat.me;
  const peer = chat.peer;
  const { atTail, hasOlder, hasNewer, loadOlder, loadNewer, backToTail, jumpTo, markRead } = chat;

  /** 채팅 데이터를 (옛것 → 새것) 순서의 줄로. 날짜가 바뀌는 자리마다 구분선을 끼운다. */
  const rows = useMemo(() => {
    const out: Row[] = [];
    chat.messages.forEach((message, index) => {
      if (startsNewDay(message.createdAt, chat.messages[index - 1]?.createdAt)) {
        out.push({ kind: 'day', key: `day-${dayKey(message.createdAt)}`, at: message.createdAt });
      }
      out.push({ kind: 'message', key: message.id, message });
    });
    // 아래에서부터 쌓는 목록이라 새것이 앞에 온다. 그러면 새 메시지가 와도 보던 자리가 안 밀린다.
    return out.reverse();
  }, [chat.messages]);

  const byId = useMemo(() => new Map(chat.messages.map((message) => [message.id, message])), [chat.messages]);

  /** 상대가 실제로 읽는 언어. 내 메시지가 어떻게 갔는지 보여줄 때 쓴다. */
  const peerLang: LangCode = peer?.displayLangs[0] ?? peer?.nativeLang ?? 'es';

  /** 공부하는 언어 쪽 문장을 먼저 펴 준다. 내 언어로 쓴 글이면 배우는 언어의 번역을. */
  const studyLangOf = (message: ChatMessage): LangCode =>
    message.sourceLang !== primaryLang ? message.sourceLang : (extraLangs[0] ?? primaryLang);

  /* ---- 읽음 표시 ---- */

  /*
   * 대화를 보고 있으면 읽은 것으로 친다. 폰이 잠겼거나 다른 앱을 보는 중에는 읽었다고
   * 하지 않는다. 다시 앱으로 돌아오면 그때 표시한다.
   */
  const newest = chat.messages[chat.messages.length - 1]?.createdAt ?? 0;
  useEffect(() => {
    if (!newest) return;
    const mark = () => {
      if (AppState.currentState !== 'active') return;
      markRead(newest);
      // 여기까지 읽었으니 폰에 쌓여 있던 알림도 치운다.
      void clearDelivered();
    };
    mark();
    const subscription = AppState.addEventListener('change', mark);
    return () => subscription.remove();
  }, [newest, markRead]);

  /* ---- 찾아가기 ---- */

  /** 지금 반짝이고 있는 말풍선. 찾아간 자리를 눈으로 짚어 준다. */
  const [found, setFound] = useState<string | null>(null);
  /** 찾아갈 말풍선. 목록이 갈아 끼워진 뒤에 그 자리로 스크롤한다. */
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const sought = useRef<string | null>(null);

  useEffect(() => {
    // 같은 것을 다시 고르면 또 찾아가야 한다. 놓아줄 때 기억을 비운다.
    if (!focusId) {
      sought.current = null;
      return;
    }
    if (sought.current === focusId) return;
    sought.current = focusId;
    let cancelled = false;
    void (async () => {
      const here = await jumpTo(focusId);
      if (cancelled) return;
      if (here) setScrollTarget(focusId);
      else say(t('jump.gone'));
      onFocused();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => {
    if (!scrollTarget) return;
    const index = rows.findIndex((row) => row.kind === 'message' && row.message.id === scrollTarget);
    if (index === -1) return;
    // 목록이 그려질 때까지 한 박자 기다린다.
    const timer = setTimeout(() => {
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      setFound(scrollTarget);
      setScrollTarget(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [scrollTarget, rows]);

  // 반짝임은 잠깐이면 된다. 계속 켜 두면 무엇이 새 메시지인지 헷갈린다.
  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => setFound(null), 2600);
    return () => clearTimeout(timer);
  }, [found]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useBackClose(Boolean(picked), () => setPicked(null));
  useBackClose(Boolean(replyTo), () => setReplyTo(null));
  useBackClose(Boolean(editing), () => setEditing(null));

  const startCall = useCallback(
    async (video: boolean) => {
      if (!(await ensureCallPermissions(video))) {
        say(t('call.denied'));
        return;
      }
      void call.start(video);
    },
    [call, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'day') {
        return (
          <View style={st.day}>
            {/* 여기 적는 날짜도 보는 사람의 달력으로. */}
            <Text style={st.dayText}>{formatDay(item.at, t, uiLang)}</Text>
          </View>
        );
      }
      const message = item.message;
      const mine = message.senderId === me?.id;
      const replied = message.replyTo ? byId.get(message.replyTo) : undefined;
      return (
        <MessageBubble
          message={message}
          highlight={found === message.id}
          mine={mine}
          primaryLang={mine ? message.sourceLang : primaryLang}
          extraLangs={extraLangs}
          peerLang={peerLang}
          peerName={peer?.name ?? ''}
          view={view}
          speechSupported={speaker.supported}
          speakingKey={speaker.speakingKey}
          failedSpeechKey={speaker.failedKey}
          onSpeak={speaker.toggle}
          onRetranslate={chat.retranslate}
          onLongPress={setPicked}
          onReply={setReplyTo}
          repliedTo={replied}
          myId={me?.id ?? ''}
          readByPeer={(chat.readAt[peer?.id ?? ''] ?? 0) >= message.createdAt}
          onOpenPhoto={setPhoto}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      st,
      t,
      uiLang,
      me?.id,
      byId,
      found,
      primaryLang,
      extraLangs,
      peerLang,
      peer?.name,
      view,
      speaker.supported,
      speaker.speakingKey,
      speaker.failedKey,
      chat.readAt,
      chat.retranslate,
    ],
  );

  const status =
    chat.connection !== 'open'
      ? waking
        ? t('chat.waking')
        : t('chat.reconnectingShort')
      : chat.peerTyping
        ? t('chat.typing')
        : chat.peerOnline
          ? t('chat.online')
          : t('chat.offline');

  const open = chat.connection === 'open';

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: p.surface }}>
        <Header
          title={peer?.name ?? t('chat.connecting')}
          subtitle={status}
          onBack={onBack}
          right={
            <>
              {/* 전화. 상대가 접속해 있지 않으면 걸어 봐야 울리지도 않는다. */}
              <IconButton name="phone" size={18} onPress={() => void startCall(false)} disabled={!open} label={t('call.call')} />
              <IconButton name="video" size={18} onPress={() => void startCall(true)} disabled={!open} label={t('call.video')} />
              <IconButton name="search" size={19} onPress={onSearch} label={t('search.title')} />
              <IconButton name="bookmark" size={19} onPress={onLibrary} label={t('library.title')} />
              <IconButton name="sparkle" size={18} onPress={() => setMenuOpen(true)} label={t('chat.settings')} />
            </>
          }
        />
      </View>

      <Wallpaper value={me?.wallpaper}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <FlatList
            ref={list}
            data={rows}
            inverted
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            onEndReached={() => {
              if (hasOlder) void loadOlder();
            }}
            onEndReachedThreshold={1.5}
            // 찾아간 자리에서 아래로 내려오면 현재까지 이어 붙는다.
            onStartReached={() => {
              if (!atTail && hasNewer) void loadNewer();
            }}
            onStartReachedThreshold={1.5}
            onScrollToIndexFailed={(info) => {
              // 아직 그려지지 않은 자리. 가까이 가서 그려지면 다시 시도한다.
              list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 120);
            }}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            ListHeaderComponent={
              <View>
                {chat.peerTyping && (
                  <View style={st.typing}>
                    <Text style={st.edgeText}>{t('chat.typing')}</Text>
                  </View>
                )}
                {/* 아래로 더 남았을 때만. 끝까지 내려오면 저절로 사라진다. */}
                {hasNewer && (
                  <View style={st.edge}>
                    <Text style={st.edgeText}>{t('jump.moreBelow')}</Text>
                  </View>
                )}
              </View>
            }
            // 맨 위(가장 옛것). 더 있으면 가져오는 중이라고, 없으면 여기가 처음이라고 알려준다.
            ListFooterComponent={
              chat.messages.length > 0 ? (
                <View style={st.edge}>
                  {chat.loadingOlder ? (
                    <ActivityIndicator color={p.accent} />
                  ) : hasOlder ? (
                    <Text style={[st.edgeText, { color: p.accent }]} onPress={() => void loadOlder()}>
                      {t('chat.loadOlder')}
                    </Text>
                  ) : (
                    <Text style={st.edgeText}>{t('chat.beginning')}</Text>
                  )}
                </View>
              ) : null
            }
          />

          {/* 과거를 보고 있을 때. 헤매다 한 번에 돌아올 길을 둔다. */}
          {!atTail && (
            <Pressable style={st.tail} onPress={() => void backToTail()}>
              <Text style={{ color: p.onAccent, fontWeight: '800' }}>{t('jump.toTail')}</Text>
            </Pressable>
          )}

          {/* 연결이 끊겼을 때. 화면을 가리지 않게 한 줄로 띄우고, 이어지면 알아서 사라진다. */}
          {chat.connection !== 'open' && (chat.error === 'disconnected' || waking) && (
            <View style={[st.toast, { bottom: 140 }]}>
              <Text style={st.toastText}>{waking ? t('chat.wakingHint') : t('chat.disconnected')}</Text>
            </View>
          )}
          {chat.error && chat.error !== 'disconnected' && (
            <Pressable style={[st.toast, { bottom: 140 }]} onPress={chat.dismissError}>
              <Text style={[st.toastText, { color: p.danger }]}>{chat.error}</Text>
            </Pressable>
          )}
          {toast && (
            <View style={st.toast}>
              <Text style={st.toastText}>{toast.text}</Text>
            </View>
          )}

          <View style={{ paddingBottom: insets.bottom, backgroundColor: p.surface }}>
            <Composer
              peerName={peer?.name ?? ''}
              editing={editing}
              onEdit={(messageId, text) => {
                chat.editMessage(messageId, text);
                say(t('edit.saved'));
              }}
              onCancelEdit={() => setEditing(null)}
              onSend={(text, options) => {
                chat.sendMessage(text, { ...options, ...(replyTo ? { replyTo: replyTo.id } : {}) });
                setReplyTo(null);
              }}
              onTyping={chat.setTyping}
              replyTo={replyTo}
              replyName={replyTo ? (replyTo.senderId === me?.id ? (me?.name ?? '') : (peer?.name ?? '')) : ''}
              onCancelReply={() => setReplyTo(null)}
            />
          </View>
        </KeyboardAvoidingView>
      </Wallpaper>

      {menuOpen && (
        <Sheet onClose={() => setMenuOpen(false)}>
          <Row
            title={t('chat.glossary')}
            onPress={() => {
              setMenuOpen(false);
              onGlossary();
            }}
          />
          <Row
            title={t('chat.settings')}
            onPress={() => {
              setMenuOpen(false);
              onSettings();
            }}
          />
          <View style={{ height: insets.bottom + 8 }} />
        </Sheet>
      )}

      {picked && (
        <MessageActions
          canRetranslate={picked.senderId === me?.id || picked.translationStatus === 'failed'}
          canPickWord={Boolean(messageText(picked))}
          canEdit={picked.senderId === me?.id && Boolean(messageText(picked))}
          myReaction={picked.reactions?.[me?.id ?? ''] ?? null}
          onReact={(emoji) => {
            chat.react(picked.id, emoji);
            setPicked(null);
          }}
          onReply={() => {
            setReplyTo(picked);
            setPicked(null);
          }}
          onExplain={() => {
            setExplaining(picked);
            setPicked(null);
          }}
          onPickWord={() => {
            setPicking(picked);
            setPicked(null);
          }}
          onEdit={() => {
            setEditing(picked);
            setReplyTo(null);
            setPicked(null);
          }}
          onSave={() => {
            setSaving(picked);
            setPicked(null);
          }}
          onCopy={() => {
            void Clipboard.setStringAsync(picked.sourceText).catch(() => undefined);
            setPicked(null);
          }}
          onRetranslate={() => {
            chat.retranslate(picked.id);
            setPicked(null);
          }}
          onClose={() => setPicked(null)}
        />
      )}

      {photo && <PhotoViewer attachmentId={photo} onClose={() => setPhoto(null)} />}

      {saving && (
        <SaveSheet
          message={saving}
          primaryLang={primaryLang}
          savedIds={savedIds}
          onSaved={(item) => {
            onSaved(item);
            say(t('actions.saved'));
          }}
          onUnsaved={(id) => {
            onUnsaved(id);
            say(t('save.removed'));
          }}
          onClose={() => setSaving(null)}
        />
      )}

      {picking && (
        <WordPicker
          message={picking}
          initialLang={studyLangOf(picking)}
          extraLangs={extraLangs}
          onAdded={onVocabAdded}
          onClose={() => setPicking(null)}
        />
      )}

      {explaining && (
        <Explanation
          message={explaining}
          initialLang={studyLangOf(explaining)}
          onAdded={onVocabAdded}
          onClose={() => setExplaining(null)}
        />
      )}
    </View>
  );
}
