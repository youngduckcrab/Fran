/**
 * 통역 음성에 쓰는 날소리(PCM) — 마이크에서 떼어 내고, 옮겨 온 것을 튼다.
 *
 * 통화 목소리는 WebRTC 가 폰끼리 직접 나른다. 통역은 그 소리를 서버(그리고 Gemini)로
 * 따로 보내야 해서, 통화에 쓰는 마이크 스트림에서 소리를 한 번 더 떼어 낸다.
 * 보내는 모양은 16kHz 모노 16비트, 받는 모양은 24kHz 모노 16비트다.
 *
 * 앱(app/overrides/pcm.ts)은 같은 이름으로 폰의 소리 장치를 직접 쓴다.
 */

/** 한 번에 보내는 소리 길이(초). 짧을수록 빨리 가지만 오가는 횟수가 는다. */
const CHUNK_SECONDS = 0.1;

/** 보내는 소리의 빠르기. 모델이 이 모양으로 받는다. */
const SEND_RATE = 16_000;

/** 이 기기에서 통역 음성을 쓸 수 있는지. 소리를 떼어 내고(AudioWorklet) 틀 수 있어야 한다. */
export function canInterpret(): boolean {
  return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
}

let context: AudioContext | null = null;

function audio(): AudioContext {
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}

/**
 * 사람이 누른 그 순간에 불러 둔다.
 *
 * 브라우저는 사람이 누르기 전에는 소리를 못 내게 막는다(특히 아이폰). 옮긴 소리는
 * 나중에 소켓으로 오므로, 켜는 단추를 누를 때 미리 문을 열어 둔다.
 */
export function unlockAudio(): void {
  if (!canInterpret()) return;
  try {
    void audio().resume();
  } catch {
    // 열지 못하면 소리가 안 날 뿐이다. 통화는 그대로 간다.
  }
}

/* ------------------------------ 마이크에서 떼어 내기 ------------------------------ */

export interface MicTap {
  stop: () => void;
}

/**
 * 받은 소리를 그대로 모아 CHUNK 만큼 차면 넘겨준다. 오디오 스레드에서 돈다.
 * 여기서는 모으기만 하고, 줄이고 바꾸는 일은 바깥에서 한다.
 */
const TAP_WORKLET = `
class FranTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.size;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.size - this.filled);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('fran-tap', FranTap);
`;

let workletUrl: string | null = null;

/**
 * 통화 마이크에서 소리를 100ms 씩 떼어 onChunk 로 넘긴다.
 *
 * pcm 은 16kHz 모노 16비트를 base64 로 싼 것, level 은 그 토막의 크기(0~1, RMS)다.
 * 말하는 중인지 아닌지는 부르는 쪽이 level 로 가른다.
 */
export function tapMic(stream: MediaStream | null, onChunk: (pcm: string, level: number) => void): MicTap {
  if (!stream || !canInterpret() || stream.getAudioTracks().length === 0) return { stop: () => {} };

  let stopped = false;
  let nodes: AudioNode[] = [];
  const ctx = audio();

  void (async () => {
    try {
      workletUrl ??= URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(workletUrl);
      if (stopped) return;
      const source = ctx.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(ctx, 'fran-tap', {
        processorOptions: { size: Math.round(ctx.sampleRate * CHUNK_SECONDS) },
      });
      // 끝까지 이어 두지 않으면 돌지 않는 브라우저가 있다. 소리는 0 으로 막아 내보내지 않는다.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(tap);
      tap.connect(mute);
      mute.connect(ctx.destination);
      nodes = [source, tap, mute];
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (stopped) return;
        const samples = downsample(event.data, ctx.sampleRate, SEND_RATE);
        onChunk(encode(samples), level(event.data));
      };
    } catch {
      // 이 브라우저에서는 소리를 떼어 내지 못한다. 상대는 통역 없이 원래 목소리만 듣는다.
    }
  })();

  return {
    stop: () => {
      stopped = true;
      for (const node of nodes) node.disconnect();
      nodes = [];
    },
  };
}

/** 토막의 소리 크기(RMS). 말소리는 0.05~0.3, 조용한 방은 0.01 아래다. */
function level(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/**
 * 표본 수를 줄인다(48kHz → 16kHz 같은).
 *
 * 건너뛰며 고르면 높은 소리가 낮은 소리로 접혀 들어와 지글거린다. 새 표본 하나가
 * 맡는 구간의 평균을 내면 그게 걸러진다. 말소리에는 이 정도면 된다.
 */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j]!;
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

/** -1~1 소리를 16비트로 바꿔 base64 로 싼다. */
function encode(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]!));
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(binary);
}

/** base64 로 싼 16비트 소리를 -1~1 로 푼다. */
function decode(pcm: string): Float32Array {
  const binary = atob(pcm);
  const bytes = new Uint8Array(binary.length - (binary.length % 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const samples = new Int16Array(bytes.buffer);
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) output[i] = samples[i]! / 0x8000;
  return output;
}

/* ------------------------------ 옮겨 온 소리 틀기 ------------------------------ */

export interface VoicePlayer {
  /** 소리 한 토막을 앞 토막 뒤에 이어 붙인다. 지금부터 다 틀기까지 남은 초를 돌려준다. */
  play: (pcm: string, rate: number) => number;
  /** 틀던 것과 기다리던 것을 모두 버린다. */
  close: () => void;
}

/**
 * 비어 있다가 새로 틀 때 이만큼 뒤에 시작한다(초).
 * 토막은 고르게 오지 않는다. 바로 붙여 틀면 다음 토막이 늦을 때마다 뚝뚝 끊긴다.
 */
const LEAD_SECONDS = 0.08;

export function createPlayer(): VoicePlayer {
  if (!canInterpret()) return { play: () => 0, close: () => {} };
  const ctx = audio();
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const sources = new Set<AudioBufferSourceNode>();
  /** 다음 토막이 시작할 시각(ctx 시계). */
  let at = 0;

  return {
    play: (pcm, rate) => {
      const samples = decode(pcm);
      if (samples.length === 0) return Math.max(0, at - ctx.currentTime);
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      const now = ctx.currentTime;
      at = Math.max(at, now + LEAD_SECONDS);
      source.start(at);
      at += buffer.duration;
      sources.add(source);
      source.onended = () => sources.delete(source);
      return at - now;
    },
    close: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // 이미 끝난 것.
        }
      }
      sources.clear();
      out.disconnect();
      at = 0;
    },
  };
}
