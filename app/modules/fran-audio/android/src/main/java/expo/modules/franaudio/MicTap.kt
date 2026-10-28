package expo.modules.franaudio

import android.app.Application
import android.media.AudioFormat
import android.util.Base64
import com.oney.WebRTCModule.WebRTCModuleOptions
import expo.modules.core.interfaces.ApplicationLifecycleListener
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * 통화 마이크에서 소리를 떼어 낸다.
 *
 * 통화 목소리는 react-native-webrtc 가 잡은 마이크로 간다. 같은 마이크를 따로 한 번 더
 * 열면 안드로이드는 한쪽에 빈 소리를 주거나 통화 소리를 흔든다. 그래서 WebRTC 가 쓸
 * 소리 장치를 앱이 켜질 때 우리가 만들어 넘기고, 그 장치가 마이크에서 읽은 소리를
 * 곁에서 받아 본다(SamplesReadyCallback). 통화에는 아무 영향이 없다.
 *
 * 받는 소리는 10ms 씩 장치의 빠르기(대개 48kHz)로 온다. 16kHz 모노로 줄여 100ms 씩
 * 모아서 넘긴다.
 */
object MicTap : JavaAudioDeviceModule.SamplesReadyCallback {
  /** 보내는 모양. 모델이 16kHz 모노 16비트로 받는다. */
  private const val SEND_RATE = 16_000

  /** 한 번에 넘기는 길이. 100ms. */
  private const val CHUNK_SAMPLES = SEND_RATE / 10

  /** 떼어 낸 소리를 받을 곳. 없으면 아무것도 하지 않는다 — 통화 내내 불리는 자리라 가벼워야 한다. */
  @Volatile
  private var sink: ((String, Double) -> Unit)? = null

  private val chunk = ShortArray(CHUNK_SAMPLES)
  private var filled = 0

  /** 줄이는 중인 표본의 합과 개수, 다음 표본까지 남은 거리. */
  private var sum = 0.0
  private var count = 0
  private var position = 0.0

  /** 우리 소리 장치를 WebRTC 에 끼워 넣었는지. */
  @Volatile
  var installed = false
    private set

  /**
   * 앱이 켜질 때 한 번. WebRTC 모듈은 처음 쓰일 때 만들어지므로 그 전에 끼워 둔다.
   * 설정은 WebRTC 가 기본으로 만들던 것과 같다 — 곁에서 듣는 자리만 하나 더 있다.
   */
  val installer = object : ApplicationLifecycleListener {
    override fun onCreate(application: Application) {
      val options = WebRTCModuleOptions.getInstance()
      if (options.audioDeviceModule != null) return
      options.audioDeviceModule = JavaAudioDeviceModule.builder(application)
        .setEnableVolumeLogger(false)
        .setSamplesReadyCallback(MicTap)
        .createAudioDeviceModule()
      installed = true
    }
  }

  fun start(onChunk: (pcm: String, level: Double) -> Unit) {
    synchronized(this) {
      reset()
      sink = onChunk
    }
  }

  fun stop() {
    synchronized(this) {
      sink = null
      reset()
    }
  }

  private fun reset() {
    filled = 0
    sum = 0.0
    count = 0
    position = 0.0
  }

  override fun onWebRtcAudioRecordSamplesReady(samples: JavaAudioDeviceModule.AudioSamples) {
    if (sink == null || samples.audioFormat != AudioFormat.ENCODING_PCM_16BIT) return
    synchronized(this) {
      val out = sink ?: return
      val input = ByteBuffer.wrap(samples.data).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val channels = samples.channelCount.coerceAtLeast(1)
      val frames = input.remaining() / channels
      // 들어온 표본 몇 개가 보낼 표본 하나가 되는지. 48kHz 면 3.
      val ratio = samples.sampleRate.toDouble() / SEND_RATE

      for (frame in 0 until frames) {
        // 여러 채널이면 섞어 하나로.
        var mixed = 0
        for (channel in 0 until channels) mixed += input.get(frame * channels + channel)
        sum += mixed.toDouble() / channels
        count += 1
        position += 1.0
        // 맡은 구간이 다 차면 평균을 낸다. 건너뛰며 고르면 높은 소리가 접혀 지글거린다.
        // 장치가 16kHz 보다 느리면(드물다) 같은 값을 거듭 넣어 채운다.
        if (position >= ratio) {
          val value = (sum / count).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
          sum = 0.0
          count = 0
          while (position >= ratio) {
            position -= ratio
            put(value, out)
          }
        }
      }
    }
  }

  private fun put(value: Short, out: (String, Double) -> Unit) {
    chunk[filled] = value
    filled += 1
    if (filled == CHUNK_SAMPLES) {
      out(encode(chunk), level(chunk))
      filled = 0
    }
  }

  /** 토막의 소리 크기(RMS, 0~1). 말하는 중인지는 받는 쪽이 이걸로 가른다. */
  private fun level(samples: ShortArray): Double {
    var total = 0.0
    for (sample in samples) {
      val value = sample / 32768.0
      total += value * value
    }
    return sqrt(total / samples.size)
  }

  private fun encode(samples: ShortArray): String {
    val bytes = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    bytes.asShortBuffer().put(samples)
    return Base64.encodeToString(bytes.array(), Base64.NO_WRAP)
  }
}
