import { useEffect, useRef, useState } from 'react';
import type { Call } from '../call';
import { useT } from '../i18n';
import Icon from './Icon';

interface Props {
  call: Call;
  peerName: string;
}

/**
 * 통화 화면.
 *
 * 걸 때도 받을 때도 같은 화면이고, 아래 단추와 뒤에 깔리는 것만 달라진다.
 * 통화 중에는 화면을 덮는다 — 이때 할 일은 하나뿐이라 대화를 뒤에 비춰 둘
 * 이유가 없다.
 */
export default function CallScreen({ call, peerName }: Props) {
  const t = useT();
  const elapsed = useElapsed(call.since);
  const showRemoteVideo = call.video && call.peerCamera && call.phase === 'connected';

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
      <Media stream={call.remoteStream} className="call__remote" />

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
        {call.error === 'denied' && <p className="call__hint">{t('call.denied')}</p>}
        {call.error === 'nomic' && <p className="call__hint">{t('call.nomic')}</p>}
      </div>

      {/* 내 화면. 작게 얹어 둔다 — 내가 어떻게 보이는지만 알면 된다. */}
      {call.video && call.cameraOn && call.phase !== 'ended' && (
        <Media stream={call.localStream} className="call__me" muted />
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
            </p>
          ))}
        </div>
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
}: {
  stream: MediaStream | null;
  className: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || element.srcObject === stream) return;
    element.srcObject = stream;
    // 자동 재생이 막히는 경우가 있다. 막혀도 통화는 이어지므로 조용히 넘어간다.
    void element.play().catch(() => {});
  }, [stream]);

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
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
