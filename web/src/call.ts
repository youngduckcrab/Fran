import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CallEndReason,
  ClientEvent,
  InterpretStatus,
  LangCode,
  ServerEvent,
  TranslationErrorCode,
} from '@fran/shared';
import { fetchIceServers } from './api';
import { canListen, isApple, listen, type Listener } from './listen';
import { primeSpeech, speakLine } from './speech';
import { canInterpret, createPlayer, tapMic, unlockAudio, type VoicePlayer } from './pcm';
import { useDoodle } from './doodle';

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

/**
 * 상대 말을 소리로 어떻게 들을지.
 *
 * 'off' 는 상대 목소리 그대로. 'read' 는 자막 번역을 폰 목소리(TTS)로 읽어 준다.
 * 'live' 는 말 자체를 Gemini 가 소리째 옮겨 들려준다(통역 음성). 둘은 함께 켜지 않는다 —
 * 같은 말이 두 목소리로 겹쳐 나온다.
 */
export type CallVoice = 'off' | 'read' | 'live';

/** 한 번 고르면 다음 통화에도 그대로 간다. */
const VOICE_KEY = 'fran.callVoice';

/**
 * 번역을 소리로 내는 동안 상대 목소리를 이만큼으로 줄인다.
 *
 * 아예 끄지는 않는다. 웃음이나 맞장구까지 사라지면 통화가 아니라 녹음을 듣는 것 같다.
 */
const DUCK_VOLUME = 0.2;

/**
 * 다 읽고 나서 이만큼 더 기다렸다가 원래대로 돌린다.
 *
 * 합성음 끝자락이 스피커에서 마이크로 되돌아 들어가면 내 받아쓰기가 그걸 내 말로 적는다.
 */
const DUCK_TAIL_MS = 400;

/**
 * 읽을 번역이 이보다 많이 밀리면 오래된 것은 건너뛴다.
 * 지나간 말을 몇십 초 뒤에 듣는 것은 대화에 도움이 안 된다. 화면 자막에는 그대로 남는다.
 */
const READ_BACKLOG = 2;

/** 통역 음성이 지금 어디쯤인지. 'off' 는 꺼져 있거나 통화 중이 아닌 것. */
export type LiveStatus = 'off' | InterpretStatus;

/**
 * 통역에 보낼 내 말소리의 크기 문턱(RMS, 0~1).
 *
 * 조용할 때까지 다 보내면 무료 한도를 빈 소리로 깎는다. 이 위로 올라오면 말하기
 * 시작한 것으로 본다. 통화 마이크는 잡음 제거·자동 크기 조절을 거친 소리라 낮게 잡아도 된다.
 */
const SPEECH_LEVEL = 0.012;

/** 말이 시작되기 직전 소리도 함께 보낸다(토막 수, 100ms 씩). 첫 음절이 잘리지 않게. */
const PREROLL_CHUNKS = 3;

/** 이만큼 조용하면 말이 끝난 것으로 보고 끊는다(토막 수). 숨 고르는 틈에 끊지 않을 만큼. */
const HANGOVER_CHUNKS = 8;

function voiceWanted(): CallVoice {
  try {
    const saved = localStorage.getItem(VOICE_KEY);
    if (saved === 'read') return 'read';
    if (saved === 'live' && canInterpret()) return 'live';
    return 'off';
  } catch {
    return 'off';
  }
}

