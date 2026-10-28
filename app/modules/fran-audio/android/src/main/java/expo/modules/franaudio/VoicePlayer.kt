package expo.modules.franaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * 옮겨 온 소리를 튼다. 모노 16비트 토막을 받는 대로 이어 붙여 흘린다.
 *
 * 통화 소리와 같은 길(USAGE_VOICE_COMMUNICATION)로 내보낸다. 통화가 스피커로 나오면
 * 이것도 스피커로, 수화부면 수화부로 나온다. 폰의 에코 제거도 이 소리를 통화 소리처럼
 * 다룬다 — 상대에게 되돌아가는 것을 조금이라도 더 막는다.
 */
class VoicePlayer {
  private val queue = LinkedBlockingQueue<ShortArray>()
  private var track: AudioTrack? = null
  private var writer: Thread? = null
  private var rate = 0

  /** 지금까지 넘겨받은 소리가 다 끝날 시각(ms, 부팅 뒤 경과). */
  private var endsAt = 0L

  /**
   * 한 토막을 이어 붙인다. 지금부터 다 틀기까지 남은 초를 돌려준다.
   * 부르는 쪽은 이걸로 "언제까지 상대 목소리를 줄여 둘지" 를 정한다.
   */
  @Synchronized
  fun play(pcm: String, sampleRate: Int): Double {
    val bytes = Base64.decode(pcm, Base64.DEFAULT)
    val samples = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
    val now = SystemClock.elapsedRealtime()
    if (samples.isEmpty() || sampleRate <= 0) return (endsAt - now).coerceAtLeast(0) / 1000.0

    if (sampleRate != rate || track == null) open(sampleRate)
    queue.offer(samples)
    endsAt = maxOf(endsAt, now) + samples.size * 1000L / sampleRate
    return (endsAt - now) / 1000.0
  }

  /** 틀던 것과 기다리던 것을 모두 버린다. */
  @Synchronized
  fun stop() {
    queue.clear()
    writer?.interrupt()
    writer = null
    track?.let { old ->
      try {
        old.pause()
        old.flush()
      } catch (ignored: IllegalStateException) {
        // 이미 멈춘 것.
      }
      old.release()
    }
    track = null
    rate = 0
    endsAt = 0L
  }

  private fun open(sampleRate: Int) {
    stop()
    val minimum = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    // 200ms 쯤 넉넉히. 토막이 고르게 오지 않아도 끊기지 않게.
    val size = maxOf(minimum, sampleRate / 5 * 2)
    val created = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(size)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    created.play()
    track = created
    rate = sampleRate

    // 쓰기는 소리가 실제로 나가는 만큼만 받아 주므로(블로킹), 따로 도는 줄에서 한다.
    val thread = Thread({
      try {
        while (!Thread.currentThread().isInterrupted) {
          val samples = queue.poll(250, TimeUnit.MILLISECONDS) ?: continue
          var offset = 0
          while (offset < samples.size && !Thread.currentThread().isInterrupted) {
            val written = created.write(samples, offset, samples.size - offset)
            if (written <= 0) break
            offset += written
          }
        }
      } catch (ignored: InterruptedException) {
        // 멈추라는 뜻.
      } catch (ignored: IllegalStateException) {
        // 트랙이 먼저 풀렸다.
      }
    }, "fran-voice")
    thread.start()
    writer = thread
  }
}
