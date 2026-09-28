import { useEffect, useState } from 'react';
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
 * 걸 때도 받을 때도 같은 화면이고, 아래 단추만 달라진다. 통화 중에는 화면을
 * 덮는다 — 이때 할 일은 하나뿐이라 대화를 뒤에 비춰 둘 이유가 없다.
 */
export default function CallScreen({ call, peerName }: Props) {
  const t = useT();
  const elapsed = useElapsed(call.since);

  if (call.phase === 'idle') return null;

  const line = () => {
    switch (call.phase) {
      case 'calling':
        return t('call.calling');
      case 'ringing':
        return t('call.incoming');
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
    <div className="call" role="dialog" aria-label={t('call.title')}>
      <div className="call__who">
        {/* 얼굴 사진이 없으니 이름 첫 글자로. 빈 화면을 덜 허전하게. */}
        <div className="call__face" aria-hidden="true">
          {[...peerName][0] ?? ''}
        </div>
        <p className="call__name">{peerName}</p>
        <p className="call__line">{line()}</p>
        {call.error === 'denied' && <p className="call__hint">{t('call.denied')}</p>}
        {call.error === 'nomic' && <p className="call__hint">{t('call.nomic')}</p>}
      </div>

      {/* 오간 말. 상대 말이 크게, 내 말은 작게 — 내 것은 마이크가 잡히는지 보는 용도다. */}
      {call.captionsOn && call.captions.length > 0 && (
        <div className="call__captions" aria-live="polite">
          {call.captions.map((line) => (
            <p key={line.id} className={`caption ${line.mine ? 'caption--mine' : ''}`}>
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
              <Icon name="phone" size={26} />
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
            <button
              type="button"
              className="call__key call__key--hangup"
              onClick={call.hangup}
              aria-label={t('call.hangup')}
            >
              <Icon name="phoneOff" size={26} />
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