/** 통화 자막 한 줄. 화면에 뜨는 형태 그대로. */
export interface Caption {
  id: string;
  mine: boolean;
  text: string;
  translated?: string;
  /** 번역이 끝내 안 온 줄. 원문만 남는다. */
  failed?: boolean;
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
  /**
   * 상대 말을 옮겨 받는 언어. 번역을 소리로 읽을 때 이 말의 목소리를 쓴다.
   * 서버가 번역문에 언어를 붙여 주지만, 그걸 모르는 예전 서버와도 맞물리게 둔다.
   */
  hearLang: LangCode = myLang,
) {
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionsOn, setCaptionsOn] = useState(captionsWanted);
  const ear = useRef<Listener | null>(null);
  const [voice, setVoiceState] = useState<CallVoice>(voiceWanted);
  /** 소켓 콜백은 한 번만 걸린다. 지금 값을 거기서 읽으려고 따로 둔다. */
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const hearLangRef = useRef(hearLang);
  hearLangRef.current = hearLang;
  /**
   * 번역을 소리로 내고 있는 중인지.
   *
   * 그동안 상대 목소리를 줄이고 내 받아쓰기는 쉰다. 쉬지 않으면 스피커에서 나온
   * 번역을 내 말로 받아 적어 상대에게 보낸다.
   */
  const [speaking, setSpeaking] = useState(false);
  /** 통역 음성이 어디쯤인지와, 실패했다면 왜인지. */
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('off');
  const [liveError, setLiveError] = useState<TranslationErrorCode | null>(null);
  /** 옮겨 온 소리를 트는 중인지. 읽어 주기처럼 이 동안 상대 목소리를 줄이고 받아쓰기는 쉰다. */
  const [playing, setPlaying] = useState(false);
  const player = useRef<VoicePlayer | null>(null);
  const playingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 상대가 내 말을 통역으로 듣고 있는지. 그동안 내 마이크 소리를 서버로 보낸다. */
  const [peerListening, setPeerListening] = useState(false);
  /**
   * 번역이나 통역을 소리로 내고 있는 중.
   *
   * 내 마이크에 그 소리가 다시 들어가면 받아쓰기는 그걸 내 말로 적고, 통역은 그걸
   * 다시 옮겨 상대에게 되돌려 보낸다. 이 동안은 둘 다 쉰다.
   */
  const busy = speaking || playing;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  /** 읽을 차례를 기다리는 번역. */
  const readQueue = useRef<{ text: string; lang: LangCode }[]>([]);
  /** 지금 읽고 있는 줄을 멈추는 함수. 읽고 있지 않으면 null. */
  const stopLine = useRef<(() => void) | null>(null);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 이번 통화가 영상인지. 걸 때 정해지고 통화 내내 바뀌지 않는다. */
  const [video, setVideo] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  /** 상대가 자기 카메라를 켜 두었는지. 껐으면 검은 화면 대신 이름을 보여 준다. */
  const [peerCamera, setPeerCamera] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  /** 앞뒤 카메라. 바꿀 때 트랙만 갈아 끼운다. */
  const facing = useRef<'user' | 'environment'>('user');
  /*
   * 낙서 쪽 함수들을 담아 두는 곳.
   *
   * 소켓을 듣는 effect 는 통화가 붙는 동안 한 번만 걸려야 한다. 낙서 함수를 그
   * 목록에 직접 넣으면 획을 그을 때마다 소켓을 다시 걸게 되고, 그 사이 오는
   * 신호를 놓친다.
   */
  const receiveDraw = useRef<((id: string, points: number[]) => void) | null>(null);
  const wipeDoodle = useRef<(() => void) | null>(null);
  /** 이 기기가 받아쓰기를 끝내 못 한 경우. 켜 둔 사람에게 왜 안 되는지 알려 준다. */
  const [captionsBroken, setCaptionsBroken] = useState(false);
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

  /** 낙서. 통화가 끝나면 함께 지워진다. */
  const doodle = useDoodle(emit, callId.current);

  /* --- 번역을 소리로 읽어 주기 --- */

  /** 읽던 것도, 기다리던 것도 모두 그만둔다. */
  const stopReading = useCallback(() => {
    readQueue.current = [];
    stopLine.current?.();
    stopLine.current = null;
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = null;
    setSpeaking(false);
  }, []);

  /** 다음 줄을 읽는다. 더 없으면 잠깐 뒤에 상대 목소리를 되돌린다. */
  const readNext = useCallback(() => {
    const next = readQueue.current.shift();
    if (!next) {
      stopLine.current = null;
      quietTimer.current = setTimeout(() => {
        quietTimer.current = null;
        setSpeaking(false);
      }, DUCK_TAIL_MS);
      return;
    }
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = null;
    setSpeaking(true);
    stopLine.current = speakLine(next.text, next.lang, readNext);
  }, []);

  /** 번역 한 줄을 읽을 차례에 넣는다. 읽고 있지 않았으면 바로 읽는다. */
  const read = useCallback(
    (text: string, lang: LangCode) => {
      readQueue.current.push({ text, lang });
      if (readQueue.current.length > READ_BACKLOG) {
        readQueue.current = readQueue.current.slice(-READ_BACKLOG);
      }
      if (!stopLine.current) readNext();
    },
    [readNext],
  );

  /* --- 통역 음성 --- */

  /** 틀던 통역 소리를 버린다. 틀개는 그대로 둔다 — 다음 소리가 오면 이어 쓴다. */
  const stopPlaying = useCallback(() => {
    if (playingTimer.current) clearTimeout(playingTimer.current);
    playingTimer.current = null;
    setPlaying(false);
  }, []);

  /** 옮겨 온 소리 한 토막을 튼다. 다 틀 때까지 상대 목소리를 줄인다. */
  const playVoice = useCallback((pcm: string, rate: number) => {
    const out = player.current;
    if (!out) return;
    const ahead = out.play(pcm, rate);
    setPlaying(true);
    if (playingTimer.current) clearTimeout(playingTimer.current);
    playingTimer.current = setTimeout(() => {
      playingTimer.current = null;
      setPlaying(false);
    }, ahead * 1000 + DUCK_TAIL_MS);
  }, []);

  /** 통화에 쓴 것들을 모두 놓아 준다. 마이크를 안 놓으면 폰에 녹음 표시가 계속 남는다. */
  const teardown = useCallback(() => {
    ear.current?.stop();
    ear.current = null;
    stopReading();
    stopPlaying();
    setPeerListening(false);
    setLiveStatus('off');
    setLiveError(null);
    setCaptions([]);
    setCaptionsBroken(false);
    wipeDoodle.current?.();
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
  }, [stopPlaying, stopReading]);

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
              ...(event.failed ? { failed: true } : {}),
              final: event.final,
            }));
            // 상대 말의 번역이 다 왔으면 소리로도 들려준다. 내 말은 읽지 않는다.
            if (event.translated && event.from !== myId && voiceRef.current === 'read') {
              read(event.translated, event.translatedLang ?? hearLangRef.current);
            }
            return;
          }
          case 'call_interpret': {
            // 상대가 내 말을 통역으로 듣겠다(또는 그만). 켜져 있는 동안 내 마이크 소리를 보낸다.
            if (callId.current !== event.callId) return;
            setPeerListening(event.on);
            return;
          }
          case 'call_voice': {
            if (callId.current !== event.callId || voiceRef.current !== 'live') return;
            playVoice(event.pcm, event.rate);
            return;
          }
          case 'call_interpret_status': {
            if (callId.current !== event.callId || voiceRef.current !== 'live') return;
            setLiveStatus(event.status);
            setLiveError(event.code ?? null);
            return;
          }
          case 'draw': {
            if (callId.current !== event.callId) return;
            receiveDraw.current?.(event.strokeId, event.points);
            return;
          }
          case 'draw_clear': {
            if (callId.current !== event.callId) return;
            wipeDoodle.current?.();
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
  }, [drainIce, emit, finish, myId, playVoice, read, subscribe, teardown]);

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
    // 번역을 소리로 내는 동안은 쉰다. 스피커에서 나온 번역을 내 말로 받아 적으면 안 된다.
    if (!live || !captionsOn || busy || !canListen() || !id) return;

    /** 지금 말하고 있는 한 줄의 id. 도중이든 끝이든 같은 id 라야 한 줄로 이어진다. */
    let lineId = crypto.randomUUID();
    let sentAt = 0;
    let sentText = '';
    /** 말하는 도중이라 아직 끝나지 않은 줄. 다 말하면 비운다. */
    let saying = '';

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
          saying = '';
          return;
        }
        saying = text;

        // 받아쓰기는 1초에도 여러 번 고쳐 준다. 그대로 흘리면 소켓만 시끄럽다.
        const now = Date.now();
        if (text === sentText || now - sentAt < INTERIM_EVERY_MS) return;
        sentAt = now;
        sentText = text;
        emit({ type: 'caption', callId: id, id: current, text, final: false });
      },
      onError: () => {
        // 애플 기기에서 걸리면 listen() 이 스스로 물러난다. 왜 조용한지는 알려 줘야 한다.
        if (isApple()) setCaptionsBroken(true);
      },
    });
    ear.current = ear_;
    return () => {
      ear_.stop();
      if (ear.current === ear_) ear.current = null;
      /*
       * 번역을 읽어 주느라 잠깐 멈추는 것이면, 하던 말은 거기까지로 마무리 짓는다.
       * 멈춘 인식기는 그 줄을 끝내 주지 않아서, 그대로 두면 번역도 기록도 안 된다.
       */
      if (busyRef.current && saying) {
        const current = lineId;
        const text = saying;
        setCaptions((previous) => merge(previous, { id: current, mine: true, text, final: true }));
        emit({ type: 'caption', callId: id, id: current, text, final: true });
      }
    };
  }, [busy, captionsOn, emit, myLang, state.phase]);

  /**
   * 통역 음성으로 듣기. 켜 두면 통화가 붙을 때 서버에 알리고, 옮겨 온 소리를 틀 준비를 한다.
   * 끄거나 통화가 끝나면 서버에도 알린다 — 상대 폰이 마이크 소리를 그만 보낸다.
   */
  useEffect(() => {
    const id = callId.current;
    if (voice !== 'live' || state.phase !== 'connected' || !id) return;
    const out = createPlayer();
    player.current = out;
    setLiveStatus('waiting');
    setLiveError(null);
    emit({ type: 'call_interpret', callId: id, on: true });
    return () => {
      emit({ type: 'call_interpret', callId: id, on: false });
      out.close();
      if (player.current === out) player.current = null;
      stopPlaying();
      setLiveStatus('off');
      setLiveError(null);
    };
  }, [emit, state.phase, stopPlaying, voice]);

  /**
   * 상대가 내 말을 통역으로 듣는 동안, 내 마이크 소리를 떼어 서버로 보낸다.
   *
   * 말할 때만 보낸다. 조용한 소리까지 다 보내면 무료 한도를 빈 소리로 깎는다. 말이
   * 시작되기 직전 조금(첫 음절)도 같이 보내고, 숨 고르는 틈에는 끊지 않는다. 말이
   * 끝나면 end 를 보내 모델이 남은 말을 마저 옮기게 한다.
   *
   * 음소거 중이거나 내 폰이 번역·통역 소리를 내고 있을 때는 보내지 않는다. 스피커
   * 소리가 마이크로 들어가 상대 말이 상대에게 되돌아가는 것을 막는다.
   */
  useEffect(() => {
    const id = callId.current;
    if (!peerListening || state.phase !== 'connected' || !id) return;

    let sending = false;
    let quiet = 0;
    let preroll: string[] = [];
    const finishTurn = () => {
      if (!sending) return;
      sending = false;
      emit({ type: 'call_mic', callId: id, pcm: '', end: true });
    };

    const tap = tapMic(mic.current, (pcm, level) => {
      if (mutedRef.current || busyRef.current) {
        finishTurn();
        preroll = [];
        return;
      }
      const loud = level >= SPEECH_LEVEL;
      quiet = loud ? 0 : quiet + 1;
      if (!sending) {
        if (!loud) {
          preroll.push(pcm);
          if (preroll.length > PREROLL_CHUNKS) preroll.shift();
          return;
        }
        // 말이 시작됐다. 바로 앞 조용한 토막부터 보낸다.
        sending = true;
        for (const chunk of preroll) emit({ type: 'call_mic', callId: id, pcm: chunk });
        preroll = [];
      }
      emit({ type: 'call_mic', callId: id, pcm });
      if (quiet >= HANGOVER_CHUNKS) finishTurn();
    });
    return () => {
      tap.stop();
      finishTurn();
    };
  }, [emit, peerListening, state.phase]);

  /** 상대 말을 소리로 어떻게 들을지 바꾼다. 다음 통화에도 그대로 간다. */
  const setVoice = useCallback(
    (next: CallVoice) => {
      // iOS 는 사람이 누른 이 순간에 소리 문을 열어 둬야 나중에 저절로 소리를 낸다.
      if (next === 'read') primeSpeech();
      else stopReading();
      if (next === 'live') unlockAudio();
      setVoiceState(next);
      try {
        localStorage.setItem(VOICE_KEY, next);
      } catch {
        // 저장 못 해도 이번 통화에는 적용된다.
      }
    },
    [stopReading],
  );

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

  receiveDraw.current = doodle.receive;
  wipeDoodle.current = doodle.wipe;

  return {
    ...state,
    doodle,
    muted,
    since,
    video,
    cameraOn,
    peerCamera,
    localStream,
    remoteStream,
    captions,
    captionsOn,
    captionsBroken,
    /** 이 기기에서 받아쓰기를 쓸 수 있는지. 못 쓰면 켜는 단추를 보여 줄 이유가 없다. */
    canCaption: canListen(),
    voice,
    setVoice,
    /** 번역을 소리로 내고 있는 중. */
    speaking,
    /**
     * 상대 목소리를 얼마나 크게 틀지(0~1). 번역·통역을 소리로 내는 동안 줄어든다.
     * 소리를 실제로 트는 곳(웹은 video 엘리먼트, 앱은 트랙)이 이 값을 따른다.
     */
    peerVolume: busy ? DUCK_VOLUME : 1,
    /** 이 기기에서 통역 음성을 쓸 수 있는지. */
    canInterpret: canInterpret(),
    liveStatus,
    liveError,
    /** 상대가 내 말을 통역 음성으로 듣고 있는지. 내 마이크 소리가 서버로 간다는 뜻이다. */
    peerListening,
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
