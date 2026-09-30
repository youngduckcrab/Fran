import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { messageText, type Attachment, type ChatMessage } from '@fran/shared';
import { useT } from '../web/i18n';
import Icon from '../Icon';
import { attachmentUrl, formatDuration, prepareImage, uploadFile, useVoiceRecorder } from '../media';
import { Accent, useStyles } from '../ui/kit';
import { usePalette } from '../theme';

interface Props {
  peerName: string;
  onSend: (text: string, options: { translationNote?: string; attachmentId?: string }) => void;
  onTyping: (isTyping: boolean) => void;
  /** 고치고 있는 내 메시지. 없으면 평소처럼 새로 쓴다. */
  editing: ChatMessage | null;
  onEdit: (messageId: string, text: string) => void;
  onCancelEdit: () => void;
  /** 지금 답하고 있는 메시지. 없으면 평소처럼 보낸다. */
  replyTo: ChatMessage | null;
  replyName: string;
  onCancelReply: () => void;
}

const TYPING_IDLE_MS = 1500;

/**
 * 글·사진·음성을 보내는 아래쪽 칸.
 *
 * 사진과 음성은 보내기 전에 따로 올려 두고, 보낼 때는 그 id 만 실어 보낸다.
 * 파일을 소켓으로 흘려보내면 그 사이 다른 메시지가 전부 밀린다.
 */
