import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, LangCode } from '@fran/shared';
import type { Call } from '../call';
import { useT } from '../i18n';
import { usePip } from '../pip';
import DoodleLayer from './DoodleLayer';
import CallChat from './CallChat';
import Icon from './Icon';

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

/**
 * 통화 화면.
 *
 * 걸 때도 받을 때도 같은 화면이고, 아래 단추와 뒤에 깔리는 것만 달라진다.
 * 통화 중에는 화면을 덮는다 — 이때 할 일은 하나뿐이라 대화를 뒤에 비춰 둘
 * 이유가 없다.
 */
export default function CallScreen({
  call,
  peerName,
  myId,
  peerId,
  messages,
  readingLang,
  onSend,
}: Props) {
  const t = useT();
  const elapsed = useElapsed(call.since);
  /** 내 모습을 크게 보고 있는 중인지. 작은 창을 누를 때마다 뒤집힌다. */
  const [swapped, setSwapped] = useState(false);
  const swap = useCallback(() => setSwapped((on) => !on), []);
  const [chatOpen, setChatOpen] = useState(false);
  /** 카메라가 주는 그림의 가로:세로. 작은 창이 이 비율을 따라간다. */
  const [aspect, setAspect] = useState(4 / 3);
  const pip = usePip(swap, aspect);

  const showRemoteVideo = call.video && call.peerCamera && call.phase === 'connected';
  /** 통화가 끝나면 원래대로. 다음 통화가 뒤집힌 채로 시작하면 당황스럽다. */
  useEffect(() => {
    if (call.phase === 'idle' || call.phase === 'ended') {
      setSwapped(false);
      setChatOpen(false);
    }
  }, [call.phase]);

  if (call.phase === 'idle') return null;

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

  return (
    <div
      className={`call ${call.video ? 'call--video' : ''} ${showRemoteVideo ? 'is-showing' : ''}`}
      role="dialog"
      aria-label={t('call.title')}
    >
      {/*
        상대 화면. 영상통화가 아니어도 이 자리에 붙여 둔다 — 소리가 여기서 나온다.
        엘리먼트를 없애면 상대 목소리가 아예 들리지 않는다.
      */}
      <Media
        stream={swapped ? call.localStream : call.remoteStream}
        className={`call__remote ${swapped ? 'is-mine' : ''}`}
        muted={swapped}
      />

      <div className="call__who">
        {!showRemoteVideo && (
          <div className="call__face" aria-hidden="true">
            {[...peerName][0] ?? ''}
          </div>
        )}
        <p className="call__name">{peerName}</p>
        <p className="call__line">{line()}</p>
        {call.video && !call.peerCamera && call.phase === 'connected' && (
          <p className="call__hint">{t('call.peerCameraOff')}</p>
        )}
        {call.captionsOn && call.captionsBroken && (
          <p className="call__hint">{t('call.captionsNoDevice')}</p>
        )}
        {call.error === 'denied' && <p className="call__hint">{t('call.denied')}</p>}
        {call.error === 'nomic' && <p className="call__hint">{t('call.nomic')}</p>}
      </div>

      {/*
        작은 창. 끌어서 옮기고, 오므려서 키우고, 누르면 큰 화면과 자리가 바뀐다.
        바뀐 상태에서는 여기에 상대가 들어온다.
      */}
      {call.video && call.phase !== 'ended' && (swapped || call.cameraOn) && (
        <div
          ref={pip.ref}
          className={`call__me ${pip.dragging ? 'is-dragging' : ''}`}
          style={pip.style}
          role="button"
          tabIndex={0}
          aria-label={t('call.swap')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') swap();
          }}
          {...pip.handlers}
        >
          <Media
            stream={swapped ? call.remoteStream : call.localStream}
            className={`call__meVideo ${swapped ? '' : 'is-mirrored'}`}
            muted={!swapped}
            onAspect={setAspect}
          />
        </div>
      )}

      {/*
        빈 칸.
        이름·시간은 위에, 자막·글·단추는 아래에 모이게 한다. 이게 없으면
        가운데에 흩어져서 얼굴을 가리고 읽기도 나쁘다.
      */}
      <div className="call__spacer" />

      {/* 낙서 판. 영상통화가 붙어 있을 때만. 그리는 중이 아니면 손가락을 통과시킨다. */}
      {call.video && call.phase === 'connected' && (
        <DoodleLayer doodle={call.doodle} myId={myId} peerId={peerId} />
      )}

      {/* 오간 말. 상대 말이 크게, 내 말은 작게 — 내 것은 마이크가 잡히는지 보는 용도다. */}
      {call.captionsOn && call.captions.length > 0 && (
        <div className="call__captions" aria-live="polite">
          {call.captions.map((line) => (
            <p
              key={line.id}
              className={`caption ${line.mine ? 'caption--mine' : ''} ${
                line.final ? '' : 'caption--saying'
              }`}
            >
              <span className="caption__said">{line.text}</span>
              {line.translated && <span className="caption__meaning">{line.translated}</span>}
              {line.failed && !line.translated && (
                <span className="caption__meaning caption__meaning--failed">
                  {t('call.captionFailed')}
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {call.video && call.doodle.drawing && call.doodle.strokes.length > 0 && (
        <button type="button" className="call__erase" onClick={call.doodle.clear}>
          {t('call.drawClear')}
        </button>
      )}

      {/* 통화 중에 친 글. 자막 아래, 입력칸 바로 위에 쌓인다. */}
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

      <div className="call__keys">
        {call.phase === 'ringing' ? (
          <>
            <button
              type="button"
              className="call__key call__key--hangup"
              onClick={call.decline}
              aria-label={t('call.decline')}
            >
              <Icon name="phoneOff" size={26} />
            </button>
            <button
              type="button"
              className="call__key call__key--accept"
              onClick={() => void call.accept()}
              aria-label={t('call.accept')}
            >
              <Icon name={call.video ? 'video' : 'phone'} size={26} />
            </button>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <button
              type="button"
              className={`call__key call__key--mute ${call.muted ? 'is-on' : ''}`}
              onClick={call.toggleMute}
              aria-label={t(call.muted ? 'call.unmute' : 'call.mute')}
              aria-pressed={call.muted}
            >
              <Icon name={call.muted ? 'micOff' : 'mic'} size={24} />
            </button>

            {call.video && (
              <button
                type="button"
                className={`call__key ${call.cameraOn ? '' : 'is-on'}`}
                onClick={call.toggleCamera}
                aria-label={t(call.cameraOn ? 'call.cameraOff' : 'call.cameraOn')}
                aria-pressed={!call.cameraOn}
              >
                <Icon name={call.cameraOn ? 'video' : 'videoOff'} size={24} />
              </button>
            )}

            <button
              type="button"
              className="call__key call__key--hangup"
              onClick={call.hangup}
              aria-label={t('call.hangup')}
            >
              <Icon name="phoneOff" size={26} />
            </button>

            {call.video && (
              <button
                type="button"
                className="call__key"
                onClick={() => void call.flipCamera()}
                aria-label={t('call.flip')}
              >
                <Icon name="flip" size={24} />
              </button>
            )}

            {call.video && (
              <button
                type="button"
                className={`call__key call__key--draw ${call.doodle.drawing ? 'is-on' : ''}`}
                onClick={() => call.doodle.setDrawing(!call.doodle.drawing)}
                aria-label={t(call.doodle.drawing ? 'call.drawOff' : 'call.drawOn')}
                aria-pressed={call.doodle.drawing}
              >
                <Icon name="pencil" size={22} />
              </button>
            )}

            <button
              type="button"
              className={`call__key ${chatOpen ? 'is-on' : ''}`}
              onClick={() => setChatOpen((on) => !on)}
              aria-label={t('callChat.open')}
              aria-pressed={chatOpen}
            >
              <Icon name="chat" size={22} />
            </button>

            {call.canCaption && (
              <button
                type="button"
                className={`call__key call__key--caption ${call.captionsOn ? 'is-on' : ''}`}
                onClick={call.toggleCaptions}
                aria-label={t(call.captionsOn ? 'call.captionsOff' : 'call.captionsOn')}
                aria-pressed={call.captionsOn}
              >
                <Icon name="captions" size={24} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 오가는 소리·그림을 트는 곳.
 *
 * srcObject 는 속성으로 못 넣는다. React 가 그려 준 뒤에 직접 꽂아야 한다.
 */
function Media({
  stream,
  className,
  muted,
  onAspect,
}: {
  stream: MediaStream | null;
  className: string;
  muted?: boolean;
  /** 그림이 도착하면 그 가로:세로를 알려 준다. 작은 창이 이걸로 모양을 맞춘다. */
  onAspect?: (aspect: number) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || element.srcObject === stream) return;
    element.srcObject = stream;
    // 자동 재생이 막히는 경우가 있다. 막혀도 통화는 이어지므로 조용히 넘어간다.
    void element.play().catch(() => {});
  }, [stream]);

  const report = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) onAspect?.(videoWidth / videoHeight);
  };

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      // 카메라를 앞뒤로 바꾸면 크기가 달라지기도 한다. 그때도 다시 알려 준다.
      onLoadedMetadata={report}
      onResize={report}
      {...(muted ? { muted: true } : {})}
    />
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
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
