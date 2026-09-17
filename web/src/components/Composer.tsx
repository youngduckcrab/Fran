import { useEffect, useRef, useState } from 'react';
import { messageText, type Attachment, type ChatMessage } from '@fran/shared';
import { useT } from '../i18n';
import Icon from './Icon';
import {
  attachmentUrl,
  canRecord,
  formatDuration,
  prepareImage,
  startRecording,
  uploadAttachment,
  type Recorder,
} from '../media';

interface Props {
  peerName: string;
  onSend: (text: string, options: { translationNote?: string; attachmentId?: string }) => void;
  onTyping: (isTyping: boolean) => void;
  /** 지금 답하고 있는 메시지. 없으면 평소처럼 보낸다. */
  replyTo: ChatMessage | null;
  /** 그 메시지를 쓴 사람의 이름. */
  replyName: string;
  onCancelReply: () => void;
}

const TYPING_IDLE_MS = 1500;

/**
 * 글·사진·음성을 보내는 아래쪽 칸.
 *
 * 사진과 음성은 보내기 전에 따로 올려 두고, 보낼 때는 그 id 만 실어 보낸다.
 * 파일을 WebSocket 으로 흘려보내면 그 사이 다른 메시지가 전부 밀린다.
 */
export default function Composer({
  peerName,
  onSend,
  onTyping,
  replyTo,
  replyName,
  onCancelReply,
}: Props) {
  const t = useT();
  const [draft, setDraft] = useState('');
  /** 이번 메시지에만 붙일 번역 지시. 보낸 뒤 비워진다. */
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [pending, setPending] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /**
   * 사진·녹음·번역 지시를 담아 두는 서랍.
   *
   * 버튼을 전부 한 줄에 늘어놓으니 작은 폰에서는 입력칸이 손가락 두 개 너비밖에
   * 남지 않았다. 평소에는 + 하나만 두고, 누를 때만 펼친다.
   */
  const [trayOpen, setTrayOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 녹음 중에는 시간이 흐르는 게 보여야 한다. 멈춘 줄 알고 한참 떠들게 되면 곤란하다.
  useEffect(() => {
    if (!recorder) return;
    const timer = setInterval(() => setElapsed(Date.now() - recorder.startedAt), 200);
    return () => clearInterval(timer);
  }, [recorder]);

  // 화면을 떠날 때 마이크가 켜진 채로 남지 않도록 한다.
  useEffect(() => () => recorder?.cancel(), [recorder]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    onTyping(value.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), TYPING_IDLE_MS);
  };

  const pickPhoto = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { blob, width, height } = await prepareImage(file);
      setPending(await uploadAttachment(blob, 'image', { width, height }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const beginRecording = async () => {
    setError(null);
    try {
      setElapsed(0);
      setRecorder(await startRecording());
    } catch {
      setError(t('composer.micDenied'));
    }
  };

  const finishRecording = async () => {
    const current = recorder;
    if (!current) return;
    setRecorder(null);
    setBusy(true);
    try {
      const { blob, durationMs } = await current.stop();
      setPending(await uploadAttachment(blob, 'audio', { durationMs }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancelRecording = () => {
    recorder?.cancel();
    setRecorder(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
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

  return (
    <>
      {replyTo && (
        <div className="replyBar">
          <span className="replyBar__bar" aria-hidden="true" />
          <span className="replyBar__body">
            <b>{t('reply.to', { name: replyName })}</b>
            <span className="replyBar__text">
              {messageText(replyTo) ||
                (replyTo.attachment?.kind === 'image' ? t('reply.photo') : t('reply.voice'))}
            </span>
          </span>
          <button
            type="button"
            className="attachBar__remove"
            onClick={onCancelReply}
            aria-label={t('reply.cancel')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {noteOpen && (
        <div className="note">
          <input
            className="note__input"
            value={note}
            autoFocus
            placeholder={t('note.placeholder')}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="note__hint">{t('note.hint')}</p>
        </div>
      )}

      {error && (
        <p className="composer__error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {busy && <p className="composer__status">{t('composer.uploading')}</p>}

      {pending && (
        <div className="attachBar">
          {pending.kind === 'image' ? (
            <img className="attachBar__thumb" src={attachmentUrl(pending.id)} alt={t('bubble.photo')} />
          ) : (
            <span className="attachBar__voice">
              <Icon name="mic" size={16} />
              {t('composer.voiceReady', { time: formatDuration(pending.durationMs ?? 0) })}
            </span>
          )}
          {pending.kind === 'image' && <span>{t('composer.photoReady')}</span>}
          <button type="button" className="attachBar__remove" onClick={() => setPending(null)}>
            {t('composer.removeAttachment')}
          </button>
        </div>
      )}

      {recorder ? (
        <div className="recording">
          <span className="recording__dot" aria-hidden="true" />
          <span className="recording__time">
            {t('composer.recording', { time: formatDuration(elapsed) })}
          </span>
          <button type="button" className="recording__cancel" onClick={cancelRecording}>
            {t('composer.cancelRecording')}
          </button>
          <button type="button" className="recording__stop" onClick={() => void finishRecording()}>
            {t('composer.sendRecording')}
          </button>
        </div>
      ) : (
        <>
          {trayOpen && (
            <div className="tray">
              <button
                type="button"
                className="tray__item"
                onClick={() => {
                  setTrayOpen(false);
                  fileRef.current?.click();
                }}
                disabled={busy}
              >
                <Icon name="image" size={22} />
                {t('composer.photo')}
              </button>

              {canRecord() && (
                <button
                  type="button"
                  className="tray__item"
                  onClick={() => {
                    setTrayOpen(false);
                    void beginRecording();
                  }}
                  disabled={busy}
                >
                  <Icon name="mic" size={22} />
                  {t('composer.record')}
                </button>
              )}

              <button
                type="button"
                className={`tray__item ${noteOpen || note ? 'is-on' : ''}`}
                onClick={() => {
                  setTrayOpen(false);
                  setNoteOpen((open) => !open);
                }}
              >
                <Icon name="pencil" size={22} />
                {t('note.button')}
              </button>
            </div>
          )}

        <form className="composer" onSubmit={submit}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="composer__file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickPhoto(file);
            }}
          />
          <button
            type="button"
            className={`composer__icon ${trayOpen ? 'is-on' : ''}`}
            onClick={() => setTrayOpen((open) => !open)}
            aria-label={t('composer.more')}
            title={t('composer.more')}
          >
            <Icon name={trayOpen ? 'close' : 'plus'} />
          </button>

          <textarea
            className="composer__input"
            rows={1}
            value={draft}
            placeholder={t('chat.sendTo', { name: peerName })}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
          />
          <button
            className="composer__send"
            type="submit"
            disabled={!draft.trim() && !pending}
            aria-label={t('chat.send')}
            title={t('chat.send')}
          >
            <Icon name="send" />
          </button>
        </form>
        </>
      )}
    </>
  );
}
