import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, Text, Vibration, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage, LangCode } from '@fran/shared';
import type { Call } from '../web/call';
import { useT } from '../web/i18n';
import Icon, { type IconName } from '../Icon';
import { usePip } from '../callPip';
import { ensureCallPermissions } from '../permissions';
import DoodleLayer from './DoodleLayer';
import CallChat from './CallChat';

interface Props {
  call: Call;
  peerName: string;
  myId: string;
  peerId: string;
  /** 통화 중에 오간 글. 평소 채팅 길을 그대로 탄다. */
  messages: ChatMessage[];
  readingLang: LangCode;
  onSend: (text: string) => void;
}

/** 웹의 MediaStream 타입으로 들어오지만 앱에서는 react-native-webrtc 의 것이다. */
function streamUrl(stream: MediaStream | null): string | undefined {
  return stream ? (stream as unknown as { toURL: () => string }).toURL() : undefined;
}

/**
 * 통화 화면.
 *
 * 걸 때도 받을 때도 같은 화면이고, 아래 단추와 뒤에 깔리는 것만 달라진다.
 * 통화 중에는 화면을 덮는다 — 이때 할 일은 하나뿐이라 대화를 뒤에 비춰 둘 이유가 없다.
 */
export default function CallScreen({ call, peerName, myId, peerId, messages, readingLang, onSend }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const elapsed = useElapsed(call.since);
  /** 내 모습을 크게 보고 있는 중인지. 작은 창을 누를 때마다 뒤집힌다. */
  const [swapped, setSwapped] = useState(false);
  const swap = useCallback(() => setSwapped((on) => !on), []);
  const [chatOpen, setChatOpen] = useState(false);
  const pip = usePip(swap);

  const active = call.phase !== 'idle';
  const showRemoteVideo = call.video && call.peerCamera && call.phase === 'connected';

  /** 통화가 끝나면 원래대로. 다음 통화가 뒤집힌 채로 시작하면 당황스럽다. */
  useEffect(() => {
    if (call.phase === 'idle' || call.phase === 'ended') {
      setSwapped(false);
      setChatOpen(false);
    }
  }, [call.phase]);

  // 통화 중에는 화면이 꺼지지 않게.
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync('call');
    return () => {
      void deactivateKeepAwake('call');
    };
  }, [active]);

  // 전화가 오는 동안 진동. 앱이 꺼져 있을 때는 푸시 알림이 대신 울린다.
  useEffect(() => {
    if (call.phase !== 'ringing') return;
    Vibration.vibrate([0, 600, 900], true);
    return () => Vibration.cancel();
  }, [call.phase]);

  if (!active) return null;

  const line = () => {
    switch (call.phase) {
      case 'calling':
        return t(call.video ? 'call.callingVideo' : 'call.calling');
      case 'ringing':
        return t(call.video ? 'call.incomingVideo' : 'call.incoming');
      case 'connecting':
        return t('call.connecting');
      case 'connected':
        return elapsed;
      case 'ended':
        return t(endedKey(call));
      default:
        return '';
    }
  };

  const accept = async () => {
    if (await ensureCallPermissions(call.video)) void call.accept();
    else call.decline();
  };

  const bigStream = swapped ? call.localStream : call.remoteStream;
  const smallStream = swapped ? call.remoteStream : call.localStream;
  const showPip = call.video && call.phase !== 'ended' && (swapped || call.cameraOn) && Boolean(smallStream);

  const Key = ({
    icon,
    onPress,
    label,
    on,
    tone,
    size = 24,
  }: {
    icon: IconName;
    onPress: () => void;
    label: string;
    on?: boolean;
    tone?: 'hangup' | 'accept';
    size?: number;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          tone === 'hangup' ? '#ff4d67' : tone === 'accept' ? '#37c98b' : on ? '#ff9ec0' : 'rgba(255,255,255,0.18)',
      }}
    >
      <Icon name={icon} size={size} color={on && !tone ? '#2a1a33' : '#fff'} />
    </Pressable>
  );

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: '#17121f' }}>
        {/* 상대 화면. 영상통화일 때만 그림이 필요하다. 소리는 화면 없이도 난다. */}
        {call.video && bigStream && (
          <RTCView
            streamURL={streamUrl(bigStream) ?? ''}
            objectFit="cover"
            mirror={swapped}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
        )}

        <View style={{ paddingTop: insets.top + 24, alignItems: 'center', gap: 6 }} pointerEvents="none">
          {!showRemoteVideo && (
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: '#ff9ec0',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
              }}
            >
              <Text style={{ color: '#2a1a33', fontSize: 40, fontWeight: '800' }}>{[...peerName][0] ?? ''}</Text>
            </View>
          )}
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 }}>
            {peerName}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 }}>
            {line()}
          </Text>
          {call.video && !call.peerCamera && call.phase === 'connected' && (
            <Text style={{ color: 'rgba(255,255,255,0.75)' }}>{t('call.peerCameraOff')}</Text>
          )}
          {call.captionsOn && call.captionsBroken && (
            <Text style={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center', paddingHorizontal: 24 }}>
              {t('call.captionsNoDevice')}
            </Text>
          )}
          {call.error === 'denied' && <Text style={{ color: '#ffb3c0' }}>{t('call.denied')}</Text>}
          {call.error === 'nomic' && <Text style={{ color: '#ffb3c0' }}>{t('call.nomic')}</Text>}
        </View>

        {/* 빈 칸. 이름·시간은 위에, 자막·글·단추는 아래에 모이게 한다. */}
        <View style={{ flex: 1 }} />

        {/* 낙서 판. 영상통화가 붙어 있을 때만. 그리는 중이 아니면 손가락을 통과시킨다. */}
        {call.video && call.phase === 'connected' && <DoodleLayer doodle={call.doodle} myId={myId} peerId={peerId} />}

        {/* 작은 창. 끌어서 옮기고, 오므려서 키우고, 누르면 큰 화면과 자리가 바뀐다. */}
        {showPip && smallStream && (
          <View style={[pip.style, { borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' }]} {...pip.panHandlers}>
            <RTCView
              streamURL={streamUrl(smallStream) ?? ''}
              objectFit="cover"
              mirror={!swapped}
              zOrder={1}
              style={{ flex: 1 }}
            />
          </View>
        )}

        <KeyboardAvoidingView behavior="padding" style={{ paddingBottom: insets.bottom + 12 }}>
          {/* 오간 말. 상대 말이 크게, 내 말은 작게 — 내 것은 마이크가 잡히는지 보는 용도다. */}
          {call.captionsOn && call.captions.length > 0 && (
            <View style={{ paddingHorizontal: 14, gap: 6, marginBottom: 8 }}>
              {call.captions.map((c) => (
                <View
                  key={c.id}
                  style={{
                    alignSelf: c.mine ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                    backgroundColor: 'rgba(20,17,26,0.72)',
                    borderRadius: 14,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    opacity: c.final ? 1 : 0.8,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: c.mine ? 13 : 16 }}>{c.text}</Text>
                  {c.translated ? (
                    <Text style={{ color: '#ffc4da', fontSize: c.mine ? 14 : 18, fontWeight: '700', marginTop: 2 }}>
                      {c.translated}
                    </Text>
                  ) : null}
                  {c.failed && !c.translated ? (
                    <Text style={{ color: '#ffb3c0', fontSize: 12 }}>{t('call.captionFailed')}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {call.video && call.doodle.drawing && call.doodle.strokes.length > 0 && (
            <Pressable
              onPress={call.doodle.clear}
              style={{ alignSelf: 'center', marginBottom: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(20,17,26,0.75)' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{t('call.drawClear')}</Text>
            </Pressable>
          )}

          {/* 통화 중에 친 글. 자막 아래, 단추 바로 위에 쌓인다. */}
          {call.phase === 'connected' && (
            <CallChat
              messages={messages}
              myId={myId}
              readingLang={readingLang}
              onSend={onSend}
              open={chatOpen}
              onClose={() => setChatOpen(false)}
            />
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingHorizontal: 12 }}>
            {call.phase === 'ringing' ? (
              <>
                <Key icon="phoneOff" tone="hangup" label={t('call.decline')} onPress={call.decline} size={26} />
                <Key icon={call.video ? 'video' : 'phone'} tone="accept" label={t('call.accept')} onPress={() => void accept()} size={26} />
              </>
            ) : call.phase === 'ended' ? null : (
              <>
                <Key
                  icon={call.muted ? 'micOff' : 'mic'}
                  on={call.muted}
                  label={t(call.muted ? 'call.unmute' : 'call.mute')}
                  onPress={call.toggleMute}
                />
                {call.video && (
                  <Key
                    icon={call.cameraOn ? 'video' : 'videoOff'}
                    on={!call.cameraOn}
                    label={t(call.cameraOn ? 'call.cameraOff' : 'call.cameraOn')}
                    onPress={call.toggleCamera}
                  />
                )}
                <Key icon="phoneOff" tone="hangup" label={t('call.hangup')} onPress={call.hangup} size={26} />
                {call.video && <Key icon="flip" label={t('call.flip')} onPress={() => void call.flipCamera()} />}
                {call.video && (
                  <Key
                    icon="pencil"
                    on={call.doodle.drawing}
                    label={t(call.doodle.drawing ? 'call.drawOff' : 'call.drawOn')}
                    onPress={() => call.doodle.setDrawing(!call.doodle.drawing)}
                    size={22}
                  />
                )}
                <Key icon="chat" on={chatOpen} label={t('callChat.open')} onPress={() => setChatOpen((on) => !on)} size={22} />
                {call.canCaption && (
                  <Key
                    icon="captions"
                    on={call.captionsOn}
                    label={t(call.captionsOn ? 'call.captionsOff' : 'call.captionsOn')}
                    onPress={call.toggleCaptions}
                  />
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** 끝난 이유에 맞는 문구. */
function endedKey(call: Call): 'call.ended' | 'call.declined' | 'call.missed' | 'call.failed' {
  switch (call.reason) {
    case 'declined':
      return 'call.declined';
    case 'missed':
      return 'call.missed';
    case 'failed':
      return 'call.failed';
    default:
      return 'call.ended';
  }
}

/** 통화 시간. 1분이 안 되면 초만, 넘으면 분:초. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (since === null) return '';
  const total = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
