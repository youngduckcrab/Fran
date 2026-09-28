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

/**
 * 말하는 도중의 자막을 상대에게 보내는 간격.
 *
 * 받아쓰기는 1초에도 여러 번 고쳐 준다. 그대로 흘리면 소켓이 시끄럽고 글자가
 * 튄다. 이 정도면 말하는 속도를 따라가면서도 읽을 만하다.
 */
const INTERIM_EVERY_MS = 250;

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
const AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * 카메라 설정.
 *
 * 지구 반대편까지 보내는 그림이다. 해상도를 욕심내면 느린 망에서 먼저 무너지는
 * 쪽은 소리라, 얼굴이 보일 만큼만 잡는다. 브라우저가 망을 보고 더 줄이기도 한다.
 */
const VIDEO: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'user',
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
  /** 이번 통화가 영상인지. 걸 때 정해지고 통화 내내 바뀌지 않는다. */
  const [video, setVideo] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  /** 상대가 자기 카메라를 켜 두었는지. 껐으면 검은 화면 대신 이름을 보여 준다. */
  const [peerCamera, setPeerCamera] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  /** 앞뒤 카메라. 바꿀 때 트랙만 갈아 끼운다. */
  const facing = useRef<'user' | 'environment'>('user');
  /** 통화가 붙은 시각. 화면의 시계가 이걸 센다. */
  const [since, setSince] = useState<number | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
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
    // 놓아 주지 않으면 통화가 끝나도 폰에 카메라·마이크 표시가 남는다.
    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;
    callId.current = null;
    pendingOffer.current = null;
    earlyIce.current = [];
    facing.current = 'user';
    setSince(null);
    setMuted(false);
    setVideo(false);
    setCameraOn(true);
    setPeerCamera(true);
    setLocalStream(null);
    setRemoteStream(null);
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

  const build = useCallback(
    async (id: string, wantsVideo: boolean) => {
      const iceServers = await fetchIceServers();
      const connection = new RTCPeerConnection({ iceServers });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO,
        video: wantsVideo ? VIDEO : false,
      });
      mic.current = stream;
      setLocalStream(stream);
      for (const track of stream.getTracks()) connection.addTrack(track, stream);

      connection.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) setRemoteStream(remote);
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
    [emit, finish],
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

  const start = useCallback(
    async (withVideo = false) => {
      if (state.phase !== 'idle' && state.phase !== 'ended') return;
      const id = crypto.randomUUID();
      callId.current = id;
      setVideo(withVideo);
      setState({ phase: 'calling' });
      try {
        const connection = await build(id, withVideo);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        emit({
          type: 'call',
          callId: id,
          offer: JSON.stringify(connection.localDescription),
          video: withVideo,
        });
      } catch (error) {
        finish('failed', micTrouble(error));
      }
    },
    [build, emit, finish, state.phase],
  );

  const accept = useCallback(async () => {
    const id = callId.current;
    const offer = pendingOffer.current;
    if (!id || !offer) return;
    setState({ phase: 'connecting' });
    try {
      const connection = await build(id, video);
      await connection.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
      await drainIce(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      emit({ type: 'call_answer', callId: id, answer: JSON.stringify(connection.localDescription) });
    } catch (error) {
      emit({ type: 'call_end', callId: id, reason: 'failed' });
      finish('failed', micTrouble(error));
    }
  }, [build, drainIce, emit, finish, video]);

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

  /**
   * 카메라를 껐다 켠다.
   *
   * 트랙만 끄면 상대에게는 검은 화면이 간다. 끊긴 것인지 끈 것인지 알 수 없으니
   * 따로 알려 준다.
   */
  const toggleCamera = useCallback(() => {
    const id = callId.current;
    const tracks = mic.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !cameraOn;
    for (const track of tracks) track.enabled = next;
    setCameraOn(next);
    if (id) emit({ type: 'call_camera', callId: id, on: next });
  }, [cameraOn, emit]);

  /**
   * 앞뒤 카메라를 바꾼다.
   *
   * 연결을 다시 맺지 않는다. 보내고 있는 트랙만 갈아 끼우면 상대 화면은
   * 끊기지 않고 그림만 바뀐다.
   */
  const flipCamera = useCallback(async () => {
    const connection = pc.current;
    const stream = mic.current;
    if (!connection || !stream) return;

    const next = facing.current === 'user' ? 'environment' : 'user';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: { ...VIDEO, facingMode: next },
      });
      const track = fresh.getVideoTracks()[0];
      if (!track) return;

      const sender = connection.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(track);

      for (const old of stream.getVideoTracks()) {
        stream.removeTrack(old);
        old.stop();
      }
      stream.addTrack(track);
      track.enabled = cameraOn;
      facing.current = next;
      // 미리보기가 새 트랙을 잡도록 같은 스트림을 새 객체로 넘긴다.
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch {
      // 카메라가 하나뿐인 기기. 그대로 둔다.
    }
  }, [cameraOn]);

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
            setVideo(event.video);
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
          case 'call_camera': {
            if (callId.current !== event.callId) return;
            setPeerCamera(event.on);
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
   * 말하는 도중의 것도 상대에게 보낸다. 다 말할 때까지 기다리면 그동안 상대
   * 화면이 비어 있어서, 듣고는 있는데 아무것도 안 뜨는 몇 초가 생긴다.
   * 번역만 다 말한 뒤에 한 번 한다 — 한 글자 늘 때마다 모델을 부르면 값도
   * 값이고 번역문이 덜덜 떨린다.
   */
  useEffect(() => {
    const id = callId.current;
    const live = state.phase === 'connected' || state.phase === 'connecting';
    if (!live || !captionsOn || !canListen() || !id) return;

    /** 지금 말하고 있는 한 줄의 id. 도중이든 끝이든 같은 id 라야 한 줄로 이어진다. */
    let lineId = crypto.randomUUID();
    let sentAt = 0;
    let sentText = '';

    const ear_ = listen({
      lang: myLang,
      onLine: (text, final) => {
        /*
         * 지금 이 줄의 id 를 값으로 붙잡아 둔다.
         *
         * setCaptions 의 갱신 함수는 나중에 돈다. lineId 를 그대로 읽게 두면 그
         * 사이에 다음 줄 id 로 바뀌어 있어서, 보낸 id 와 화면의 id 가 어긋나고
         * 같은 말이 두 줄로 남는다.
         */
        const current = lineId;
        setCaptions((previous) => merge(previous, { id: current, mine: true, text, final }));

        if (final) {
          emit({ type: 'caption', callId: id, id: current, text, final: true });
          lineId = crypto.randomUUID();
          sentAt = 0;
          sentText = '';
          return;
        }

        // 받아쓰기는 1초에도 여러 번 고쳐 준다. 그대로 흘리면 소켓만 시끄럽다.
        const now = Date.now();
        if (text === sentText || now - sentAt < INTERIM_EVERY_MS) return;
        sentAt = now;
        sentText = text;
        emit({ type: 'caption', callId: id, id: current, text, final: false });
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
    video,
    cameraOn,
    peerCamera,
    localStream,
    remoteStream,
    captions,
    captionsOn,
    /** 이 기기에서 받아쓰기를 쓸 수 있는지. 못 쓰면 켜는 단추를 보여 줄 이유가 없다. */
    canCaption: canListen(),
    start,
    accept,
    decline,
    hangup,
    toggleMute,
    toggleCamera,
    flipCamera,
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
