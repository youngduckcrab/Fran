import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallEndReason, ClientEvent, LangCode, ServerEvent } from '@fran/shared';
import { fetchIceServers } from './api';
import { canListen, listen, type Listener } from './listen';

/**
 * 통화가 어디쯤 와 있는지.
 *
 * 'calling' 은 내가 걸고 상대를 기다리는 중, 'ringing' 은 상대가 걸어서 받을지 정하는 중.
 * 둘 다 아직 목소리는 오가지 않는다.
 */
export type CallPhase = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

export interface CallState {
  phase: CallPhase;
  /** 'ended' 일 때만. 화면에 뭐라고 적을지가 이걸로 갈린다. */
  reason?: CallEndReason;
  /** 마이크를 못 잡았을 때처럼, 사람에게 보여 줄 말. */
  error?: string;
}

/** 통화가 끝난 화면을 이만큼 두고 저절로 닫는다. */
const ENDED_LINGER_MS = 2500;

/** 화면에 남겨 두는 자막 줄 수. 지나간 말을 조금 되짚을 만큼만. */
const CAPTION_KEEP = 6;

/** 자막을 켤지 말지. 한 번 정하면 다음 통화에도 그대로 간다. */
const CAPTION_KEY = 'fran.captions';

/** 통화 자막 한 줄. 화면에 뜨는 형태 그대로. */
export interface Caption {
  id: string;
  mine: boolean;
  text: string;
  translated?: string;
  final: boolean;
}

