import { memo, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { LANGUAGE_NAMES, messageText, type ChatMessage, type LangCode } from '@fran/shared';
import { useT, type StringKey } from '../web/i18n';
import { hasSpeech } from '../web/speech';
import type { BubbleView } from '../web/view';
import Icon from '../Icon';
import { attachmentUrl, formatDuration } from '../media';
import { alpha, usePalette } from '../theme';
import { Accent, useStyles } from '../ui/kit';

interface Props {
  message: ChatMessage;
  mine: boolean;
  /** 내가 주로 읽는 언어. 이 언어의 번역이 크게 보인다. */
  primaryLang: LangCode;
  /** 곁들여 보고 싶은 학습 언어들. */
  extraLangs: LangCode[];
  /** 상대가 읽는 언어. 내가 보낸 메시지가 상대에게 어떻게 갔는지 보여주는 데 쓴다. */
  peerLang: LangCode;
  peerName: string;
  view: BubbleView;
  /** 보관함에서 찾아온 말풍선. 잠깐 반짝여서 어느 것인지 짚어 준다. */
  highlight?: boolean;
  speechSupported: boolean;
  speakingKey: string | null;
  failedSpeechKey: string | null;
  onSpeak: (key: string, text: string, lang: LangCode) => void;
  onRetranslate: (messageId: string, translationNote?: string) => void;
  onLongPress: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
  repliedTo?: ChatMessage | undefined;
  myId: string;
  readByPeer: boolean;
  onOpenPhoto: (attachmentId: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 이만큼 밀면 답장으로 친다. */
const REPLY_DISTANCE = 56;

function MessageBubble(props: Props) {
  const {
    message,
    mine,
    primaryLang,
    extraLangs,
    peerLang,
    peerName,
    view,
    highlight,
    speechSupported,
    speakingKey,
    failedSpeechKey,
    onSpeak,
    onLongPress,
    onReply,
    repliedTo,
    myId,
    readByPeer,
    onOpenPhoto,
    onRetranslate,
  } = props;
  const t = useT();
  const p = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [sentAsHidden, setSentAsHidden] = useState(false);

  const st = useStyles((c) => ({
    row: { paddingHorizontal: 12, marginVertical: 3, alignItems: 'flex-start' },
    rowMine: { alignItems: 'flex-end' },
    quote: {
      flexDirection: 'row',
      gap: 6,
      maxWidth: '78%',
      marginBottom: 2,
      paddingHorizontal: 6,
    },
    quoteBar: { width: 3, borderRadius: 2, backgroundColor: c.accent },
    quoteText: { color: c.textMuted, fontSize: 12, flexShrink: 1 },
    bubble: {
      maxWidth: '82%',
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 20,
      gap: 5,
    },
    theirs: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 6 },
    mineBg: { borderBottomRightRadius: 6 },
    found: { borderWidth: 2, borderColor: c.accent },
    text: { fontSize: 16, lineHeight: 22 },
    muted: { opacity: 0.6 },
    small: { fontSize: 13, lineHeight: 18 },
    lang: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, opacity: 0.7 },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' },
    speak: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: alpha(c.accent, 0.22),
    },
    note: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 6 },
    noteText: { color: c.textMuted, fontSize: 12 },
    failure: { color: c.danger, fontSize: 12, marginTop: 2, paddingHorizontal: 6 },
    retry: { color: c.accent, fontWeight: '700', fontSize: 12 },
    reactions: { flexDirection: 'row', gap: 4, marginTop: 3, paddingHorizontal: 4 },
    reaction: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    reactionMine: { borderColor: c.accent, backgroundColor: c.accentSoft },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, paddingHorizontal: 6 },
    metaText: { color: c.textMuted, fontSize: 11 },
    photo: { width: 220, borderRadius: 14, overflow: 'hidden' },
    audio: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    audioBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    notes: { gap: 2, marginTop: 2 },
  }));

  // 음성 메시지에는 사람이 타이핑한 글이 없다. 받아쓴 글이 원문 노릇을 한다.
  const own = messageText(message);
  const audio = message.attachment?.kind === 'audio' ? message.attachment : undefined;
  const image = message.attachment?.kind === 'image' ? message.attachment : undefined;

  const isSourceLanguage = message.sourceLang === primaryLang;
  const primary = message.translations[primaryLang];

  /*
   * "원문만 보기" 는 크게 보이는 줄을 번역문에서 원문으로 바꾼다. 번역은 말풍선을
   * 눌렀을 때 아래에 나온다. 내가 보낸 말은 원래 원문이 크게 보이므로 그대로다.
   */
  const sourceOnly = view === 'source' && !isSourceLanguage;
  const headline = isSourceLanguage || sourceOnly ? own : primary?.text;
  // 받아쓴 글은 늘 보여준다. 뭐라고 말했는지가 이 앱에서 가장 배울 거리가 많은 부분이다.
  const showSource = !isSourceLanguage && !sourceOnly && (view === 'both' || expanded || Boolean(audio));
  const showTranslation = sourceOnly && expanded && Boolean(primary?.text);

  const extras = extraLangs
    .filter((lang) => lang !== primaryLang && lang !== message.sourceLang)
    .map((lang) => message.translations[lang])
    .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation));

  const notes = expanded ? (primary?.notes ?? []) : [];

  // 내가 보낸 말이 상대에게 어떻게 도착했는지. 기본은 펼침이고, 말풍선을 누르면 접힌다.
  const sentAs = mine && peerLang !== message.sourceLang ? message.translations[peerLang] : undefined;

  const sourceKey = `${message.id}:source`;
  const sentAsKey = `${message.id}:sentAs`;
  const primaryKey = `${message.id}:primary`;
  const canHearSource = speechSupported && !mine && hasSpeech(own);
  const sourceOnScreen = showSource || sourceOnly;

  const textColor = mine ? p.onAccent : p.text;

  /** 소리 버튼. 줄마다 하나씩 붙어서 그 줄에 적힌 말을 읽는다. */
  const speaker = (key: string, text: string, lang: LangCode, what: 'source' | 'translation') => {
    if (!hasSpeech(text)) return null;
    const on = speakingKey === key;
    const label = on ? t('bubble.stop') : what === 'source' ? t('bubble.listenSource') : t('bubble.listenTranslation');
    return (
      <Pressable
        accessibilityLabel={label}
        hitSlop={8}
        onPress={() => onSpeak(key, text, lang)}
        style={[st.speak, on && { backgroundColor: p.accent }]}
      >
        <Icon name={on ? 'stop' : 'play'} size={12} color={on ? p.onAccent : mine ? p.onAccent : p.accent} />
      </Pressable>
    );
  };

  /*
   * 오른쪽으로 밀면 답장. 세로 스크롤과 다투지 않도록 가로로 확실히 움직일 때만 잡는다.
   */
  const offset = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const latest = useRef({ message, onReply });
  latest.current = { message, onReply };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderMove: (_e, g) => {
          const dx = Math.max(0, Math.min(g.dx, REPLY_DISTANCE * 1.4));
          offset.setValue(dx);
          armed.current = dx >= REPLY_DISTANCE;
        },
        onPanResponderRelease: () => {
          if (armed.current) latest.current.onReply(latest.current.message);
          armed.current = false;
          Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [offset],
  );

  const bubbleBody = (
    <>
      {image && (
        <Pressable onPress={() => onOpenPhoto(image.id)}>
          <Image
            source={{ uri: attachmentUrl(image.id) }}
            style={[
              st.photo,
              { aspectRatio: image.width && image.height ? image.width / image.height : 1 },
            ]}
            contentFit="cover"
            accessibilityLabel={t('bubble.photo')}
          />
        </Pressable>
      )}

      {audio && <AudioLine id={audio.id} durationMs={audio.durationMs} color={textColor} label={t('bubble.voice')} />}

      {headline ? (
        <View style={st.line}>
          <Text style={[st.text, { color: textColor }]}>{headline}</Text>
          {/* 크게 보이는 줄에 맞춰 읽어준다 — 원문 줄이면 원문의 언어로. */}
          {sourceOnly
            ? canHearSource && speaker(sourceKey, headline, message.sourceLang, 'source')
            : speechSupported && !isSourceLanguage && speaker(primaryKey, headline, primaryLang, 'translation')}
        </View>
      ) : message.translationStatus === 'failed' ? (
        <Text style={[st.text, st.muted, { color: textColor }]}>{own}</Text>
      ) : own ? (
        <Text style={[st.text, st.muted, { color: textColor }]}>{t('bubble.translating')}</Text>
      ) : null}

      {sentAs && (
        <View>
          <Pressable onPress={() => setSentAsHidden((v) => !v)}>
            <Text style={[st.lang, { color: textColor }]}>
              {t('bubble.sentAs', { name: peerName })}
              {sentAsHidden ? ' ▾' : ' ▴'}
            </Text>
          </Pressable>
          {!sentAsHidden && (
            <View style={st.line}>
              <Text style={[st.small, { color: textColor }]}>{sentAs.text}</Text>
              {speechSupported && speaker(sentAsKey, sentAs.text, peerLang, 'translation')}
            </View>
          )}
          {failedSpeechKey === sentAsKey && (
            <Text style={[st.small, { color: textColor }]}>
              {t('bubble.noVoice', { lang: LANGUAGE_NAMES[peerLang] })}
            </Text>
          )}
        </View>
      )}

      {audio?.transcriptStatus === 'pending' && (
        <Text style={[st.small, st.muted, { color: textColor }]}>{t('bubble.transcribing')}</Text>
      )}
      {audio?.transcriptStatus === 'failed' && !own && (
        <Text style={[st.small, { color: textColor }]}>
          {t('bubble.transcribeFailed')}{' '}
          <Text style={st.retry} onPress={() => onRetranslate(message.id)}>
            {t('bubble.retry')}
          </Text>
        </Text>
      )}

      {showSource && own ? (
        <View>
          <Text style={[st.lang, { color: textColor }]}>
            {audio ? t('bubble.transcript') : LANGUAGE_NAMES[message.sourceLang]}
          </Text>
          <View style={st.line}>
            <Text style={[st.small, { color: textColor }]}>{own}</Text>
            {canHearSource && speaker(sourceKey, own, message.sourceLang, 'source')}
          </View>
        </View>
      ) : null}

      {showTranslation && primary ? (
        <View>
          <Text style={[st.lang, { color: textColor }]}>{LANGUAGE_NAMES[primaryLang]}</Text>
          <View style={st.line}>
            <Text style={[st.small, { color: textColor }]}>{primary.text}</Text>
            {speechSupported && speaker(primaryKey, primary.text, primaryLang, 'translation')}
          </View>
        </View>
      ) : null}

      {expanded &&
        extras.map((translation) => (
          <View key={translation.lang}>
            <Text style={[st.lang, { color: textColor }]}>{LANGUAGE_NAMES[translation.lang]}</Text>
            <Text style={[st.small, { color: textColor }]}>{translation.text}</Text>
          </View>
        ))}

      {notes.length > 0 && (
        <View style={st.notes}>
          {notes.map((note) => (
            <Text key={note.term} style={[st.small, { color: textColor }]}>
              <Text style={{ fontWeight: '800' }}>{note.term}</Text> — {note.meaning}
            </Text>
          ))}
        </View>
      )}
    </>
  );

  const bubbleStyle = [st.bubble, mine ? st.mineBg : st.theirs, highlight && st.found];

  return (
    <View style={[st.row, mine && st.rowMine]}>
      {repliedTo && (
        <View style={st.quote}>
          <View style={st.quoteBar} />
          <Text style={st.quoteText} numberOfLines={2}>
            {messageText(repliedTo) || (repliedTo.attachment?.kind === 'image' ? t('reply.photo') : t('reply.voice'))}
          </Text>
        </View>
      )}

      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: offset }], maxWidth: '100%' }}>
        <Pressable
          onPress={() => {
            // 내 말풍선을 누르면 상대에게 간 번역을 접었다 편다. 받은 말풍선은 원문을 보여준다.
            if (sentAs) setSentAsHidden((v) => !v);
            else setExpanded((v) => !v);
          }}
          onLongPress={() => onLongPress(message)}
          delayLongPress={350}
        >
          {mine ? <Accent style={bubbleStyle}>{bubbleBody}</Accent> : <View style={bubbleStyle}>{bubbleBody}</View>}
        </Pressable>
      </Animated.View>

      {mine && message.translationNote ? (
        <View style={st.note}>
          <Icon name="pencil" size={12} color={p.textMuted} />
          <Text style={st.noteText}>{message.translationNote}</Text>
        </View>
      ) : null}

      {message.translationStatus === 'failed' && (
        <Text style={st.failure}>
          {message.translationErrorCode
            ? t(`error.${message.translationErrorCode}` as StringKey)
            : (message.translationError ?? t('bubble.failed'))}{' '}
          <Text style={st.retry} onPress={() => onRetranslate(message.id)}>
            {t('bubble.retry')}
          </Text>
        </Text>
      )}

      {canHearSource && failedSpeechKey === sourceKey && (
        <Text style={st.failure}>{t('bubble.noVoice', { lang: LANGUAGE_NAMES[message.sourceLang] })}</Text>
      )}

      {message.reactions && Object.keys(message.reactions).length > 0 && (
        <View style={st.reactions}>
          {Object.entries(message.reactions).map(([userId, emoji]) => (
            <View key={userId} style={[st.reaction, userId === myId && st.reactionMine]}>
              <Text>{emoji}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={st.meta}>
        {canHearSource && !sourceOnScreen && speaker(sourceKey, own, message.sourceLang, 'source')}
        {message.editedAt ? <Text style={st.metaText}>{t('edit.mark')}</Text> : null}
        <Text style={st.metaText}>{formatTime(message.createdAt)}</Text>
        {/* 내가 보낸 것에만. 체크 하나는 보냈다, 둘은 상대가 읽었다. */}
        {mine && (
          <View accessibilityLabel={readByPeer ? t('bubble.read') : t('bubble.sent')}>
            <Icon name={readByPeer ? 'checks' : 'check'} size={14} color={readByPeer ? p.accent : p.textMuted} />
          </View>
        )}
      </View>
    </View>
  );
}

/** 음성 메시지 재생 줄. 누르기 전에는 내려받지 않는다. */
function AudioLine({
  id,
  durationMs,
  color,
  label,
}: {
  id: string;
  durationMs: number | undefined;
  color: string;
  label: string;
}) {
  const p = usePalette();
  const player = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (!player.current) {
      const created = createAudioPlayer({ uri: attachmentUrl(id) });
      created.addListener('playbackStatusUpdate', (status) => {
        setPlaying(status.playing);
        if (status.didJustFinish) created.seekTo(0);
      });
      player.current = created;
    }
    const current = player.current;
    if (current.playing) current.pause();
    else current.play();
  };

  return (
    <Pressable onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: alpha(p.accent, 0.25),
        }}
      >
        <Icon name={playing ? 'stop' : 'play'} size={14} color={color} />
      </View>
      <Text style={{ color, fontSize: 13 }}>
        {label}
        {durationMs ? ` · ${formatDuration(durationMs)}` : ''}
      </Text>
    </Pressable>
  );
}

export default memo(MessageBubble);