export default function Composer({
  peerName,
  onSend,
  onTyping,
  editing,
  onEdit,
  onCancelEdit,
  replyTo,
  replyName,
  onCancelReply,
}: Props) {
  const t = useT();
  const p = usePalette();
  const [draft, setDraft] = useState('');
  /** 이번 메시지에만 붙일 번역 지시. 보낸 뒤 비워진다. */
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [pending, setPending] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** 사진·녹음·번역 지시를 담아 두는 서랍. 평소에는 + 하나만 둔다. */
  const [trayOpen, setTrayOpen] = useState(false);
  const recorder = useVoiceRecorder();
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<TextInput | null>(null);

  const st = useStyles((c) => ({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    barBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: c.accent },
    barBody: { flex: 1 },
    barTitle: { color: c.text, fontWeight: '700', fontSize: 13 },
    barText: { color: c.textMuted, fontSize: 12 },
    note: { padding: 12, gap: 6, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border },
    noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    noteTitle: { color: c.text, fontWeight: '700' },
    noteInput: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: c.text,
      backgroundColor: c.bg,
    },
    hint: { color: c.textMuted, fontSize: 12 },
    error: { color: c.danger, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: c.surface },
    status: { color: c.textMuted, paddingHorizontal: 14, paddingVertical: 4, backgroundColor: c.surface },
    tray: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    trayItem: { alignItems: 'center', gap: 4, minWidth: 64 },
    trayIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    trayLabel: { color: c.text, fontSize: 12 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    field: {
      flex: 1,
      maxHeight: 130,
      minHeight: 42,
      borderRadius: 21,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      paddingHorizontal: 15,
      paddingTop: 10,
      paddingBottom: 10,
      color: c.text,
      fontSize: 16,
    },
    send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    thumb: { width: 44, height: 44, borderRadius: 10 },
    recording: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.danger },
    link: { color: c.accent, fontWeight: '700' },
  }));

  /** 고치기 시작하면 그 글을 입력칸에 옮겨 담는다. */
  useEffect(() => {
    if (!editing) return;
    setDraft(messageText(editing));
    input.current?.focus();
  }, [editing]);

  // 녹음 중에는 시간이 흐르는 게 보여야 한다. 멈춘 줄 알고 한참 떠들게 되면 곤란하다.
  useEffect(() => {
    if (!recorder.recording) return;
    const timer = setInterval(() => setElapsed(Date.now() - recorder.startedAt), 200);
    return () => clearInterval(timer);
  }, [recorder.recording, recorder.startedAt]);

  const changeDraft = (value: string) => {
    setDraft(value);
    onTyping(value.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), TYPING_IDLE_MS);
  };

  const handleError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const pickPhoto = async (camera: boolean) => {
    setTrayOpen(false);
    setError(null);
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      setBusy(true);
      const small = await prepareImage(asset.uri, asset.width, asset.height);
      setPending(await uploadFile(small.uri, 'image', 'image/jpeg', { width: small.width, height: small.height }));
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  };

  const beginRecording = async () => {
    setTrayOpen(false);
    setError(null);
    try {
      setElapsed(0);
      if (!(await recorder.start())) setError(t('composer.micDenied'));
    } catch (cause) {
      handleError(cause);
    }
  };

  const finishRecording = async () => {
    setBusy(true);
    try {
      const done = await recorder.stop();
      if (done) setPending(await uploadFile(done.uri, 'audio', 'audio/mp4', { durationMs: done.durationMs }));
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const text = draft.trim();

    // 고치는 중에는 글만 바꾼다. 사진·음성·번역 지시는 보낼 때 정해진 것 그대로 둔다.
    if (editing) {
      if (text) onEdit(editing.id, text);
      setDraft('');
      onCancelEdit();
      onTyping(false);
      return;
    }

    if (!text && !pending) return;

    onSend(text, {
      ...(note.trim() ? { translationNote: note.trim() } : {}),
      ...(pending ? { attachmentId: pending.id } : {}),
    });
    setDraft('');
    setNote('');
    setNoteOpen(false);
    setPending(null);
    onTyping(false);
  };

  const closeBar = (onPress: () => void, label: string) => (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={st.round}>
      <Icon name="close" size={16} color={p.text} />
    </Pressable>
  );

  const canSend = editing ? Boolean(draft.trim()) : Boolean(draft.trim()) || Boolean(pending);

  return (
    <View>
      {editing && (
        <View style={st.bar}>
          <View style={st.barBar} />
          <View style={st.barBody}>
            <Text style={st.barTitle}>{t('edit.bar')}</Text>
            <Text style={st.barText}>{t('edit.hint')}</Text>
          </View>
          {closeBar(() => {
            setDraft('');
            onCancelEdit();
            onTyping(false);
          }, t('edit.cancel'))}
        </View>
      )}

      {replyTo && !editing && (
        <View style={st.bar}>
          <View style={st.barBar} />
          <View style={st.barBody}>
            <Text style={st.barTitle}>{t('reply.to', { name: replyName })}</Text>
            <Text style={st.barText} numberOfLines={1}>
              {messageText(replyTo) || (replyTo.attachment?.kind === 'image' ? t('reply.photo') : t('reply.voice'))}
            </Text>
          </View>
          {closeBar(onCancelReply, t('reply.cancel'))}
        </View>
      )}

      {noteOpen && (
        <View style={st.note}>
          <View style={st.noteHead}>
            <Text style={st.noteTitle}>{t('note.title')}</Text>
            {closeBar(() => {
              setNote('');
              setNoteOpen(false);
            }, t('note.close'))}
          </View>
          <TextInput
            style={st.noteInput}
            value={note}
            autoFocus
            placeholder={t('note.placeholder')}
            placeholderTextColor={p.textMuted}
            onChangeText={setNote}
          />
          <Text style={st.hint}>{t('note.hint')}</Text>
        </View>
      )}

      {error ? (
        <Text style={st.error} onPress={() => setError(null)}>
          {error}
        </Text>
      ) : null}
      {busy ? <Text style={st.status}>{t('composer.uploading')}</Text> : null}

      {pending && (
        <View style={st.bar}>
          {pending.kind === 'image' ? (
            <>
              <Image source={{ uri: attachmentUrl(pending.id) }} style={st.thumb} />
              <Text style={[st.barText, { flex: 1 }]}>{t('composer.photoReady')}</Text>
            </>
          ) : (
            <View style={[st.barBody, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              <Icon name="mic" size={16} color={p.accent} />
              <Text style={st.barTitle}>{t('composer.voiceReady', { time: formatDuration(pending.durationMs ?? 0) })}</Text>
            </View>
          )}
          <Text style={st.link} onPress={() => setPending(null)}>
            {t('composer.removeAttachment')}
          </Text>
        </View>
      )}

      {recorder.recording ? (
        <View style={st.recording}>
          <View style={st.dot} />
          <Text style={[st.barTitle, { flex: 1 }]}>{t('composer.recording', { time: formatDuration(elapsed) })}</Text>
          <Text style={st.barText} onPress={() => void recorder.cancel()}>
            {t('composer.cancelRecording')}
          </Text>
          <Pressable onPress={() => void finishRecording()}>
            <Accent style={[st.send, { width: undefined, paddingHorizontal: 16 }]}>
              <Text style={{ color: p.onAccent, fontWeight: '800' }}>{t('composer.sendRecording')}</Text>
            </Accent>
          </Pressable>
        </View>
      ) : (
        <>
          {trayOpen && !editing && (
            <View style={st.tray}>
              <Pressable style={st.trayItem} onPress={() => void pickPhoto(false)} disabled={busy}>
                <View style={st.trayIcon}>
                  <Icon name="image" size={20} color={p.accent} />
                </View>
                <Text style={st.trayLabel}>{t('composer.photo')}</Text>
              </Pressable>
              <Pressable style={st.trayItem} onPress={() => void beginRecording()} disabled={busy}>
                <View style={st.trayIcon}>
                  <Icon name="mic" size={20} color={p.accent} />
                </View>
                <Text style={st.trayLabel}>{t('composer.record')}</Text>
              </Pressable>
              <Pressable
                style={st.trayItem}
                onPress={() => {
                  setTrayOpen(false);
                  setNoteOpen((open) => !open);
                }}
              >
                <View style={[st.trayIcon, (noteOpen || note) && { backgroundColor: p.accent }]}>
                  <Icon name="pencil" size={20} color={noteOpen || note ? p.onAccent : p.accent} />
                </View>
                <Text style={st.trayLabel}>{t('note.button')}</Text>
              </Pressable>
            </View>
          )}

          <View style={st.composer}>
            {!editing && (
              <Pressable
                onPress={() => setTrayOpen((open) => !open)}
                accessibilityLabel={t('composer.more')}
                style={[st.round, trayOpen && { backgroundColor: p.accentSoft }]}
              >
                <Icon name={trayOpen ? 'close' : 'plus'} size={22} color={p.text} />
              </Pressable>
            )}

            {/* 엔터는 줄을 바꾼다. 보내는 건 오른쪽 버튼이다. */}
            <TextInput
              ref={input}
              style={st.field}
              multiline
              value={draft}
              placeholder={editing ? t('edit.placeholder') : t('chat.sendTo', { name: peerName })}
              placeholderTextColor={p.textMuted}
              onChangeText={changeDraft}
            />
            <Pressable
              onPress={submit}
              disabled={!canSend}
              accessibilityLabel={editing ? t('edit.save') : t('chat.send')}
              style={{ opacity: canSend ? 1 : 0.4 }}
            >
              <Accent style={st.send}>
                <Icon name={editing ? 'check' : 'send'} size={20} color={p.onAccent} />
              </Accent>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