function captionsWanted(): boolean {
  try {
    return localStorage.getItem(CAPTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 마이크 설정. 통화라서 에코와 잡음을 브라우저가 걸러 주게 둔다. */
const MIC: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export function useCall(
  emit: (event: ClientEvent) => void,
  subscribe: (fn: ((event: ServerEvent) => void) | null) => void,
  /** 내가 말하는 언어. 받아쓰기가 이 말로 듣는다. */
  myLang: LangCode,
  /** 내 id. 자막이 누구 말인지 가르는 데 쓴다. */
  myId: string,
) {
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionsOn, setCaptionsOn] = useState(captionsWanted);
  const ear = useRef<Listener | null>(null);
  /** 통화가 붙은 시각. 화면의 시계가 이걸 센다. */
  const [since, setSince] = useState<number | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const speaker = useRef<HTMLAudioElement | null>(null);
  const callId = useRef<string | null>(null);
  /** 상대가 건 전화의 offer. 받기를 누를 때까지 들고 있는다. */
  const pendingOffer = useRef<string | null>(null);
  /**
   * 아직 못 넣은 ICE 후보.
   *
   * 후보는 offer/answer 보다 먼저 도착하기도 한다. 그때 바로 넣으면 브라우저가 거부하고,
   * 그 후보를 잃으면 붙을 수 있었던 길 하나가 사라진다. 들고 있다가 나중에 넣는다.
   */
  const earlyIce = useRef<RTCIceCandidateInit[]>([]);

  /** 통화에 쓴 것들을 모두 놓아 준다. 마이크를 안 놓으면 폰에 녹음 표시가 계속 남는다. */
  const teardown = useCallback(() => {
    ear.current?.stop();
    ear.current = null;
    setCaptions([]);
    pc.current?.close();
    pc.current = null;
    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;
    if (speaker.current) {
      speaker.current.srcObject = null;
      speaker.current.remove();
      speaker.current = null;
    }
    callId.current = null;
    pendingOffer.current = null;
    earlyIce.current = [];
    setSince(null);
    setMuted(false);
  }, []);

  const finish = useCallback(
    (reason: CallEndReason, error?: string) => {
      teardown();
      setState({ phase: 'ended', reason, ...(error ? { error } : {}) });
    },
    [teardown],
  );

  /** 끝난 화면은 잠깐만 두고 저절로 닫는다. */
  useEffect(() => {
    if (state.phase !== 'ended') return;
    const timer = setTimeout(() => setState({ phase: 'idle' }), ENDED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  /** 상대 목소리가 나올 곳. 화면에 붙이지 않고 소리만 낸다. */
  const ensureSpeaker = useCallback(() => {
    if (speaker.current) return speaker.current;
    const element = document.createElement('audio');
    element.autoplay = true;
    // iOS 는 이게 없으면 소리를 전체화면 재생기로 가로챈다.
    element.setAttribute('playsinline', '');
    document.body.append(element);
    speaker.current = element;
    return element;
  }, []);

  const build = useCallback(
    async (id: string) => {
      const iceServers = await fetchIceServers();
      const connection = new RTCPeerConnection({ iceServers });

      const stream = await navigator.mediaDevices.getUserMedia(MIC);
      mic.current = stream;
      for (const track of stream.getTracks()) connection.addTrack(track, stream);

      connection.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) ensureSpeaker().srcObject = remote;
      };

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        emit({ type: 'call_ice', callId: id, candidate: JSON.stringify(event.candidate) });
      };

      connection.onconnectionstatechange = () => {
        const status = connection.connectionState;
        if (status === 'connected') {
          setSince(Date.now());
          setState({ phase: 'connected' });
        } else if (status === 'failed') {
          // 직접도 중계도 길을 못 찾은 경우. 상대에게도 알리고 끝낸다.
          emit({ type: 'call_end', callId: id, reason: 'failed' });
          finish('failed');
        }
      };

      pc.current = connection;
      return connection;
    },
    [emit, ensureSpeaker, finish],
  );

  /** 들고 있던 후보들을 이제 넣는다. */
  const drainIce = useCallback(async (connection: RTCPeerConnection) => {
    const waiting = earlyIce.current;
    earlyIce.current = [];
    for (const candidate of waiting) {
      await connection.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  /* --- 사람이 누르는 것들 --- */

  const start = useCallback(async () => {
    if (state.phase !== 'idle' && state.phase !== 'ended') return;
    const id = crypto.randomUUID();
    callId.current = id;
    setState({ phase: 'calling' });
    try {
      const connection = await build(id);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      emit({ type: 'call', callId: id, offer: JSON.stringify(connection.localDescription) });
    } catch (error) {
      finish('failed', micTrouble(error));
    }
  }, [build, emit, finish, state.phase]);

  const accept = useCallback(async () => {
    const id = callId.current;
    const offer = pendingOffer.current;
    if (!id || !offer) return;
    setState({ phase: 'connecting' });
    try {
      const connection = await build(id);
      await connection.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
      await drainIce(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      emit({ type: 'call_answer', callId: id, answer: JSON.stringify(connection.localDescription) });
    } catch (error) {
      emit({ type: 'call_end', callId: id, reason: 'failed' });
      finish('failed', micTrouble(error));
    }
  }, [build, drainIce, emit, finish]);

  const decline = useCallback(() => {
    const id = callId.current;
    if (id) emit({ type: 'call_end', callId: id, reason: 'declined' });
    finish('declined');
  }, [emit, finish]);

  const hangup = useCallback(() => {
    const id = callId.current;
    if (id) emit({ type: 'call_end', callId: id, reason: 'hangup' });
    finish('hangup');
  }, [emit, finish]);

  const toggleMute = useCallback(() => {
    const tracks = mic.current?.getAudioTracks() ?? [];
    const next = !muted;
    for (const track of tracks) track.enabled = !next;
    setMuted(next);
  }, [muted]);

  /* --- 서버에서 오는 것들 --- */

  useEffect(() => {
    subscribe((event) => {
      void (async () => {
        switch (event.type) {
          case 'call': {
            // 이미 통화 중이면 받을 수 없다. 상대가 헛되이 기다리지 않게 바로 알린다.
            if (callId.current) {
              emit({ type: 'call_end', callId: event.callId, reason: 'declined' });
              return;
            }
            callId.current = event.callId;
            pendingOffer.current = event.offer;
            setState({ phase: 'ringing' });
            return;
          }
          case 'call_answer': {
            const connection = pc.current;
            if (!connection || callId.current !== event.callId) return;
            setState({ phase: 'connecting' });
            await connection.setRemoteDescription(
              JSON.parse(event.answer) as RTCSessionDescriptionInit,
            );
            await drainIce(connection);
            return;
          }
          case 'call_ice': {
            if (callId.current !== event.callId) return;
            const candidate = JSON.parse(event.candidate) as RTCIceCandidateInit;
            const connection = pc.current;
            // 아직 상대 설명을 안 넣었으면 후보를 넣을 수 없다. 들고 있다가 나중에.
            if (!connection?.remoteDescription) {
              earlyIce.current.push(candidate);
              return;
            }
            await connection.addIceCandidate(candidate).catch(() => {});
            return;
          }
          case 'caption': {
            if (callId.current !== event.callId) return;
            // 서버는 내가 한 말도 되돌려 준다 — 번역이 붙어서. 내 말이 어떻게
            // 건너갔는지 보는 것이 이 앱을 쓰는 이유라 그대로 띄운다.
            setCaptions((previous) => merge(previous, {
              id: event.id,
              mine: event.from === myId,
              text: event.text,
              ...(event.translated ? { translated: event.translated } : {}),
              final: event.final,
            }));
            return;
          }
          case 'call_taken': {
            // 내 다른 기기가 먼저 받았다. 여기서는 그만 울린다.
            if (callId.current === event.callId) {
              teardown();
              setState({ phase: 'idle' });
            }
            return;
          }
          case 'call_end': {
            if (callId.current !== event.callId) return;
            finish(event.reason);
            return;
          }
          default:
            return;
        }
      })();
    });
    return () => subscribe(null);
  }, [drainIce, emit, finish, myId, subscribe, teardown]);

  /**
   * 통화가 붙어 있는 동안 내 말을 받아쓴다.
   *
   * 확정된 줄만 서버로 보내 번역하고, 말하는 도중의 것은 내 화면에만 띄운다.
   * 한 글자 늘 때마다 모델을 부르면 값도 값이고 자막이 덜덜 떨린다.
   */
  useEffect(() => {
    const id = callId.current;
    const live = state.phase === 'connected' || state.phase === 'connecting';
    if (!live || !captionsOn || !canListen() || !id) return;

    const ear_ = listen({
      lang: myLang,
      onLine: (text, final) => {
        // 말하는 도중의 줄은 하나로 덮어쓴다. 확정되면 그때 제 id 를 받는다.
        const lineId = final ? crypto.randomUUID() : `${id}:draft`;
        setCaptions((previous) => merge(previous, { id: lineId, mine: true, text, final }));
        if (final) {
          setCaptions((previous) => previous.filter((line) => line.id !== `${id}:draft`));
          emit({ type: 'caption', callId: id, id: lineId, text, final: true });
        }
      },
    });
    ear.current = ear_;
    return () => {
      ear_.stop();
      if (ear.current === ear_) ear.current = null;
    };
  }, [captionsOn, emit, myLang, state.phase]);

  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      const next = !on;
      try {
        localStorage.setItem(CAPTION_KEY, next ? 'on' : 'off');
      } catch {
        // 저장 못 해도 이번 통화에는 적용된다.
      }
      return next;
    });
  }, []);

  /** 창을 닫거나 새로고침할 때. 상대 화면이 계속 통화 중으로 남지 않게. */
  useEffect(() => {
    const bye = () => {
      const id = callId.current;
      if (id) emit({ type: 'call_end', callId: id, reason: 'hangup' });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [emit]);

  return {
    ...state,
    muted,
    since,
    captions,
    captionsOn,
    /** 이 기기에서 받아쓰기를 쓸 수 있는지. 못 쓰면 켜는 단추를 보여 줄 이유가 없다. */
    canCaption: canListen(),
    start,
    accept,
    decline,
    hangup,
    toggleMute,
    toggleCaptions,
  };
}

export type Call = ReturnType<typeof useCall>;

/**
 * 자막 한 줄을 목록에 얹는다.
 *
 * 같은 id 면 갈아끼운다 — 말하는 도중에 계속 고쳐지고, 번역도 나중에 따라붙는다.
 * 오래된 줄은 떨어뜨린다. 화면에 다 들어가지도 않고, 통화 기록에 이미 남아 있다.
 */
function merge(lines: Caption[], line: Caption): Caption[] {
  const at = lines.findIndex((item) => item.id === line.id);
  const next =
    at === -1
      ? [...lines, line]
      : lines.map((item, i) => (i === at ? { ...item, ...line } : item));
  return next.slice(-CAPTION_KEEP);
}

/**
 * 마이크를 못 잡은 이유.
 *
 * 거절한 것과 아예 장치가 없는 것은 사람이 할 일이 다르다. 그 밖은 뭉뚱그린다 —
 * 브라우저마다 이름이 달라서 늘어놔 봐야 알아볼 수 없다.
 */
function micTrouble(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.name === 'NotAllowedError') return 'denied';
  if (error.name === 'NotFoundError') return 'nomic';
  return undefined;
}
