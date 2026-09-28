import { useEffect, useState } from 'react';
import type { CallLine, CallRecord } from '@fran/shared';
import { deleteCall, fetchCallLines, fetchCalls } from '../api';
import { formatDay } from '../day';
import { useT, useUiLang } from '../i18n';
import Icon from './Icon';
import { useSpeaker } from '../speech';

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
    <section className="screen">
      <header className="screen__head">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" />
        </button>
        <h1 className="screen__title">{t('calls.title')}</h1>
      </header>

      {calls === null ? (
        <p className="screen__empty">{t('calls.loading')}</p>
      ) : calls.length === 0 ? (
        <div className="screen__empty">
          <p>{t('calls.empty')}</p>
          <p className="screen__hint">{t('calls.hint')}</p>
        </div>
      ) : (
        <ul className="calls">
          {calls.map((call) => (
            <li key={call.id} className="calls__item">
              <button
                type="button"
                className="calls__head"
                onClick={() => setOpen(open === call.id ? null : call.id)}
                aria-expanded={open === call.id}
              >
                <span className="calls__when">
                  {formatDay(call.startedAt, t, uiLang)} {clock(call.startedAt)}
                </span>
                <span className="calls__meta">
                  {/* 누가 걸었는지. 받은 전화와 건 전화를 눈으로 가른다. */}
                  {call.callerId === myId ? '↗' : '↙'} {length(call, t)} ·{' '}
                  {t('calls.lines', { n: String(call.lines) })}
                </span>
              </button>

              {open === call.id && (
                <Lines callId={call.id} myId={myId} myName={myName} peerName={peerName} />
              )}

              {open === call.id && (
                <button type="button" className="calls__delete" onClick={() => void remove(call.id)}>
                  {t('calls.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 한 통화에서 오간 말. 열었을 때만 받아온다 — 통화 하나가 수백 줄일 수 있다. */
function Lines({
  callId,
  myId,
  myName,
  peerName,
}: {
  callId: string;
  myId: string;
  myName: string;
  peerName: string;
}) {
  const t = useT();
  const speaker = useSpeaker();
  const [lines, setLines] = useState<CallLine[] | null>(null);

  useEffect(() => {
    void fetchCallLines(callId)
      .then(setLines)
      .catch(() => setLines([]));
  }, [callId]);

  if (lines === null) return <p className="calls__loading">{t('calls.loading')}</p>;

  return (
    <ol className="calls__lines">
      {lines.map((line) => {
        const mine = line.speakerId === myId;
        const translated = Object.values(line.translations)[0];
        return (
          <li key={line.id} className={`calls__line ${mine ? 'is-mine' : ''}`}>
            <span className="calls__who">{mine ? myName : peerName}</span>
            <p className="calls__said">
              {line.text}
              {speaker.supported && (
                <button
                  type="button"
                  className="bubble__speak"
                  onClick={() => speaker.toggle(line.id, line.text, line.lang)}
                  aria-label={t('bubble.listen')}
                >
                  <Icon name={speaker.speakingKey === line.id ? 'stop' : 'play'} size={11} />
                </button>
              )}
            </p>
            {translated && <p className="calls__meaning">{translated}</p>}
          </li>
        );
      })}
    </ol>
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
