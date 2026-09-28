import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallEndReason, ClientEvent, ServerEvent } from '@fran/shared';
import { fetchIceServers } from './api';

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

/** 마이크 설정. 통화라서 에코와 잡음을 브라우저가 걸러 주게 둔다. */
const MIC: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export function useCall(emit: (event: ClientEvent) => void, listen: (fn: ((event: ServerEvent) => void) | null) => void) {
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [muted, setMuted] = useState(false);
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
    listen((event) => {
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
    return () => listen(null);
  }, [drainIce, emit, finish, listen, teardown]);

  /** 창을 닫거나 새로고침할 때. 상대 화면이 계속 통화 중으로 남지 않게. */
  useEffect(() => {
    const bye = () => {
      const id = callId.current;
      if (id) emit({ type: 'call_end', callId: id, reason: 'hangup' });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [emit]);

  return { ...state, muted, since, start, accept, decline, hangup, toggleMute };
}

export type Call = ReturnType<typeof useCall>;

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
