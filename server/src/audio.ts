import { spawn } from 'node:child_process';

/**
 * 음성을 모델이 알아듣는 형식으로 맞춘다.
 *
 * 폰이 만들어 주는 형식은 제각각이다(안드로이드는 webm/opus, 아이폰은 mp4/aac).
 * 모델이 받아주는 목록에는 webm 도 mp4 도 없어서, 있는 그대로 보내면 거절당한다.
 * ffmpeg 이 있으면 ogg/opus 로 바꿔서 보내고, 없으면 컨테이너 이름만 바꿔서 시도한다.
 */

/** 모델이 그대로 받아주는 형식들. */
const DIRECTLY_SUPPORTED = /^audio\/(wav|x-wav|mpeg|mp3|aiff|aac|ogg|flac)$/;

/**
 * ffmpeg 이 없을 때의 차선책.
 * webm 과 mp4 는 원래 영상 컨테이너라 영상으로 적어 보내면 받아주기도 한다.
 */
const CONTAINER_FALLBACK: Record<string, string> = {
  'audio/webm': 'video/webm',
  'audio/mp4': 'video/mp4',
  'audio/x-m4a': 'video/mp4',
  'audio/3gpp': 'video/3gpp',
};

let ffmpegChecked = false;
let ffmpegPath: string | null = null;

async function findFfmpeg(): Promise<string | null> {
  if (ffmpegChecked) return ffmpegPath;
  ffmpegChecked = true;
  ffmpegPath = await new Promise<string | null>((resolve) => {
    const probe = spawn('ffmpeg', ['-version']);
    probe.on('error', () => resolve(null));
    probe.on('close', (code) => resolve(code === 0 ? 'ffmpeg' : null));
  });
  if (!ffmpegPath) {
    console.warn('⚠️  ffmpeg 이 없어 음성을 그대로 보냅니다. 받아쓰기가 실패하면 ffmpeg 을 설치하세요.');
  }
  return ffmpegPath;
}

function convert(bin: string, input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 말소리만 필요하므로 16kHz 모노로 줄인다. 올려 보낼 양도 같이 줄어든다.
    const proc = spawn(bin, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'libopus', '-b:a', '24k',
      '-f', 'ogg', 'pipe:1',
    ]);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && out.length > 0) resolve(Buffer.concat(out));
      else reject(new Error(Buffer.concat(err).toString().trim() || `ffmpeg 이 ${code} 로 끝났습니다.`));
    });

    proc.stdin.on('error', () => undefined); // 변환이 먼저 끝나면 파이프가 닫힌다
    proc.stdin.end(input);
  });
}

export async function toModelAudio(
  bytes: Buffer,
  mime: string,
): Promise<{ bytes: Buffer; mime: string }> {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (DIRECTLY_SUPPORTED.test(base)) return { bytes, mime: base };

  const bin = await findFfmpeg();
  if (bin) {
    try {
      return { bytes: await convert(bin, bytes), mime: 'audio/ogg' };
    } catch (error) {
      console.warn(`[audio] 변환하지 못해 원본 그대로 보냅니다: ${(error as Error).message}`);
    }
  }
  return { bytes, mime: CONTAINER_FALLBACK[base] ?? base };
}
